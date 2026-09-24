-- ============================================================
-- Motor de reservas de zonas comunes: disponibilidad, reserva con
-- validación completa, tarifa en la cuenta de la unidad, aprobación,
-- cancelación y avisos al residente.
-- ============================================================

-- ------------------------------------------------------------
-- Disponibilidad: franjas del día con su estado (exclusivo u aforo).
-- ------------------------------------------------------------
create or replace function public.get_area_slots(p_area_id uuid, p_date date, p_duration_minutes integer default null)
returns table (start_at timestamptz, end_at timestamptz, available boolean, remaining_capacity integer)
language plpgsql
security definer
stable
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_area public.common_areas;
  v_tz text;
  v_duration integer;
begin
  select * into v_area from public.common_areas where id = p_area_id;
  if not found or not v_area.is_active then
    raise exception 'AREA_NOT_FOUND' using errcode = 'P0002';
  end if;
  perform public.assert_org_member(v_area.organization_id);
  select timezone into v_tz from public.organizations where id = v_area.organization_id;
  v_duration := coalesce(p_duration_minutes, v_area.min_duration_minutes);
  if v_duration < v_area.min_duration_minutes or v_duration > v_area.max_duration_minutes then
    raise exception 'RESERVATION_INVALID_DURATION' using errcode = 'P0001';
  end if;

  return query
  with slots as (
    select (gs at time zone v_tz) as s_start, ((gs + make_interval(mins => v_duration)) at time zone v_tz) as s_end
    from public.common_area_hours h
    cross join lateral generate_series(
      p_date + h.opens_at,
      p_date + h.closes_at - make_interval(mins => v_duration),
      make_interval(mins => v_area.slot_minutes)
    ) gs
    where h.area_id = p_area_id and h.day_of_week = extract(dow from p_date)::integer
  ), usage as (
    select s.s_start, s.s_end,
      coalesce((
        select sum(r.guests) from public.area_reservations r
        where r.area_id = p_area_id and r.status in ('pending_approval', 'confirmed')
          and tstzrange(r.start_at, r.end_at, '[)') && tstzrange(s.s_start, s.s_end, '[)')
      ), 0)::integer as used,
      exists (
        select 1 from public.area_reservations r
        where r.area_id = p_area_id and r.status in ('pending_approval', 'confirmed')
          and tstzrange(r.start_at, r.end_at, '[)') && tstzrange(s.s_start, s.s_end, '[)')
      ) as any_overlap
    from slots s
  )
  select u.s_start, u.s_end,
    (u.s_start >= now() + make_interval(hours => v_area.advance_min_hours)
      and u.s_start <= now() + make_interval(days => v_area.advance_max_days)
      and case when v_area.booking_mode = 'exclusive' then not u.any_overlap else u.used < v_area.capacity end),
    case when v_area.booking_mode = 'exclusive' then (case when u.any_overlap then 0 else 1 end)
         else greatest(0, v_area.capacity - u.used) end
  from usage u
  order by u.s_start;
end;
$$;

-- Cargo de la tarifa en la cuenta de la unidad (fuente única: el libro).
create or replace function public.create_reservation_charge(p_reservation_id uuid)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_res public.area_reservations;
  v_area_name text;
  v_tz text;
  v_concept_id uuid;
  v_charge_id uuid;
begin
  select * into v_res from public.area_reservations where id = p_reservation_id;
  if v_res.fee_amount <= 0 or v_res.charge_id is not null then
    return v_res.charge_id;
  end if;
  select name into v_area_name from public.common_areas where id = v_res.area_id;
  select timezone into v_tz from public.organizations where id = v_res.organization_id;
  select id into v_concept_id from public.charge_concepts
  where organization_id = v_res.organization_id and kind = 'common_area' and is_system;
  if v_concept_id is null then
    raise exception 'CONCEPT_NOT_FOUND: falta el concepto de zonas comunes' using errcode = 'P0002';
  end if;

  insert into public.charges (organization_id, unit_id, concept_id, description, amount, due_date, source, reservation_id, created_by)
  values (
    v_res.organization_id, v_res.unit_id, v_concept_id,
    'Reserva ' || v_area_name || ' ' || to_char(v_res.start_at at time zone v_tz, 'DD/MM/YYYY HH24:MI'),
    v_res.fee_amount,
    greatest((v_res.start_at at time zone v_tz)::date, public.org_today(v_res.organization_id)),
    'reservation', v_res.id, (select auth.uid())
  ) returning id into v_charge_id;

  update public.area_reservations set charge_id = v_charge_id where id = v_res.id;
  return v_charge_id;
end;
$$;

create or replace function public.book_area_reservation(
  p_organization_id uuid,
  p_area_id uuid,
  p_unit_id uuid,
  p_person_id uuid,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_guests integer default 1,
  p_notes text default null,
  p_source text default 'dashboard',
  p_conversation_id uuid default null
)
returns public.area_reservations
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_area public.common_areas;
  v_tz text;
  v_is_staff boolean := (select auth.uid()) is not null;
  v_start_local timestamp;
  v_end_local timestamp;
  v_duration integer;
  v_guests integer := coalesce(p_guests, 1);
  v_used integer;
  v_active integer;
  v_res public.area_reservations;
begin
  perform public.assert_org_permission(p_organization_id, 'reservations.write');
  perform public.set_audit_actor(case when v_is_staff then 'staff' else 'agent' end);

  select * into v_area from public.common_areas where id = p_area_id and organization_id = p_organization_id;
  if not found or not v_area.is_active then
    raise exception 'AREA_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.units where id = p_unit_id and organization_id = p_organization_id and is_active) then
    raise exception 'UNIT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_start_at is null or p_end_at is null or p_end_at <= p_start_at then
    raise exception 'RESERVATION_INVALID_RANGE' using errcode = 'P0001';
  end if;
  v_duration := (extract(epoch from (p_end_at - p_start_at)) / 60)::integer;
  if v_duration < v_area.min_duration_minutes or v_duration > v_area.max_duration_minutes then
    raise exception 'RESERVATION_INVALID_DURATION' using errcode = 'P0001';
  end if;
  if p_start_at < now() then
    raise exception 'RESERVATION_IN_PAST' using errcode = 'P0001';
  end if;
  -- El equipo puede agendar por fuera de la ventana de anticipación (p. ej.
  -- una solicitud presencial), nunca por fuera del horario ni con choques.
  if not v_is_staff and (
    p_start_at < now() + make_interval(hours => v_area.advance_min_hours)
    or p_start_at > now() + make_interval(days => v_area.advance_max_days)
  ) then
    raise exception 'OUTSIDE_BOOKING_WINDOW' using errcode = 'P0001';
  end if;

  select timezone into v_tz from public.organizations where id = p_organization_id;
  v_start_local := p_start_at at time zone v_tz;
  v_end_local := p_end_at at time zone v_tz;
  if not exists (
    select 1 from public.common_area_hours h
    where h.area_id = p_area_id and h.day_of_week = extract(dow from v_start_local)::integer
      and v_start_local >= v_start_local::date + h.opens_at
      and v_end_local <= v_start_local::date + h.closes_at
  ) then
    raise exception 'AREA_CLOSED' using errcode = 'P0001';
  end if;

  if v_guests < 1 or (v_area.max_guests is not null and v_guests > v_area.max_guests)
     or (v_area.booking_mode = 'shared' and v_guests > v_area.capacity) then
    raise exception 'GUESTS_EXCEED_CAPACITY' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_area_id::text || ':' || v_start_local::date::text, 0));

  select count(*) into v_active from public.area_reservations
  where area_id = p_area_id and unit_id = p_unit_id and status in ('pending_approval', 'confirmed') and end_at > now();
  if v_active >= v_area.max_active_per_unit then
    raise exception 'UNIT_RESERVATION_LIMIT' using errcode = 'P0001';
  end if;

  if v_area.block_if_overdue and exists (
    select 1 from public.ledger_open_items(p_organization_id, p_unit_id) li
    where li.unpaid > 0 and li.due_date < public.org_today(p_organization_id)
  ) then
    raise exception 'UNIT_HAS_OVERDUE_BALANCE' using errcode = 'P0001';
  end if;

  if v_area.booking_mode = 'shared' then
    select coalesce(sum(guests), 0) into v_used from public.area_reservations
    where area_id = p_area_id and status in ('pending_approval', 'confirmed')
      and tstzrange(start_at, end_at, '[)') && tstzrange(p_start_at, p_end_at, '[)');
    if v_used + v_guests > v_area.capacity then
      raise exception 'AREA_NOT_AVAILABLE' using errcode = 'P0001';
    end if;
  end if;

  begin
    insert into public.area_reservations (
      organization_id, area_id, unit_id, person_id, conversation_id, start_at, end_at, guests, is_exclusive,
      status, fee_amount, deposit_amount, notes, source, created_by
    ) values (
      p_organization_id, p_area_id, p_unit_id, p_person_id, p_conversation_id, p_start_at, p_end_at, v_guests,
      v_area.booking_mode = 'exclusive',
      case when v_area.requires_approval then 'pending_approval' else 'confirmed' end,
      v_area.fee_amount, v_area.deposit_amount, nullif(btrim(coalesce(p_notes, '')), ''),
      coalesce(p_source, 'dashboard'), (select auth.uid())
    ) returning * into v_res;
  exception
    when exclusion_violation then
      raise exception 'AREA_NOT_AVAILABLE' using errcode = 'P0001';
  end;

  if v_res.status = 'confirmed' and v_res.fee_amount > 0 then
    perform public.create_reservation_charge(v_res.id);
    select * into v_res from public.area_reservations where id = v_res.id;
  end if;
  return v_res;
end;
$$;

create or replace function public.notify_reservation_update(p_reservation_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_res public.area_reservations;
  v_area_name text;
  v_tz text;
  v_property text;
  v_first_name text;
begin
  select * into v_res from public.area_reservations where id = p_reservation_id;
  if v_res.person_id is null and v_res.conversation_id is null then
    return null;
  end if;
  select name into v_area_name from public.common_areas where id = v_res.area_id;
  select timezone into v_tz from public.organizations where id = v_res.organization_id;
  select display_name into v_property from public.property_profiles where organization_id = v_res.organization_id;
  select split_part(full_name, ' ', 1) into v_first_name from public.persons where id = v_res.person_id;
  return public.enqueue_outbound_to_person(
    v_res.organization_id, v_res.person_id, 'reservation_update', p_body, 'reservation_update',
    jsonb_build_object('1', coalesce(v_first_name, 'residente'), '2', v_area_name,
                       '3', to_char(v_res.start_at at time zone v_tz, 'DD/MM/YYYY'), '4', coalesce(v_property, '')),
    'area_reservation', v_res.id, 'reservation_update:' || v_res.id || ':' || v_res.status, false, v_res.conversation_id
  );
end;
$$;

create or replace function public.decide_area_reservation(p_reservation_id uuid, p_approve boolean, p_reason text default null)
returns public.area_reservations
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_res public.area_reservations;
  v_area_name text;
  v_tz text;
  v_when text;
begin
  select * into v_res from public.area_reservations where id = p_reservation_id for update;
  if not found then
    raise exception 'RESERVATION_NOT_FOUND' using errcode = 'P0002';
  end if;
  perform public.assert_org_permission(v_res.organization_id, 'reservations.write');
  if v_res.status <> 'pending_approval' then
    raise exception 'RESERVATION_NOT_PENDING' using errcode = 'P0001';
  end if;
  if not p_approve and length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'VALIDATION_ERROR: indica el motivo del rechazo' using errcode = '22023';
  end if;
  if p_approve and v_res.start_at < now() then
    raise exception 'RESERVATION_IN_PAST' using errcode = 'P0001';
  end if;

  update public.area_reservations
  set status = case when p_approve then 'confirmed' else 'rejected' end,
      decided_by = (select auth.uid()), decided_at = now(), decision_reason = nullif(btrim(coalesce(p_reason, '')), '')
  where id = p_reservation_id
  returning * into v_res;

  if p_approve then
    perform public.create_reservation_charge(v_res.id);
    select * into v_res from public.area_reservations where id = v_res.id;
  end if;

  select name into v_area_name from public.common_areas where id = v_res.area_id;
  select timezone into v_tz from public.organizations where id = v_res.organization_id;
  v_when := to_char(v_res.start_at at time zone v_tz, 'DD/MM/YYYY "de" HH24:MI') || ' a ' || to_char(v_res.end_at at time zone v_tz, 'HH24:MI');
  perform public.notify_reservation_update(v_res.id,
    case when p_approve then
      'Tu reserva de ' || v_area_name || ' para el ' || v_when || ' fue aprobada.'
      || case when v_res.fee_amount > 0 then ' Se cargaron ' || public.format_cop(v_res.fee_amount) || ' a la cuenta de la unidad.' else '' end
    else
      'Tu solicitud de reserva de ' || v_area_name || ' para el ' || v_when || ' no fue aprobada. Motivo: ' || v_res.decision_reason
    end);
  return v_res;
end;
$$;

create or replace function public.cancel_area_reservation(p_reservation_id uuid, p_reason text default null)
returns public.area_reservations
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_res public.area_reservations;
  v_is_staff boolean := (select auth.uid()) is not null;
  v_area_name text;
  v_tz text;
begin
  select * into v_res from public.area_reservations where id = p_reservation_id for update;
  if not found then
    raise exception 'RESERVATION_NOT_FOUND' using errcode = 'P0002';
  end if;
  perform public.assert_org_permission(v_res.organization_id, 'reservations.write');
  perform public.set_audit_actor(case when v_is_staff then 'staff' else 'agent' end);
  if v_res.status not in ('pending_approval', 'confirmed') or v_res.end_at <= now() then
    raise exception 'RESERVATION_NOT_MODIFIABLE' using errcode = 'P0001';
  end if;

  update public.area_reservations
  set status = 'cancelled', cancelled_at = now(),
      cancel_reason = coalesce(nullif(btrim(coalesce(p_reason, '')), ''),
                               case when v_is_staff then 'Cancelada por la administración' else 'Cancelada por el residente' end)
  where id = p_reservation_id
  returning * into v_res;

  if v_res.charge_id is not null then
    update public.charges set status = 'voided', void_reason = 'Reserva cancelada'
    where id = v_res.charge_id and status = 'active';
  end if;

  if v_is_staff then
    select name into v_area_name from public.common_areas where id = v_res.area_id;
    select timezone into v_tz from public.organizations where id = v_res.organization_id;
    perform public.notify_reservation_update(v_res.id,
      'La administración canceló tu reserva de ' || v_area_name || ' del '
      || to_char(v_res.start_at at time zone v_tz, 'DD/MM/YYYY HH24:MI') || '. Motivo: ' || v_res.cancel_reason);
  end if;
  return v_res;
end;
$$;

create or replace function public.set_area_reservation_status(p_reservation_id uuid, p_status text)
returns public.area_reservations
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_res public.area_reservations;
begin
  select * into v_res from public.area_reservations where id = p_reservation_id for update;
  if not found then
    raise exception 'RESERVATION_NOT_FOUND' using errcode = 'P0002';
  end if;
  perform public.assert_org_permission(v_res.organization_id, 'reservations.write');
  if p_status not in ('completed', 'no_show') or v_res.status <> 'confirmed' or v_res.start_at > now() then
    raise exception 'RESERVATION_NOT_MODIFIABLE' using errcode = 'P0001';
  end if;
  update public.area_reservations set status = p_status where id = p_reservation_id returning * into v_res;
  return v_res;
end;
$$;

revoke execute on function
  public.get_area_slots(uuid, date, integer), public.create_reservation_charge(uuid),
  public.book_area_reservation(uuid, uuid, uuid, uuid, timestamptz, timestamptz, integer, text, text, uuid),
  public.notify_reservation_update(uuid, text), public.decide_area_reservation(uuid, boolean, text),
  public.cancel_area_reservation(uuid, text), public.set_area_reservation_status(uuid, text)
from public, anon, authenticated;

grant execute on function
  public.get_area_slots(uuid, date, integer),
  public.book_area_reservation(uuid, uuid, uuid, uuid, timestamptz, timestamptz, integer, text, text, uuid),
  public.decide_area_reservation(uuid, boolean, text), public.cancel_area_reservation(uuid, text),
  public.set_area_reservation_status(uuid, text)
to authenticated;
