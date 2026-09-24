-- ============================================================
-- Cartera y recaudo (1/3): libro por unidad.
--
-- Modelo de libro por unidad: cargos (débitos) y pagos confirmados
-- (créditos). Saldo = cargos activos - pagos confirmados. Los pagos se
-- aplican FIFO a los cargos más antiguos para calcular vencidos y edades.
-- Toda cifra sale de aquí: ni el frontend ni el LLM calculan saldos.
-- Los cargos nunca se borran: se anulan con motivo (trazabilidad).
-- ============================================================

create or replace function public.org_today(p_organization_id uuid)
returns date
language sql
security definer
stable
set search_path = pg_catalog, public, pg_temp
as $$
  select (now() at time zone coalesce(
    (select timezone from public.organizations where id = p_organization_id), 'America/Bogota'))::date;
$$;

create or replace function public.format_cop(p_amount numeric)
returns text
language sql
immutable
set search_path = pg_catalog, public, pg_temp
as $$
  select '$ ' || replace(to_char(round(coalesce(p_amount, 0)), 'FM999,999,999,999'), ',', '.');
$$;

-- ------------------------------------------------------------
-- charge_concepts
-- ------------------------------------------------------------
create table if not exists public.charge_concepts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  kind text not null default 'ordinary',
  calculation text not null default 'manual',
  amount numeric(14,2) not null default 0,
  applies_to_unit_types text[],
  is_active boolean not null default true,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint charge_concepts_name_check check (length(btrim(name)) between 2 and 80),
  constraint charge_concepts_kind_check
    check (kind in ('ordinary', 'extraordinary', 'fine', 'interest', 'common_area', 'opening_balance', 'other')),
  constraint charge_concepts_calculation_check check (calculation in ('fixed', 'coefficient', 'manual')),
  constraint charge_concepts_amount_check check (amount >= 0),
  constraint charge_concepts_system_kind_check
    check (is_system = (kind in ('interest', 'common_area', 'opening_balance'))),
  constraint charge_concepts_org_name_unique unique (organization_id, name)
);

create unique index if not exists uq_charge_concepts_system_kind
  on public.charge_concepts (organization_id, kind) where is_system;

alter table public.charge_concepts enable row level security;

create trigger trg_charge_concepts_updated_at before update on public.charge_concepts
  for each row execute function system.update_updated_at();
create trigger trg_charge_concepts_immutable_org before update on public.charge_concepts
  for each row execute function public.prevent_organization_change();

create or replace function public.guard_system_concepts()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    if old.is_system and exists (select 1 from public.organizations where id = old.organization_id) then
      raise exception 'Los conceptos del sistema no se eliminan' using errcode = '42501';
    end if;
    return old;
  end if;
  if old.is_system and (new.kind is distinct from old.kind or new.is_system is distinct from old.is_system
     or new.calculation is distinct from old.calculation) then
    raise exception 'Los conceptos del sistema solo admiten cambio de nombre' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger trg_charge_concepts_guard before update or delete on public.charge_concepts
  for each row execute function public.guard_system_concepts();

create policy "charge_concepts_select_member" on public.charge_concepts for select to authenticated
  using (public.is_org_member(organization_id));
create policy "charge_concepts_insert_writer" on public.charge_concepts for insert to authenticated
  with check (public.has_org_permission(organization_id, 'finance.write') and not is_system);
create policy "charge_concepts_update_writer" on public.charge_concepts for update to authenticated
  using (public.has_org_permission(organization_id, 'finance.write'))
  with check (public.has_org_permission(organization_id, 'finance.write'));
-- Un concepto con cargos no se puede borrar (FK restrict): se desactiva.
create policy "charge_concepts_delete_writer" on public.charge_concepts for delete to authenticated
  using (public.has_org_permission(organization_id, 'finance.write'));

-- ------------------------------------------------------------
-- charge_batches: trazabilidad de cada liquidación masiva.
-- ------------------------------------------------------------
create table if not exists public.charge_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null,
  period date not null,
  due_date date not null,
  charges_count integer not null default 0,
  total_amount numeric(14,2) not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint charge_batches_kind_check check (kind in ('monthly', 'interest'))
);

alter table public.charge_batches enable row level security;

create policy "charge_batches_select_reader" on public.charge_batches for select to authenticated
  using (public.has_org_permission(organization_id, 'finance.read'));

-- ------------------------------------------------------------
-- charges: el libro. Inmutable salvo anulación.
-- ------------------------------------------------------------
create table if not exists public.charges (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete restrict,
  concept_id uuid not null references public.charge_concepts(id) on delete restrict,
  period date,
  description text,
  amount numeric(14,2) not null,
  due_date date not null,
  status text not null default 'active',
  void_reason text,
  voided_at timestamptz,
  voided_by uuid,
  source text not null default 'manual',
  batch_id uuid references public.charge_batches(id) on delete set null,
  reservation_id uuid,
  import_batch_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint charges_amount_check check (amount > 0),
  constraint charges_period_check check (period is null or extract(day from period) = 1),
  constraint charges_status_check check (status in ('active', 'voided')),
  constraint charges_void_check check ((status = 'voided') = (voided_at is not null and void_reason is not null)),
  constraint charges_source_check check (source in ('batch', 'manual', 'interest', 'reservation', 'import'))
);

-- Idempotencia de liquidaciones: una cuota periódica por unidad/concepto/mes.
create unique index if not exists uq_charges_periodic
  on public.charges (organization_id, unit_id, concept_id, period)
  where status = 'active' and source in ('batch', 'interest');
-- Un solo saldo inicial activo por unidad.
create unique index if not exists uq_charges_opening_balance
  on public.charges (unit_id) where status = 'active' and source = 'import';
create index if not exists idx_charges_unit_due on public.charges (unit_id, due_date) where status = 'active';
create index if not exists idx_charges_org_due on public.charges (organization_id, due_date);

alter table public.charges enable row level security;

create trigger trg_charges_tenant_refs before insert or update on public.charges
  for each row execute function public.enforce_tenant_refs('unit_id:units', 'concept_id:charge_concepts');

-- El único DELETE permitido a un usuario es el de rollback_import_batch()
-- (saldos iniciales de un lote importado). Este backend gestionado
-- bloquea cambiar la configuración de sesión, así que la habilitación
-- viaja en una tabla temporal propia de esa transacción (ver
-- rollback_import_batch), nunca en una GUC de sesión.
create or replace function public.guard_charge_changes()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    if (select auth.uid()) is not null and to_regclass('pg_temp.import_rollback_ctx') is null then
      raise exception 'Los cargos no se eliminan: se anulan' using errcode = '42501';
    end if;
    return old;
  end if;
  if new.organization_id is distinct from old.organization_id or new.unit_id is distinct from old.unit_id
     or new.concept_id is distinct from old.concept_id or new.period is distinct from old.period
     or new.amount is distinct from old.amount or new.due_date is distinct from old.due_date
     or new.source is distinct from old.source or new.created_at is distinct from old.created_at
     or new.description is distinct from old.description then
    raise exception 'CHARGE_IMMUTABLE: un cargo no se edita, se anula y se crea uno nuevo' using errcode = '42501';
  end if;
  if old.status = 'voided' and new.status <> 'voided' then
    raise exception 'CHARGE_IMMUTABLE: un cargo anulado no se reactiva' using errcode = '42501';
  end if;
  if old.status = 'active' and new.status = 'voided' then
    new.voided_at := coalesce(new.voided_at, now());
    new.voided_by := coalesce(new.voided_by, (select auth.uid()));
  end if;
  return new;
end;
$$;

create trigger trg_charges_guard before update or delete on public.charges
  for each row execute function public.guard_charge_changes();

create policy "charges_select_reader" on public.charges for select to authenticated
  using (public.has_org_permission(organization_id, 'finance.read'));

-- ------------------------------------------------------------
-- payments: registrados por el equipo (confirmados) o reportados por el
-- residente vía chat (pendientes de revisión humana). La IA nunca
-- confirma un pago.
-- ------------------------------------------------------------
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  unit_id uuid references public.units(id) on delete restrict,
  person_id uuid references public.persons(id) on delete set null,
  conversation_id uuid references public.conversations(id) on delete set null,
  amount numeric(14,2),
  paid_on date,
  method text,
  reference text,
  receipt_storage_key text,
  status text not null default 'pending_review',
  source text not null default 'dashboard',
  reported_note text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_note text,
  reversed_by uuid,
  reversed_at timestamptz,
  reversal_reason text,
  import_batch_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payments_amount_check check (amount is null or amount > 0),
  constraint payments_method_check check (method is null or method in
    ('bank_transfer', 'pse', 'cash', 'nequi', 'daviplata', 'card', 'consignment', 'other')),
  constraint payments_status_check check (status in ('pending_review', 'confirmed', 'rejected', 'reversed')),
  constraint payments_source_check check (source in ('dashboard', 'agent', 'import')),
  constraint payments_confirmed_complete check (
    status not in ('confirmed', 'reversed') or (unit_id is not null and amount is not null and paid_on is not null)
  )
);

create index if not exists idx_payments_unit on public.payments (unit_id, status);
create index if not exists idx_payments_org_status on public.payments (organization_id, status, created_at desc);
create index if not exists idx_payments_person on public.payments (person_id);

alter table public.payments enable row level security;

create trigger trg_payments_updated_at before update on public.payments
  for each row execute function system.update_updated_at();
create trigger trg_payments_tenant_refs before insert or update on public.payments
  for each row execute function public.enforce_tenant_refs('unit_id:units', 'person_id:persons', 'conversation_id:conversations');

create or replace function public.guard_payment_changes()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if old.status in ('confirmed', 'reversed') and (
       new.unit_id is distinct from old.unit_id or new.amount is distinct from old.amount
       or new.paid_on is distinct from old.paid_on or new.organization_id is distinct from old.organization_id) then
    raise exception 'PAYMENT_IMMUTABLE: un pago confirmado solo se puede reversar' using errcode = '42501';
  end if;
  if old.status in ('rejected', 'reversed') and new.status <> old.status then
    raise exception 'PAYMENT_IMMUTABLE: estado final' using errcode = '42501';
  end if;
  if old.status = 'confirmed' and new.status not in ('confirmed', 'reversed') then
    raise exception 'PAYMENT_IMMUTABLE: un pago confirmado solo se puede reversar' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger trg_payments_guard before update on public.payments
  for each row execute function public.guard_payment_changes();

create policy "payments_select_reader" on public.payments for select to authenticated
  using (public.has_org_permission(organization_id, 'finance.read'));

revoke all on public.charge_concepts, public.charge_batches, public.charges, public.payments from anon, authenticated;
grant select, insert, delete on public.charge_concepts to authenticated;
grant update (name, calculation, amount, applies_to_unit_types, is_active) on public.charge_concepts to authenticated;
grant select on public.charge_batches, public.charges, public.payments to authenticated;

-- ------------------------------------------------------------
-- Motor del libro: partidas abiertas con aplicación FIFO de pagos.
-- ------------------------------------------------------------
create or replace function public.ledger_open_items(p_organization_id uuid, p_unit_id uuid default null)
returns table (
  unit_id uuid, charge_id uuid, concept_id uuid, concept_name text, concept_kind text,
  description text, period date, due_date date, amount numeric, unpaid numeric
)
language sql
security definer
stable
set search_path = pg_catalog, public, pg_temp
as $$
  with paid as (
    select p.unit_id, sum(p.amount) as total
    from public.payments p
    where p.organization_id = p_organization_id and p.status = 'confirmed'
      and (p_unit_id is null or p.unit_id = p_unit_id)
    group by p.unit_id
  ), ch as (
    select c.unit_id, c.id, c.concept_id, cc.name, cc.kind, c.description, c.period, c.due_date, c.amount,
           sum(c.amount) over (partition by c.unit_id order by c.due_date, c.created_at, c.id) as cum
    from public.charges c
    join public.charge_concepts cc on cc.id = c.concept_id
    where c.organization_id = p_organization_id and c.status = 'active'
      and (p_unit_id is null or c.unit_id = p_unit_id)
  )
  select ch.unit_id, ch.id, ch.concept_id, ch.name, ch.kind, ch.description, ch.period, ch.due_date, ch.amount,
         greatest(0::numeric, least(ch.amount, ch.cum - coalesce(paid.total, 0)))
  from ch
  left join paid on paid.unit_id = ch.unit_id;
$$;

create or replace function public.get_unit_statement(p_unit_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_unit record;
  v_today date;
  v_charged numeric;
  v_paid numeric;
begin
  select u.id, u.organization_id, u.code, u.unit_type, t.name as tower_name
  into v_unit
  from public.units u left join public.towers t on t.id = u.tower_id
  where u.id = p_unit_id;
  if not found then
    raise exception 'UNIT_NOT_FOUND' using errcode = 'P0002';
  end if;
  perform public.assert_org_permission(v_unit.organization_id, 'finance.read');

  v_today := public.org_today(v_unit.organization_id);
  select coalesce(sum(amount), 0) into v_charged from public.charges where unit_id = p_unit_id and status = 'active';
  select coalesce(sum(amount), 0) into v_paid from public.payments where unit_id = p_unit_id and status = 'confirmed';

  return (
    with items as (
      select * from public.ledger_open_items(v_unit.organization_id, p_unit_id) where unpaid > 0
    )
    select jsonb_build_object(
      'unit', jsonb_build_object('id', v_unit.id, 'code', v_unit.code, 'tower', v_unit.tower_name, 'unit_type', v_unit.unit_type),
      'as_of', now(),
      'today', v_today,
      'currency', (select currency from public.property_profiles where organization_id = v_unit.organization_id),
      'total_charged', v_charged,
      'total_paid', v_paid,
      'balance', v_charged - v_paid,
      'credit', greatest(0, v_paid - v_charged),
      'overdue_amount', coalesce((select sum(unpaid) from items where due_date < v_today), 0),
      'current_amount', coalesce((select sum(unpaid) from items where due_date >= v_today), 0),
      'oldest_overdue_due_date', (select min(due_date) from items where due_date < v_today),
      'next_due_date', (select min(due_date) from items where due_date >= v_today),
      'aging', jsonb_build_object(
        'not_due', coalesce((select sum(unpaid) from items where due_date >= v_today), 0),
        'd1_30', coalesce((select sum(unpaid) from items where v_today - due_date between 1 and 30), 0),
        'd31_60', coalesce((select sum(unpaid) from items where v_today - due_date between 31 and 60), 0),
        'd61_90', coalesce((select sum(unpaid) from items where v_today - due_date between 61 and 90), 0),
        'd90_plus', coalesce((select sum(unpaid) from items where v_today - due_date > 90), 0)
      ),
      'open_items', coalesce((
        select jsonb_agg(jsonb_build_object(
          'charge_id', x.charge_id, 'concept', x.concept_name, 'kind', x.concept_kind, 'description', x.description,
          'period', x.period, 'due_date', x.due_date, 'amount', x.amount, 'unpaid', x.unpaid,
          'days_overdue', greatest(0, v_today - x.due_date)
        ) order by x.due_date)
        from (select * from items order by due_date limit 36) x
      ), '[]'::jsonb),
      'recent_payments', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', p.id, 'paid_on', p.paid_on, 'amount', p.amount, 'method', p.method, 'reference', p.reference
        ) order by p.paid_on desc)
        from (
          select * from public.payments
          where unit_id = p_unit_id and status = 'confirmed'
          order by paid_on desc, created_at desc limit 6
        ) p
      ), '[]'::jsonb),
      'pending_reports', (select count(*) from public.payments where unit_id = p_unit_id and status = 'pending_review')
    )
  );
end;
$$;

-- Cartera por edades. Los nombres de propietarios solo se devuelven a
-- quien tiene permiso sobre datos personales.
create or replace function public.get_portfolio(p_organization_id uuid)
returns table (
  unit_id uuid, unit_code text, tower_name text, unit_type text, balance numeric, overdue_amount numeric,
  not_due numeric, d1_30 numeric, d31_60 numeric, d61_90 numeric, d90_plus numeric,
  oldest_overdue_date date, last_payment_on date, owner_names text
)
language plpgsql
security definer
stable
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_today date := public.org_today(p_organization_id);
  v_show_names boolean;
begin
  perform public.assert_org_permission(p_organization_id, 'finance.read');
  v_show_names := (select auth.uid()) is null or public.has_org_permission(p_organization_id, 'residents.read');

  return query
  with items as (
    select * from public.ledger_open_items(p_organization_id) where unpaid > 0
  ), aging as (
    select i.unit_id,
      sum(i.unpaid) filter (where i.due_date < v_today) as overdue,
      sum(i.unpaid) filter (where i.due_date >= v_today) as not_due,
      sum(i.unpaid) filter (where v_today - i.due_date between 1 and 30) as d1_30,
      sum(i.unpaid) filter (where v_today - i.due_date between 31 and 60) as d31_60,
      sum(i.unpaid) filter (where v_today - i.due_date between 61 and 90) as d61_90,
      sum(i.unpaid) filter (where v_today - i.due_date > 90) as d90_plus,
      min(i.due_date) filter (where i.due_date < v_today) as oldest
    from items i group by i.unit_id
  ), charged as (
    select c.unit_id, sum(c.amount) as total from public.charges c
    where c.organization_id = p_organization_id and c.status = 'active' group by c.unit_id
  ), paid as (
    select p.unit_id, sum(p.amount) as total, max(p.paid_on) as last_paid from public.payments p
    where p.organization_id = p_organization_id and p.status = 'confirmed' group by p.unit_id
  )
  select u.id, u.code, t.name, u.unit_type,
    coalesce(charged.total, 0) - coalesce(paid.total, 0),
    coalesce(aging.overdue, 0), coalesce(aging.not_due, 0), coalesce(aging.d1_30, 0), coalesce(aging.d31_60, 0),
    coalesce(aging.d61_90, 0), coalesce(aging.d90_plus, 0), aging.oldest, paid.last_paid,
    case when v_show_names then (
      select string_agg(p.full_name, ', ' order by p.full_name)
      from public.unit_persons up join public.persons p on p.id = up.person_id
      where up.unit_id = u.id and up.relation = 'owner' and (up.ends_on is null or up.ends_on >= v_today)
    ) end
  from public.units u
  left join public.towers t on t.id = u.tower_id
  left join aging on aging.unit_id = u.id
  left join charged on charged.unit_id = u.id
  left join paid on paid.unit_id = u.id
  where u.organization_id = p_organization_id
  order by coalesce(aging.overdue, 0) desc, u.code;
end;
$$;

revoke execute on function
  public.org_today(uuid), public.format_cop(numeric), public.guard_system_concepts(), public.guard_charge_changes(),
  public.guard_payment_changes(), public.ledger_open_items(uuid, uuid), public.get_unit_statement(uuid),
  public.get_portfolio(uuid)
from public, anon, authenticated;

grant execute on function public.org_today(uuid), public.get_unit_statement(uuid), public.get_portfolio(uuid)
to authenticated;
