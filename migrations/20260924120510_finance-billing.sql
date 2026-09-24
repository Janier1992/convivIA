-- ============================================================
-- Cartera y recaudo (2/3): liquidación mensual, intereses de mora,
-- cargos manuales y anulaciones. Todo con vista previa e idempotencia.
-- ============================================================

-- ------------------------------------------------------------
-- Liquidación mensual (idempotente) con vista previa.
-- ------------------------------------------------------------
create or replace function public.compute_monthly_charges(p_organization_id uuid, p_period date)
returns table (unit_id uuid, unit_code text, concept_id uuid, concept_name text, amount numeric, already_exists boolean)
language sql
security definer
stable
set search_path = pg_catalog, public, pg_temp
as $$
  with pp as (
    select coalesce(rounding_unit, 1) as ru from public.property_profiles where organization_id = p_organization_id
  ), raw as (
    select u.id as unit_id, u.code, cc.id as concept_id, cc.name,
      (round(
        (case cc.calculation when 'fixed' then cc.amount else cc.amount * u.coefficient_pct / 100 end) / pp.ru
      ) * pp.ru)::numeric(14,2) as amount
    from public.units u
    cross join public.charge_concepts cc
    cross join pp
    where u.organization_id = p_organization_id and u.is_active
      and cc.organization_id = p_organization_id and cc.is_active and not cc.is_system
      and cc.calculation in ('fixed', 'coefficient') and cc.amount > 0
      and (cc.applies_to_unit_types is null or u.unit_type = any (cc.applies_to_unit_types))
  )
  select r.unit_id, r.code, r.concept_id, r.name, r.amount,
    exists (
      select 1 from public.charges c
      where c.unit_id = r.unit_id and c.concept_id = r.concept_id
        and c.period = date_trunc('month', p_period)::date and c.status = 'active' and c.source = 'batch'
    )
  from raw r
  where r.amount > 0;
$$;

create or replace function public.preview_monthly_charges(p_organization_id uuid, p_period date)
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public, pg_temp
as $$
begin
  perform public.assert_org_permission(p_organization_id, 'finance.write');
  return (
    with rows as (select * from public.compute_monthly_charges(p_organization_id, p_period))
    select jsonb_build_object(
      'period', date_trunc('month', p_period)::date,
      'new_count', (select count(*) from rows where not already_exists),
      'existing_count', (select count(*) from rows where already_exists),
      'new_total', coalesce((select sum(amount) from rows where not already_exists), 0),
      'coefficient_sum', (select coalesce(sum(coefficient_pct), 0) from public.units
                          where organization_id = p_organization_id and is_active),
      'active_units', (select count(*) from public.units where organization_id = p_organization_id and is_active),
      'rows', coalesce((
        select jsonb_agg(jsonb_build_object('unit_code', r.unit_code, 'concept', r.concept_name,
                                            'amount', r.amount, 'already_exists', r.already_exists)
                         order by r.unit_code, r.concept_name)
        from (select * from rows order by unit_code, concept_name limit 2000) r
      ), '[]'::jsonb)
    )
  );
end;
$$;

create or replace function public.generate_monthly_charges(p_organization_id uuid, p_period date, p_due_date date)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_period date := date_trunc('month', p_period)::date;
  v_batch_id uuid;
  v_created integer;
  v_total numeric;
begin
  perform public.assert_org_permission(p_organization_id, 'finance.write');
  if p_due_date is null or p_due_date < v_period then
    raise exception 'VALIDATION_ERROR: la fecha de vencimiento debe ser igual o posterior al inicio del periodo' using errcode = '22023';
  end if;

  insert into public.charge_batches (organization_id, kind, period, due_date, created_by)
  values (p_organization_id, 'monthly', v_period, p_due_date, (select auth.uid()))
  returning id into v_batch_id;

  insert into public.charges (organization_id, unit_id, concept_id, period, description, amount, due_date, source, batch_id, created_by)
  select p_organization_id, m.unit_id, m.concept_id, v_period,
         m.concept_name || ' ' || to_char(v_period, 'MM/YYYY'), m.amount, p_due_date, 'batch', v_batch_id, (select auth.uid())
  from public.compute_monthly_charges(p_organization_id, v_period) m
  where not m.already_exists
  on conflict (organization_id, unit_id, concept_id, period) where status = 'active' and source in ('batch', 'interest')
  do nothing;
  get diagnostics v_created = row_count;

  if v_created = 0 then
    delete from public.charge_batches where id = v_batch_id;
    return jsonb_build_object('batch_id', null, 'created', 0, 'total_amount', 0);
  end if;

  select coalesce(sum(amount), 0) into v_total from public.charges where batch_id = v_batch_id;
  update public.charge_batches set charges_count = v_created, total_amount = v_total where id = v_batch_id;
  return jsonb_build_object('batch_id', v_batch_id, 'created', v_created, 'total_amount', v_total);
end;
$$;

-- ------------------------------------------------------------
-- Intereses de mora: tasa mensual configurada sobre el saldo vencido a la
-- fecha de corte, excluyendo intereses previos (sin interés sobre interés).
-- Cálculo simplificado y explícito; la administración lo verifica en la
-- vista previa contra su reglamento antes de liquidar.
-- ------------------------------------------------------------
create or replace function public.compute_interest_charges(p_organization_id uuid, p_period date, p_cutoff date)
returns table (unit_id uuid, unit_code text, base_amount numeric, monthly_rate numeric, amount numeric, already_exists boolean)
language sql
security definer
stable
set search_path = pg_catalog, public, pg_temp
as $$
  with pp as (
    select late_interest_monthly_rate as rate from public.property_profiles where organization_id = p_organization_id
  ), interest_concept as (
    select id from public.charge_concepts where organization_id = p_organization_id and kind = 'interest' and is_system
  ), base as (
    select li.unit_id, sum(li.unpaid) as base
    from public.ledger_open_items(p_organization_id) li
    where li.unpaid > 0 and li.due_date < p_cutoff and li.concept_kind <> 'interest'
    group by li.unit_id
  )
  select b.unit_id, u.code, b.base, pp.rate, round(b.base * pp.rate / 100)::numeric(14,2),
    exists (
      select 1 from public.charges c, interest_concept ic
      where c.unit_id = b.unit_id and c.concept_id = ic.id and c.period = date_trunc('month', p_period)::date
        and c.status = 'active' and c.source = 'interest'
    )
  from base b
  join public.units u on u.id = b.unit_id
  cross join pp
  where pp.rate > 0 and round(b.base * pp.rate / 100) >= 1;
$$;

create or replace function public.preview_interest_charges(p_organization_id uuid, p_period date, p_cutoff date)
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public, pg_temp
as $$
begin
  perform public.assert_org_permission(p_organization_id, 'finance.write');
  return (
    with rows as (select * from public.compute_interest_charges(p_organization_id, p_period, p_cutoff))
    select jsonb_build_object(
      'period', date_trunc('month', p_period)::date,
      'cutoff', p_cutoff,
      'monthly_rate', (select late_interest_monthly_rate from public.property_profiles where organization_id = p_organization_id),
      'new_count', (select count(*) from rows where not already_exists),
      'new_total', coalesce((select sum(amount) from rows where not already_exists), 0),
      'rows', coalesce((
        select jsonb_agg(jsonb_build_object('unit_code', r.unit_code, 'base_amount', r.base_amount,
                                            'amount', r.amount, 'already_exists', r.already_exists)
                         order by r.unit_code)
        from rows r
      ), '[]'::jsonb)
    )
  );
end;
$$;

create or replace function public.generate_interest_charges(
  p_organization_id uuid, p_period date, p_cutoff date, p_due_date date
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_period date := date_trunc('month', p_period)::date;
  v_concept_id uuid;
  v_batch_id uuid;
  v_created integer;
  v_total numeric;
begin
  perform public.assert_org_permission(p_organization_id, 'finance.write');
  if p_cutoff is null or p_due_date is null then
    raise exception 'VALIDATION_ERROR: fecha de corte y vencimiento son obligatorias' using errcode = '22023';
  end if;
  select id into v_concept_id from public.charge_concepts
  where organization_id = p_organization_id and kind = 'interest' and is_system;
  if v_concept_id is null then
    raise exception 'CONCEPT_NOT_FOUND: falta el concepto de intereses' using errcode = 'P0002';
  end if;

  insert into public.charge_batches (organization_id, kind, period, due_date, created_by)
  values (p_organization_id, 'interest', v_period, p_due_date, (select auth.uid()))
  returning id into v_batch_id;

  insert into public.charges (organization_id, unit_id, concept_id, period, description, amount, due_date, source, batch_id, created_by)
  select p_organization_id, i.unit_id, v_concept_id, v_period,
         'Intereses de mora ' || to_char(v_period, 'MM/YYYY') || ' (' || i.monthly_rate || '% sobre ' || public.format_cop(i.base_amount) || ')',
         i.amount, p_due_date, 'interest', v_batch_id, (select auth.uid())
  from public.compute_interest_charges(p_organization_id, v_period, p_cutoff) i
  where not i.already_exists
  on conflict (organization_id, unit_id, concept_id, period) where status = 'active' and source in ('batch', 'interest')
  do nothing;
  get diagnostics v_created = row_count;

  if v_created = 0 then
    delete from public.charge_batches where id = v_batch_id;
    return jsonb_build_object('batch_id', null, 'created', 0, 'total_amount', 0);
  end if;

  select coalesce(sum(amount), 0) into v_total from public.charges where batch_id = v_batch_id;
  update public.charge_batches set charges_count = v_created, total_amount = v_total where id = v_batch_id;
  return jsonb_build_object('batch_id', v_batch_id, 'created', v_created, 'total_amount', v_total);
end;
$$;

-- ------------------------------------------------------------
-- Cargos manuales y anulación
-- ------------------------------------------------------------
create or replace function public.create_manual_charge(
  p_organization_id uuid, p_unit_id uuid, p_concept_id uuid, p_amount numeric, p_due_date date, p_description text default null
)
returns public.charges
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_charge public.charges;
begin
  perform public.assert_org_permission(p_organization_id, 'finance.write');
  if not exists (
    select 1 from public.charge_concepts
    where id = p_concept_id and organization_id = p_organization_id and is_active and not is_system
  ) then
    raise exception 'CONCEPT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'VALIDATION_ERROR: el valor debe ser mayor que cero' using errcode = '22023';
  end if;

  insert into public.charges (organization_id, unit_id, concept_id, description, amount, due_date, source, created_by)
  values (p_organization_id, p_unit_id, p_concept_id, nullif(btrim(coalesce(p_description, '')), ''), p_amount,
          coalesce(p_due_date, public.org_today(p_organization_id)), 'manual', (select auth.uid()))
  returning * into v_charge;
  return v_charge;
end;
$$;

create or replace function public.void_charge(p_charge_id uuid, p_reason text)
returns public.charges
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_charge public.charges;
begin
  select * into v_charge from public.charges where id = p_charge_id for update;
  if not found then
    raise exception 'CHARGE_NOT_FOUND' using errcode = 'P0002';
  end if;
  perform public.assert_org_permission(v_charge.organization_id, 'finance.write');
  if v_charge.status <> 'active' then
    raise exception 'CHARGE_ALREADY_VOIDED' using errcode = 'P0001';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'VALIDATION_ERROR: el motivo de anulación es obligatorio' using errcode = '22023';
  end if;
  update public.charges set status = 'voided', void_reason = btrim(p_reason)
  where id = p_charge_id returning * into v_charge;
  return v_charge;
end;
$$;

revoke execute on function
  public.compute_monthly_charges(uuid, date), public.preview_monthly_charges(uuid, date),
  public.generate_monthly_charges(uuid, date, date), public.compute_interest_charges(uuid, date, date),
  public.preview_interest_charges(uuid, date, date), public.generate_interest_charges(uuid, date, date, date),
  public.create_manual_charge(uuid, uuid, uuid, numeric, date, text), public.void_charge(uuid, text)
from public, anon, authenticated;

grant execute on function
  public.preview_monthly_charges(uuid, date), public.generate_monthly_charges(uuid, date, date),
  public.preview_interest_charges(uuid, date, date), public.generate_interest_charges(uuid, date, date, date),
  public.create_manual_charge(uuid, uuid, uuid, numeric, date, text), public.void_charge(uuid, text)
to authenticated;
