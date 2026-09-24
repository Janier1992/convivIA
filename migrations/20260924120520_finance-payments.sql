-- ============================================================
-- Cartera y recaudo (3/3): registro y revisión de pagos, reportes del
-- residente por chat y recordatorios de cobro.
-- ============================================================

-- ------------------------------------------------------------
-- Pagos: registro por el equipo, revisión de reportes, reversión.
-- ------------------------------------------------------------
create or replace function public.register_payment(
  p_organization_id uuid, p_unit_id uuid, p_amount numeric, p_paid_on date, p_method text,
  p_reference text default null, p_note text default null, p_receipt_storage_key text default null
)
returns public.payments
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_payment public.payments;
begin
  perform public.assert_org_permission(p_organization_id, 'finance.write');
  if p_amount is null or p_amount <= 0 or p_paid_on is null or p_unit_id is null then
    raise exception 'VALIDATION_ERROR: unidad, valor y fecha son obligatorios' using errcode = '22023';
  end if;
  if p_paid_on > public.org_today(p_organization_id) then
    raise exception 'VALIDATION_ERROR: la fecha de pago no puede ser futura' using errcode = '22023';
  end if;
  insert into public.payments (
    organization_id, unit_id, amount, paid_on, method, reference, receipt_storage_key, status, source,
    reported_note, reviewed_by, reviewed_at, created_by
  ) values (
    p_organization_id, p_unit_id, p_amount, p_paid_on, p_method, nullif(btrim(coalesce(p_reference, '')), ''),
    p_receipt_storage_key, 'confirmed', 'dashboard', p_note, (select auth.uid()), now(), (select auth.uid())
  ) returning * into v_payment;
  return v_payment;
end;
$$;

create or replace function public.review_payment(
  p_payment_id uuid, p_approve boolean, p_unit_id uuid default null, p_amount numeric default null,
  p_paid_on date default null, p_method text default null, p_note text default null
)
returns public.payments
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_payment public.payments;
  v_body text;
begin
  select * into v_payment from public.payments where id = p_payment_id for update;
  if not found then
    raise exception 'PAYMENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  perform public.assert_org_permission(v_payment.organization_id, 'finance.write');
  if v_payment.status <> 'pending_review' then
    raise exception 'PAYMENT_NOT_PENDING' using errcode = 'P0001';
  end if;

  if p_approve then
    update public.payments
    set status = 'confirmed',
        unit_id = coalesce(p_unit_id, unit_id),
        amount = coalesce(p_amount, amount),
        paid_on = coalesce(p_paid_on, paid_on),
        method = coalesce(p_method, method),
        review_note = p_note, reviewed_by = (select auth.uid()), reviewed_at = now()
    where id = p_payment_id
    returning * into v_payment;
    v_body := 'Tu pago por ' || public.format_cop(v_payment.amount) || ' del ' || to_char(v_payment.paid_on, 'DD/MM/YYYY')
              || ' fue verificado y aplicado a tu estado de cuenta. ¡Gracias!';
  else
    if length(btrim(coalesce(p_note, ''))) < 5 then
      raise exception 'VALIDATION_ERROR: indica el motivo del rechazo' using errcode = '22023';
    end if;
    update public.payments
    set status = 'rejected', review_note = btrim(p_note), reviewed_by = (select auth.uid()), reviewed_at = now()
    where id = p_payment_id
    returning * into v_payment;
    v_body := 'No pudimos verificar el pago que reportaste. Motivo: ' || v_payment.review_note
              || '. Si tienes dudas, escríbenos por aquí.';
  end if;

  if v_payment.person_id is not null then
    perform public.enqueue_outbound_to_person(
      v_payment.organization_id, v_payment.person_id, 'system', v_body, null, '{}'::jsonb,
      'payment', v_payment.id, 'payment_review:' || v_payment.id, false, v_payment.conversation_id
    );
  end if;
  return v_payment;
end;
$$;

create or replace function public.reverse_payment(p_payment_id uuid, p_reason text)
returns public.payments
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_payment public.payments;
begin
  select * into v_payment from public.payments where id = p_payment_id for update;
  if not found then
    raise exception 'PAYMENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  perform public.assert_org_permission(v_payment.organization_id, 'finance.write');
  if v_payment.status <> 'confirmed' then
    raise exception 'PAYMENT_NOT_CONFIRMED' using errcode = 'P0001';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'VALIDATION_ERROR: el motivo de reversión es obligatorio' using errcode = '22023';
  end if;
  update public.payments
  set status = 'reversed', reversal_reason = btrim(p_reason), reversed_by = (select auth.uid()), reversed_at = now()
  where id = p_payment_id
  returning * into v_payment;
  return v_payment;
end;
$$;

-- Reporte de pago desde el chat (solo compute service). Si el residente
-- ya había enviado la foto del soporte sin datos, se completa ese reporte.
create or replace function public.report_payment_from_resident(
  p_organization_id uuid, p_person_id uuid, p_unit_id uuid, p_amount numeric, p_paid_on date,
  p_method text, p_reference text, p_note text, p_conversation_id uuid
)
returns public.payments
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_payment public.payments;
begin
  select * into v_payment from public.payments
  where organization_id = p_organization_id and person_id = p_person_id and status = 'pending_review'
    and amount is null and receipt_storage_key is not null and created_at > now() - interval '48 hours'
  order by created_at desc limit 1
  for update;

  if found then
    update public.payments
    set unit_id = p_unit_id, amount = p_amount, paid_on = p_paid_on, method = p_method,
        reference = p_reference, reported_note = p_note, conversation_id = coalesce(p_conversation_id, conversation_id)
    where id = v_payment.id
    returning * into v_payment;
  else
    insert into public.payments (
      organization_id, unit_id, person_id, conversation_id, amount, paid_on, method, reference, reported_note,
      status, source
    ) values (
      p_organization_id, p_unit_id, p_person_id, p_conversation_id, p_amount, p_paid_on, p_method, p_reference,
      p_note, 'pending_review', 'agent'
    ) returning * into v_payment;
  end if;
  return v_payment;
end;
$$;

create or replace function public.attach_payment_receipt(
  p_organization_id uuid, p_person_id uuid, p_conversation_id uuid, p_storage_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_payment public.payments;
  v_finance_units uuid[];
begin
  select * into v_payment from public.payments
  where organization_id = p_organization_id and person_id = p_person_id and status = 'pending_review'
    and receipt_storage_key is null and created_at > now() - interval '48 hours'
  order by created_at desc limit 1
  for update;

  if found then
    update public.payments set receipt_storage_key = p_storage_key where id = v_payment.id;
    return jsonb_build_object('payment_id', v_payment.id, 'created', false, 'has_details', v_payment.amount is not null);
  end if;

  select array_agg(distinct up.unit_id) into v_finance_units
  from public.unit_persons up
  where up.person_id = p_person_id and up.relation in ('owner', 'tenant')
    and (up.ends_on is null or up.ends_on >= current_date);

  insert into public.payments (organization_id, unit_id, person_id, conversation_id, receipt_storage_key, status, source)
  values (
    p_organization_id,
    case when coalesce(array_length(v_finance_units, 1), 0) = 1 then v_finance_units[1] end,
    p_person_id, p_conversation_id, p_storage_key, 'pending_review', 'agent'
  )
  returning * into v_payment;
  return jsonb_build_object('payment_id', v_payment.id, 'created', true, 'has_details', false);
end;
$$;

-- ------------------------------------------------------------
-- Recordatorios de cobro (solo compute service, cada hora). Mensajes
-- privados a propietario/arrendatario; idempotentes por dedupe_key.
-- ------------------------------------------------------------
create or replace function public.enqueue_payment_reminders()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_row record;
  v_count integer := 0;
  v_id uuid;
begin
  for v_row in
    with cfg as (
      select o.id as org_id, public.org_today(o.id) as today, pp.display_name,
             pp.payment_reminder_days_before as days_before, pp.payment_reminder_days_after as days_after
      from public.organizations o
      join public.property_profiles pp on pp.organization_id = o.id
      where o.status = 'active'
    ), items as (
      select cfg.*, li.unit_id, li.due_date, li.unpaid
      from cfg cross join lateral public.ledger_open_items(cfg.org_id) li
      where li.unpaid > 0
    ), due as (
      select org_id, display_name, unit_id, 'before'::text as kind, due_date, sum(unpaid) as amount
      from items where days_before > 0 and due_date = today + days_before
      group by org_id, display_name, unit_id, due_date
      union all
      select i.org_id, i.display_name, i.unit_id, 'after', i.due_date,
             (select sum(x.unpaid) from items x where x.unit_id = i.unit_id and x.due_date < x.today)
      from items i where i.days_after > 0 and i.due_date = i.today - i.days_after
      group by i.org_id, i.display_name, i.unit_id, i.due_date
    )
    select d.*, u.code as unit_code, p.id as person_id, p.full_name
    from due d
    join public.units u on u.id = d.unit_id
    join public.unit_persons up on up.unit_id = d.unit_id and up.relation in ('owner', 'tenant')
      and (up.ends_on is null or up.ends_on >= current_date)
    join public.persons p on p.id = up.person_id
    where d.amount > 0
  loop
    v_id := public.enqueue_outbound_to_person(
      v_row.org_id, v_row.person_id, 'payment_reminder',
      case v_row.kind
        when 'before' then 'Hola ' || split_part(v_row.full_name, ' ', 1) || ', te recordamos que la unidad ' || v_row.unit_code
          || ' de ' || v_row.display_name || ' tiene un valor de ' || public.format_cop(v_row.amount)
          || ' que vence el ' || to_char(v_row.due_date, 'DD/MM/YYYY')
          || '. Si ya pagaste, puedes enviarnos el soporte por aquí.'
        else 'Hola ' || split_part(v_row.full_name, ' ', 1) || ', la unidad ' || v_row.unit_code || ' de ' || v_row.display_name
          || ' registra un saldo vencido de ' || public.format_cop(v_row.amount)
          || '. Si ya pagaste, envíanos el soporte por aquí para registrarlo.'
      end,
      'payment_reminder',
      jsonb_build_object('1', split_part(v_row.full_name, ' ', 1), '2', v_row.display_name, '3', v_row.unit_code,
                         '4', public.format_cop(v_row.amount), '5', to_char(v_row.due_date, 'DD/MM/YYYY')),
      'unit', v_row.unit_id,
      'payment_reminder:' || v_row.kind || ':' || v_row.unit_id || ':' || v_row.due_date || ':' || v_row.person_id,
      true
    );
    if v_id is not null then
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

revoke execute on function
  public.register_payment(uuid, uuid, numeric, date, text, text, text, text),
  public.review_payment(uuid, boolean, uuid, numeric, date, text, text), public.reverse_payment(uuid, text),
  public.report_payment_from_resident(uuid, uuid, uuid, numeric, date, text, text, text, uuid),
  public.attach_payment_receipt(uuid, uuid, uuid, text), public.enqueue_payment_reminders()
from public, anon, authenticated;

grant execute on function
  public.register_payment(uuid, uuid, numeric, date, text, text, text, text),
  public.review_payment(uuid, boolean, uuid, numeric, date, text, text), public.reverse_payment(uuid, text)
to authenticated;
