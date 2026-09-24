-- ============================================================
-- PQRS: peticiones, quejas, reclamos, sugerencias y felicitaciones.
-- Radicado único por año, SLA por categoría, flujo de estados validado e
-- historial append-only. La IA puede clasificar y redactar; la plataforma
-- mantiene el control transaccional.
-- ============================================================

create table if not exists public.pqrs_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  sla_hours integer not null default 72,
  is_active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pqrs_categories_name_check check (length(btrim(name)) between 2 and 80),
  constraint pqrs_categories_sla_check check (sla_hours between 1 and 2160),
  constraint pqrs_categories_org_name_unique unique (organization_id, name)
);

alter table public.pqrs_categories enable row level security;

create trigger trg_pqrs_categories_updated_at before update on public.pqrs_categories
  for each row execute function system.update_updated_at();
create trigger trg_pqrs_categories_immutable_org before update on public.pqrs_categories
  for each row execute function public.prevent_organization_change();

create policy "pqrs_categories_select_member" on public.pqrs_categories for select to authenticated
  using (public.is_org_member(organization_id));
create policy "pqrs_categories_insert_writer" on public.pqrs_categories for insert to authenticated
  with check (public.has_org_permission(organization_id, 'settings.manage'));
create policy "pqrs_categories_update_writer" on public.pqrs_categories for update to authenticated
  using (public.has_org_permission(organization_id, 'settings.manage'))
  with check (public.has_org_permission(organization_id, 'settings.manage'));

revoke all on public.pqrs_categories from anon, authenticated;
grant select, insert on public.pqrs_categories to authenticated;
grant update (name, sla_hours, is_active, sort_order) on public.pqrs_categories to authenticated;

create table if not exists public.pqrs_tickets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  radicado text not null,
  ticket_type text not null default 'peticion',
  category_id uuid references public.pqrs_categories(id) on delete set null,
  subject text not null,
  description text not null,
  priority text not null default 'normal',
  status text not null default 'received',
  unit_id uuid references public.units(id) on delete set null,
  requester_person_id uuid references public.persons(id) on delete set null,
  requester_name text,
  requester_contact text,
  requester_verified boolean not null default false,
  channel text not null,
  conversation_id uuid references public.conversations(id) on delete set null,
  assigned_to uuid references auth.users(id) on delete set null,
  due_at timestamptz,
  first_response_at timestamptz,
  answered_at timestamptz,
  closed_at timestamptz,
  response text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pqrs_tickets_type_check
    check (ticket_type in ('peticion', 'queja', 'reclamo', 'sugerencia', 'felicitacion')),
  constraint pqrs_tickets_subject_check check (length(btrim(subject)) between 3 and 160),
  constraint pqrs_tickets_description_check check (length(btrim(description)) between 3 and 4000),
  constraint pqrs_tickets_priority_check check (priority in ('low', 'normal', 'high', 'urgent')),
  constraint pqrs_tickets_status_check
    check (status in ('received', 'classified', 'assigned', 'in_progress', 'waiting_info', 'answered', 'closed')),
  constraint pqrs_tickets_channel_check
    check (channel in ('telegram', 'whatsapp', 'web', 'dashboard', 'email', 'in_person', 'phone')),
  constraint pqrs_tickets_org_radicado_unique unique (organization_id, radicado)
);

create index if not exists idx_pqrs_tickets_org_status on public.pqrs_tickets (organization_id, status, due_at);
create index if not exists idx_pqrs_tickets_person on public.pqrs_tickets (requester_person_id);
create index if not exists idx_pqrs_tickets_conversation on public.pqrs_tickets (conversation_id);

alter table public.pqrs_tickets enable row level security;

create trigger trg_pqrs_tickets_updated_at before update on public.pqrs_tickets
  for each row execute function system.update_updated_at();
create trigger trg_pqrs_tickets_immutable_org before update on public.pqrs_tickets
  for each row execute function public.prevent_organization_change();
create trigger trg_pqrs_tickets_tenant_refs before insert or update on public.pqrs_tickets
  for each row execute function public.enforce_tenant_refs(
    'category_id:pqrs_categories', 'unit_id:units', 'requester_person_id:persons', 'conversation_id:conversations');

create policy "pqrs_tickets_select_reader" on public.pqrs_tickets for select to authenticated
  using (public.has_org_permission(organization_id, 'pqrs.read'));

revoke all on public.pqrs_tickets from anon, authenticated;
grant select on public.pqrs_tickets to authenticated;

create table if not exists public.pqrs_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  ticket_id uuid not null references public.pqrs_tickets(id) on delete cascade,
  event_type text not null,
  from_status text,
  to_status text,
  body text,
  actor_kind text not null default 'staff',
  actor_user_id uuid,
  created_at timestamptz not null default now(),
  constraint pqrs_events_type_check check (event_type in
    ('created', 'status_changed', 'assigned', 'priority_changed', 'category_changed', 'internal_note', 'public_response')),
  constraint pqrs_events_actor_check check (actor_kind in ('staff', 'resident', 'agent', 'system'))
);

create index if not exists idx_pqrs_events_ticket on public.pqrs_events (ticket_id, created_at);

alter table public.pqrs_events enable row level security;

create policy "pqrs_events_select_reader" on public.pqrs_events for select to authenticated
  using (public.has_org_permission(organization_id, 'pqrs.read'));

revoke all on public.pqrs_events from anon, authenticated;
grant select on public.pqrs_events to authenticated;

-- ------------------------------------------------------------
-- RPCs
-- ------------------------------------------------------------
create or replace function public.create_pqrs_ticket(
  p_organization_id uuid,
  p_ticket_type text,
  p_category_id uuid,
  p_subject text,
  p_description text,
  p_priority text default 'normal',
  p_unit_id uuid default null,
  p_requester_person_id uuid default null,
  p_requester_name text default null,
  p_requester_contact text default null,
  p_channel text default 'dashboard',
  p_conversation_id uuid default null,
  p_actor_kind text default 'staff'
)
returns public.pqrs_tickets
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_ticket public.pqrs_tickets;
  v_sla integer;
  v_year text := to_char(now() at time zone coalesce(
    (select timezone from public.organizations where id = p_organization_id), 'America/Bogota'), 'YYYY');
  v_requester_name text := nullif(btrim(coalesce(p_requester_name, '')), '');
  -- Un usuario del panel siempre queda registrado como 'staff'.
  v_actor_kind text := case when (select auth.uid()) is not null then 'staff' else coalesce(p_actor_kind, 'system') end;
begin
  perform public.assert_org_permission(p_organization_id, 'pqrs.write');
  perform public.set_audit_actor(v_actor_kind);

  if p_category_id is not null then
    select sla_hours into v_sla from public.pqrs_categories
    where id = p_category_id and organization_id = p_organization_id and is_active;
    if v_sla is null then
      raise exception 'CATEGORY_NOT_FOUND' using errcode = 'P0002';
    end if;
  end if;

  if p_requester_person_id is not null and v_requester_name is null then
    select full_name into v_requester_name from public.persons
    where id = p_requester_person_id and organization_id = p_organization_id;
  end if;

  insert into public.pqrs_tickets (
    organization_id, radicado, ticket_type, category_id, subject, description, priority, unit_id,
    requester_person_id, requester_name, requester_contact, requester_verified, channel, conversation_id,
    due_at, created_by
  ) values (
    p_organization_id,
    'PQRS-' || v_year || '-' || lpad(public.next_org_counter(p_organization_id, 'pqrs:' || v_year)::text, 5, '0'),
    coalesce(p_ticket_type, 'peticion'), p_category_id, btrim(p_subject), btrim(p_description),
    coalesce(p_priority, 'normal'), p_unit_id, p_requester_person_id, v_requester_name,
    nullif(btrim(coalesce(p_requester_contact, '')), ''), p_requester_person_id is not null,
    coalesce(p_channel, 'dashboard'), p_conversation_id,
    now() + make_interval(hours => coalesce(v_sla, 72)), (select auth.uid())
  ) returning * into v_ticket;

  insert into public.pqrs_events (organization_id, ticket_id, event_type, to_status, body, actor_kind, actor_user_id)
  values (p_organization_id, v_ticket.id, 'created', v_ticket.status, null, v_actor_kind, (select auth.uid()));

  return v_ticket;
end;
$$;

create or replace function public.update_pqrs_ticket(
  p_ticket_id uuid,
  p_status text default null,
  p_priority text default null,
  p_assigned_to uuid default null,
  p_category_id uuid default null,
  p_note text default null
)
returns public.pqrs_tickets
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_ticket public.pqrs_tickets;
  v_new_status text;
  v_sla integer;
  v_actor uuid := (select auth.uid());
begin
  select * into v_ticket from public.pqrs_tickets where id = p_ticket_id for update;
  if not found then
    raise exception 'PQRS_NOT_FOUND' using errcode = 'P0002';
  end if;
  perform public.assert_org_permission(v_ticket.organization_id, 'pqrs.write');

  v_new_status := coalesce(p_status, v_ticket.status);
  if p_assigned_to is not null and p_status is null and v_ticket.status in ('received', 'classified') then
    v_new_status := 'assigned';
  end if;
  if v_new_status not in ('classified', 'assigned', 'in_progress', 'waiting_info', 'closed', 'answered', 'received') then
    raise exception 'VALIDATION_ERROR: estado inválido' using errcode = '22023';
  end if;
  if v_new_status <> v_ticket.status then
    if v_new_status = 'received' then
      raise exception 'VALIDATION_ERROR: una PQRS no vuelve a "recibida"' using errcode = '22023';
    end if;
    if v_new_status = 'answered' then
      raise exception 'VALIDATION_ERROR: use respond_pqrs_ticket para responder' using errcode = '22023';
    end if;
    if v_ticket.status = 'closed' and v_new_status <> 'in_progress' then
      raise exception 'PQRS_CLOSED: solo se puede reabrir a "en gestión"' using errcode = 'P0001';
    end if;
    if v_new_status = 'closed' and v_ticket.answered_at is null and length(btrim(coalesce(p_note, ''))) < 5 then
      raise exception 'VALIDATION_ERROR: para cerrar sin respuesta indica el motivo' using errcode = '22023';
    end if;
  end if;

  if p_assigned_to is not null and not exists (
    select 1 from public.organization_members where organization_id = v_ticket.organization_id and user_id = p_assigned_to
  ) then
    raise exception 'VALIDATION_ERROR: el responsable no pertenece al equipo' using errcode = '22023';
  end if;

  if p_category_id is not null and p_category_id is distinct from v_ticket.category_id then
    select sla_hours into v_sla from public.pqrs_categories
    where id = p_category_id and organization_id = v_ticket.organization_id and is_active;
    if v_sla is null then
      raise exception 'CATEGORY_NOT_FOUND' using errcode = 'P0002';
    end if;
    insert into public.pqrs_events (organization_id, ticket_id, event_type, actor_kind, actor_user_id)
    values (v_ticket.organization_id, p_ticket_id, 'category_changed', 'staff', v_actor);
  end if;

  if p_priority is not null and p_priority is distinct from v_ticket.priority then
    insert into public.pqrs_events (organization_id, ticket_id, event_type, body, actor_kind, actor_user_id)
    values (v_ticket.organization_id, p_ticket_id, 'priority_changed', p_priority, 'staff', v_actor);
  end if;

  if p_assigned_to is not null and p_assigned_to is distinct from v_ticket.assigned_to then
    insert into public.pqrs_events (organization_id, ticket_id, event_type, body, actor_kind, actor_user_id)
    values (v_ticket.organization_id, p_ticket_id, 'assigned', p_assigned_to::text, 'staff', v_actor);
  end if;

  if v_new_status <> v_ticket.status then
    insert into public.pqrs_events (organization_id, ticket_id, event_type, from_status, to_status, body, actor_kind, actor_user_id)
    values (v_ticket.organization_id, p_ticket_id, 'status_changed', v_ticket.status, v_new_status,
            nullif(btrim(coalesce(p_note, '')), ''), 'staff', v_actor);
  elsif length(btrim(coalesce(p_note, ''))) > 0 then
    insert into public.pqrs_events (organization_id, ticket_id, event_type, body, actor_kind, actor_user_id)
    values (v_ticket.organization_id, p_ticket_id, 'internal_note', btrim(p_note), 'staff', v_actor);
  end if;

  update public.pqrs_tickets
  set status = v_new_status,
      priority = coalesce(p_priority, priority),
      assigned_to = coalesce(p_assigned_to, assigned_to),
      category_id = coalesce(p_category_id, category_id),
      due_at = case when v_sla is not null then created_at + make_interval(hours => v_sla) else due_at end,
      closed_at = case when v_new_status = 'closed' then coalesce(closed_at, now())
                       when v_new_status <> 'closed' then null else closed_at end
  where id = p_ticket_id
  returning * into v_ticket;
  return v_ticket;
end;
$$;

create or replace function public.respond_pqrs_ticket(p_ticket_id uuid, p_response text, p_close boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_ticket public.pqrs_tickets;
  v_event_id uuid;
  v_property_name text;
  v_outbound uuid;
  v_new_status text := case when p_close then 'closed' else 'answered' end;
begin
  select * into v_ticket from public.pqrs_tickets where id = p_ticket_id for update;
  if not found then
    raise exception 'PQRS_NOT_FOUND' using errcode = 'P0002';
  end if;
  perform public.assert_org_permission(v_ticket.organization_id, 'pqrs.write');
  if length(btrim(coalesce(p_response, ''))) < 5 then
    raise exception 'VALIDATION_ERROR: la respuesta es muy corta' using errcode = '22023';
  end if;

  insert into public.pqrs_events (organization_id, ticket_id, event_type, from_status, to_status, body, actor_kind, actor_user_id)
  values (v_ticket.organization_id, p_ticket_id, 'public_response', v_ticket.status, v_new_status, btrim(p_response),
          'staff', (select auth.uid()))
  returning id into v_event_id;

  update public.pqrs_tickets
  set status = v_new_status, response = btrim(p_response), answered_at = now(),
      first_response_at = coalesce(first_response_at, now()),
      closed_at = case when p_close then now() else null end
  where id = p_ticket_id
  returning * into v_ticket;

  select display_name into v_property_name from public.property_profiles where organization_id = v_ticket.organization_id;

  v_outbound := public.enqueue_outbound_to_person(
    v_ticket.organization_id, v_ticket.requester_person_id, 'pqrs_update',
    'Respuesta de la administración a tu solicitud ' || v_ticket.radicado || ' (' || v_ticket.subject || E'):\n\n'
      || btrim(p_response),
    'pqrs_update',
    jsonb_build_object('1', split_part(coalesce(v_ticket.requester_name, 'residente'), ' ', 1), '2', v_ticket.radicado,
                       '3', coalesce(v_property_name, '')),
    'pqrs', v_ticket.id, 'pqrs_response:' || v_event_id, false, v_ticket.conversation_id
  );

  return jsonb_build_object('ticket', to_jsonb(v_ticket), 'notified', v_outbound is not null);
end;
$$;

revoke execute on function
  public.create_pqrs_ticket(uuid, text, uuid, text, text, text, uuid, uuid, text, text, text, uuid, text),
  public.update_pqrs_ticket(uuid, text, text, uuid, uuid, text),
  public.respond_pqrs_ticket(uuid, text, boolean)
from public, anon, authenticated;

grant execute on function
  public.create_pqrs_ticket(uuid, text, uuid, text, text, text, uuid, uuid, text, text, text, uuid, text),
  public.update_pqrs_ticket(uuid, text, text, uuid, uuid, text),
  public.respond_pqrs_ticket(uuid, text, boolean)
to authenticated;
