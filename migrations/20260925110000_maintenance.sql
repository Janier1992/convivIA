-- ============================================================
-- Mantenimiento de activos (sección 4.8 del prompt maestro): ascensores,
-- bombas de agua, plantas eléctricas, portones, equipos de piscina, etc.
-- Hoy cualquier daño se coordina por WhatsApp sin trazabilidad ni
-- historial de garantías; este módulo agrega el flujo completo:
--   reporte -> diagnóstico -> aprobación -> asignación -> ejecución ->
--   evidencia -> validación -> cierre
-- El reporte inicial puede venir de una PQRS ya existente (categoría
-- "Mantenimiento", enlazada por pqrs_ticket_id) para no duplicar la
-- entrada; también se puede reportar directo desde este módulo.
-- Sigue exactamente las convenciones de foundation.sql / pqrs.sql /
-- gatehouse.sql: RLS activo, SECURITY DEFINER con search_path fijo,
-- assert_org_permission() como guarda de cada RPC de escritura, e
-- historial append-only (work_order_events, mismo patrón que
-- pqrs_events).
--
-- Dos permisos, no uno: 'maintenance.write' es la operación del día a
-- día (reportar, diagnosticar, asignar, ejecutar, adjuntar evidencia);
-- 'maintenance.approve' es el checkpoint de aprobación de gasto y de
-- validación final antes de cerrar, coherente con cómo opera en la
-- práctica una copropiedad (el consejo aprueba y valida, el equipo
-- operativo ejecuta) — igual que 'assembly.*' ya separa gobierno de
-- operación.
-- ============================================================

-- ------------------------------------------------------------
-- vendors: proveedores externos de mantenimiento.
-- ------------------------------------------------------------
create table if not exists public.vendors (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  specialty text,
  phone text,
  email text,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vendors_name_check check (length(btrim(name)) between 2 and 120)
);

create index if not exists idx_vendors_org_active on public.vendors (organization_id, is_active);

alter table public.vendors enable row level security;

create trigger trg_vendors_updated_at before update on public.vendors
  for each row execute function system.update_updated_at();
create trigger trg_vendors_immutable_org before update on public.vendors
  for each row execute function public.prevent_organization_change();

create policy "vendors_select_reader" on public.vendors for select to authenticated
  using (public.has_org_permission(organization_id, 'maintenance.read'));

revoke all on public.vendors from anon, authenticated;
grant select on public.vendors to authenticated;

-- ------------------------------------------------------------
-- assets: activos físicos de la copropiedad, con garantía si aplica.
-- ------------------------------------------------------------
create table if not exists public.assets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  category text not null default 'other',
  location text,
  installed_on date,
  warranty_expires_on date,
  status text not null default 'active',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint assets_name_check check (length(btrim(name)) between 2 and 120),
  constraint assets_category_check
    check (category in ('elevator', 'water_pump', 'generator', 'gate', 'pool_equipment', 'fire_safety', 'electrical', 'other')),
  constraint assets_status_check check (status in ('active', 'retired'))
);

create index if not exists idx_assets_org_status on public.assets (organization_id, status);
create index if not exists idx_assets_warranty on public.assets (organization_id, warranty_expires_on) where warranty_expires_on is not null;

alter table public.assets enable row level security;

create trigger trg_assets_updated_at before update on public.assets
  for each row execute function system.update_updated_at();
create trigger trg_assets_immutable_org before update on public.assets
  for each row execute function public.prevent_organization_change();

create policy "assets_select_reader" on public.assets for select to authenticated
  using (public.has_org_permission(organization_id, 'maintenance.read'));

revoke all on public.assets from anon, authenticated;
grant select on public.assets to authenticated;

-- ------------------------------------------------------------
-- maintenance_schedules: mantenimiento preventivo recurrente por activo
-- (ej. "revisión mensual del ascensor"). Es un recordatorio con fecha
-- próxima; no genera la orden de trabajo sola — el equipo la crea desde
-- acá con un clic cuando corresponde (mark_maintenance_schedule_done
-- adelanta la próxima fecha una vez ejecutada).
-- ------------------------------------------------------------
create table if not exists public.maintenance_schedules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  asset_id uuid references public.assets(id) on delete cascade,
  title text not null,
  frequency_months integer not null,
  next_due_on date not null,
  last_done_on date,
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint maintenance_schedules_title_check check (length(btrim(title)) between 3 and 160),
  constraint maintenance_schedules_frequency_check check (frequency_months between 1 and 60)
);

create index if not exists idx_maint_schedules_org_due on public.maintenance_schedules (organization_id, next_due_on) where is_active;

alter table public.maintenance_schedules enable row level security;

create trigger trg_maint_schedules_updated_at before update on public.maintenance_schedules
  for each row execute function system.update_updated_at();
create trigger trg_maint_schedules_immutable_org before update on public.maintenance_schedules
  for each row execute function public.prevent_organization_change();
create trigger trg_maint_schedules_tenant_refs before insert or update on public.maintenance_schedules
  for each row execute function public.enforce_tenant_refs('asset_id:assets');

create policy "maint_schedules_select_reader" on public.maintenance_schedules for select to authenticated
  using (public.has_org_permission(organization_id, 'maintenance.read'));

revoke all on public.maintenance_schedules from anon, authenticated;
grant select on public.maintenance_schedules to authenticated;

-- ------------------------------------------------------------
-- work_orders: el flujo completo. pqrs_ticket_id enlaza con un PQRS ya
-- existente (categoría "Mantenimiento") para no duplicar la entrada; el
-- índice único parcial evita enlazar dos órdenes al mismo PQRS. Los dos
-- módulos quedan desacoplados a propósito: crear la orden no cambia el
-- estado de la PQRS ni viceversa, cada uno se gestiona por su cuenta y
-- el vínculo solo sirve para navegar entre ambos.
-- ------------------------------------------------------------
create table if not exists public.work_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  code text not null,
  asset_id uuid references public.assets(id) on delete set null,
  pqrs_ticket_id uuid references public.pqrs_tickets(id) on delete set null,
  title text not null,
  description text not null,
  priority text not null default 'normal',
  status text not null default 'reported',
  vendor_id uuid references public.vendors(id) on delete set null,
  assigned_to uuid references auth.users(id) on delete set null,
  cost_estimate numeric(14,2),
  cost_final numeric(14,2),
  scheduled_at timestamptz,
  started_at timestamptz,
  closed_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint work_orders_title_check check (length(btrim(title)) between 3 and 160),
  constraint work_orders_description_check check (length(btrim(description)) between 3 and 4000),
  constraint work_orders_priority_check check (priority in ('low', 'normal', 'high', 'urgent')),
  constraint work_orders_status_check
    check (status in ('reported', 'diagnosed', 'approved', 'assigned', 'in_progress', 'pending_validation', 'closed', 'cancelled')),
  constraint work_orders_cost_estimate_check check (cost_estimate is null or cost_estimate >= 0),
  constraint work_orders_cost_final_check check (cost_final is null or cost_final >= 0),
  constraint work_orders_org_code_unique unique (organization_id, code)
);

create unique index if not exists idx_work_orders_pqrs_unique on public.work_orders (pqrs_ticket_id) where pqrs_ticket_id is not null;
create index if not exists idx_work_orders_org_status on public.work_orders (organization_id, status, created_at desc);
create index if not exists idx_work_orders_asset on public.work_orders (asset_id);

alter table public.work_orders enable row level security;

create trigger trg_work_orders_updated_at before update on public.work_orders
  for each row execute function system.update_updated_at();
create trigger trg_work_orders_immutable_org before update on public.work_orders
  for each row execute function public.prevent_organization_change();
create trigger trg_work_orders_tenant_refs before insert or update on public.work_orders
  for each row execute function public.enforce_tenant_refs('asset_id:assets', 'pqrs_ticket_id:pqrs_tickets', 'vendor_id:vendors');

create policy "work_orders_select_reader" on public.work_orders for select to authenticated
  using (public.has_org_permission(organization_id, 'maintenance.read'));

revoke all on public.work_orders from anon, authenticated;
grant select on public.work_orders to authenticated;

-- ------------------------------------------------------------
-- work_order_events: historial append-only (mismo patrón que
-- pqrs_events): diagnóstico, aprobación, asignación, evidencia,
-- validación — nunca se edita ni se borra una fila ya creada.
-- ------------------------------------------------------------
create table if not exists public.work_order_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  work_order_id uuid not null references public.work_orders(id) on delete cascade,
  event_type text not null,
  from_status text,
  to_status text,
  body text,
  cost numeric(14,2),
  actor_kind text not null default 'staff',
  actor_user_id uuid,
  created_at timestamptz not null default now(),
  constraint work_order_events_type_check check (event_type in
    ('created', 'diagnosed', 'approved', 'rejected', 'assigned', 'started', 'evidence_added', 'validated',
     'validation_rejected', 'closed', 'cancelled')),
  constraint work_order_events_actor_check check (actor_kind in ('staff', 'system'))
);

create index if not exists idx_work_order_events_wo on public.work_order_events (work_order_id, created_at);

alter table public.work_order_events enable row level security;

create policy "work_order_events_select_reader" on public.work_order_events for select to authenticated
  using (public.has_org_permission(organization_id, 'maintenance.read'));

revoke all on public.work_order_events from anon, authenticated;
grant select on public.work_order_events to authenticated;

-- ------------------------------------------------------------
-- RPCs: vendors
-- ------------------------------------------------------------
create or replace function public.create_vendor(
  p_organization_id uuid,
  p_name text,
  p_specialty text default null,
  p_phone text default null,
  p_email text default null,
  p_notes text default null
)
returns public.vendors
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_row public.vendors;
begin
  perform public.assert_org_permission(p_organization_id, 'maintenance.write');
  perform public.set_audit_actor('staff');

  insert into public.vendors (organization_id, name, specialty, phone, email, notes)
  values (
    p_organization_id, btrim(p_name), nullif(btrim(coalesce(p_specialty, '')), ''),
    nullif(btrim(coalesce(p_phone, '')), ''), nullif(btrim(coalesce(p_email, '')), ''),
    nullif(btrim(coalesce(p_notes, '')), '')
  ) returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.update_vendor(
  p_vendor_id uuid,
  p_name text default null,
  p_specialty text default null,
  p_phone text default null,
  p_email text default null,
  p_notes text default null,
  p_is_active boolean default null
)
returns public.vendors
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_row public.vendors;
begin
  select * into v_row from public.vendors where id = p_vendor_id for update;
  if not found then
    raise exception 'VENDOR_NOT_FOUND' using errcode = 'P0002';
  end if;
  perform public.assert_org_permission(v_row.organization_id, 'maintenance.write');

  update public.vendors
  set name = coalesce(nullif(btrim(coalesce(p_name, '')), ''), name),
      specialty = case when p_specialty is not null then nullif(btrim(p_specialty), '') else specialty end,
      phone = case when p_phone is not null then nullif(btrim(p_phone), '') else phone end,
      email = case when p_email is not null then nullif(btrim(p_email), '') else email end,
      notes = case when p_notes is not null then nullif(btrim(p_notes), '') else notes end,
      is_active = coalesce(p_is_active, is_active)
  where id = p_vendor_id
  returning * into v_row;
  return v_row;
end;
$$;

-- ------------------------------------------------------------
-- RPCs: assets
-- ------------------------------------------------------------
create or replace function public.create_asset(
  p_organization_id uuid,
  p_name text,
  p_category text default 'other',
  p_location text default null,
  p_installed_on date default null,
  p_warranty_expires_on date default null,
  p_notes text default null
)
returns public.assets
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_row public.assets;
begin
  perform public.assert_org_permission(p_organization_id, 'maintenance.write');
  perform public.set_audit_actor('staff');

  insert into public.assets (organization_id, name, category, location, installed_on, warranty_expires_on, notes)
  values (
    p_organization_id, btrim(p_name), coalesce(p_category, 'other'), nullif(btrim(coalesce(p_location, '')), ''),
    p_installed_on, p_warranty_expires_on, nullif(btrim(coalesce(p_notes, '')), '')
  ) returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.update_asset(
  p_asset_id uuid,
  p_name text default null,
  p_category text default null,
  p_location text default null,
  p_installed_on date default null,
  p_warranty_expires_on date default null,
  p_notes text default null,
  p_status text default null
)
returns public.assets
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_row public.assets;
begin
  select * into v_row from public.assets where id = p_asset_id for update;
  if not found then
    raise exception 'ASSET_NOT_FOUND' using errcode = 'P0002';
  end if;
  perform public.assert_org_permission(v_row.organization_id, 'maintenance.write');
  if p_status is not null and p_status not in ('active', 'retired') then
    raise exception 'VALIDATION_ERROR: estado de activo inválido' using errcode = '22023';
  end if;

  update public.assets
  set name = coalesce(nullif(btrim(coalesce(p_name, '')), ''), name),
      category = coalesce(p_category, category),
      location = case when p_location is not null then nullif(btrim(p_location), '') else location end,
      installed_on = coalesce(p_installed_on, installed_on),
      warranty_expires_on = coalesce(p_warranty_expires_on, warranty_expires_on),
      notes = case when p_notes is not null then nullif(btrim(p_notes), '') else notes end,
      status = coalesce(p_status, status)
  where id = p_asset_id
  returning * into v_row;
  return v_row;
end;
$$;

-- ------------------------------------------------------------
-- RPCs: maintenance_schedules
-- ------------------------------------------------------------
create or replace function public.create_maintenance_schedule(
  p_organization_id uuid,
  p_title text,
  p_frequency_months integer,
  p_next_due_on date,
  p_asset_id uuid default null,
  p_notes text default null
)
returns public.maintenance_schedules
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_row public.maintenance_schedules;
begin
  perform public.assert_org_permission(p_organization_id, 'maintenance.write');
  perform public.set_audit_actor('staff');

  insert into public.maintenance_schedules (organization_id, asset_id, title, frequency_months, next_due_on, notes)
  values (p_organization_id, p_asset_id, btrim(p_title), p_frequency_months, p_next_due_on, nullif(btrim(coalesce(p_notes, '')), ''))
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.update_maintenance_schedule(
  p_schedule_id uuid,
  p_title text default null,
  p_frequency_months integer default null,
  p_next_due_on date default null,
  p_notes text default null,
  p_is_active boolean default null
)
returns public.maintenance_schedules
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_row public.maintenance_schedules;
begin
  select * into v_row from public.maintenance_schedules where id = p_schedule_id for update;
  if not found then
    raise exception 'SCHEDULE_NOT_FOUND' using errcode = 'P0002';
  end if;
  perform public.assert_org_permission(v_row.organization_id, 'maintenance.write');

  update public.maintenance_schedules
  set title = coalesce(nullif(btrim(coalesce(p_title, '')), ''), title),
      frequency_months = coalesce(p_frequency_months, frequency_months),
      next_due_on = coalesce(p_next_due_on, next_due_on),
      notes = case when p_notes is not null then nullif(btrim(p_notes), '') else notes end,
      is_active = coalesce(p_is_active, is_active)
  where id = p_schedule_id
  returning * into v_row;
  return v_row;
end;
$$;

-- Marca ejecutado el mantenimiento preventivo y adelanta la próxima
-- fecha según la frecuencia configurada.
create or replace function public.mark_maintenance_schedule_done(p_schedule_id uuid, p_done_on date default current_date)
returns public.maintenance_schedules
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_row public.maintenance_schedules;
begin
  select * into v_row from public.maintenance_schedules where id = p_schedule_id for update;
  if not found then
    raise exception 'SCHEDULE_NOT_FOUND' using errcode = 'P0002';
  end if;
  perform public.assert_org_permission(v_row.organization_id, 'maintenance.write');

  update public.maintenance_schedules
  set last_done_on = p_done_on,
      next_due_on = p_done_on + make_interval(months => frequency_months)
  where id = p_schedule_id
  returning * into v_row;
  return v_row;
end;
$$;

-- ------------------------------------------------------------
-- RPCs: work_orders (el flujo completo)
-- ------------------------------------------------------------
create or replace function public.create_work_order(
  p_organization_id uuid,
  p_title text,
  p_description text,
  p_priority text default 'normal',
  p_asset_id uuid default null,
  p_pqrs_ticket_id uuid default null,
  p_actor_kind text default 'staff'
)
returns public.work_orders
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_row public.work_orders;
  v_year text := to_char(now() at time zone coalesce(
    (select timezone from public.organizations where id = p_organization_id), 'America/Bogota'), 'YYYY');
  v_actor_kind text := case when (select auth.uid()) is not null then 'staff' else coalesce(p_actor_kind, 'system') end;
begin
  perform public.assert_org_permission(p_organization_id, 'maintenance.write');
  perform public.set_audit_actor(v_actor_kind);

  if p_pqrs_ticket_id is not null then
    if not exists (
      select 1 from public.pqrs_tickets where id = p_pqrs_ticket_id and organization_id = p_organization_id
    ) then
      raise exception 'PQRS_NOT_FOUND' using errcode = 'P0002';
    end if;
    if exists (select 1 from public.work_orders where pqrs_ticket_id = p_pqrs_ticket_id) then
      raise exception 'VALIDATION_ERROR: esa PQRS ya tiene una orden de trabajo' using errcode = '22023';
    end if;
  end if;

  insert into public.work_orders (
    organization_id, code, asset_id, pqrs_ticket_id, title, description, priority, created_by
  ) values (
    p_organization_id,
    'OT-' || v_year || '-' || lpad(public.next_org_counter(p_organization_id, 'work_order:' || v_year)::text, 5, '0'),
    p_asset_id, p_pqrs_ticket_id, btrim(p_title), btrim(p_description), coalesce(p_priority, 'normal'), (select auth.uid())
  ) returning * into v_row;

  insert into public.work_order_events (organization_id, work_order_id, event_type, to_status, actor_kind, actor_user_id)
  values (p_organization_id, v_row.id, 'created', v_row.status, v_actor_kind, (select auth.uid()));

  return v_row;
end;
$$;

create or replace function public.diagnose_work_order(p_work_order_id uuid, p_note text, p_cost_estimate numeric default null)
returns public.work_orders
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_row public.work_orders;
begin
  select * into v_row from public.work_orders where id = p_work_order_id for update;
  if not found then
    raise exception 'WORK_ORDER_NOT_FOUND' using errcode = 'P0002';
  end if;
  perform public.assert_org_permission(v_row.organization_id, 'maintenance.write');
  if v_row.status <> 'reported' then
    raise exception 'VALIDATION_ERROR: solo se diagnostica una orden recién reportada' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_note, ''))) < 3 then
    raise exception 'VALIDATION_ERROR: describe el diagnóstico' using errcode = '22023';
  end if;

  update public.work_orders
  set status = 'diagnosed', cost_estimate = coalesce(p_cost_estimate, cost_estimate)
  where id = p_work_order_id
  returning * into v_row;

  insert into public.work_order_events (organization_id, work_order_id, event_type, from_status, to_status, body, cost, actor_kind, actor_user_id)
  values (v_row.organization_id, p_work_order_id, 'diagnosed', 'reported', 'diagnosed', btrim(p_note), p_cost_estimate, 'staff', (select auth.uid()));

  return v_row;
end;
$$;

-- Checkpoint de aprobación (maintenance.approve): decide si se ejecuta
-- el gasto diagnosticado. Rechazar cancela la orden con motivo.
create or replace function public.approve_work_order(
  p_work_order_id uuid,
  p_approved boolean,
  p_note text default null,
  p_cost_estimate numeric default null
)
returns public.work_orders
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_row public.work_orders;
  v_new_status text := case when p_approved then 'approved' else 'cancelled' end;
begin
  select * into v_row from public.work_orders where id = p_work_order_id for update;
  if not found then
    raise exception 'WORK_ORDER_NOT_FOUND' using errcode = 'P0002';
  end if;
  perform public.assert_org_permission(v_row.organization_id, 'maintenance.approve');
  if v_row.status <> 'diagnosed' then
    raise exception 'VALIDATION_ERROR: solo se aprueba una orden ya diagnosticada' using errcode = '22023';
  end if;
  if not p_approved and length(btrim(coalesce(p_note, ''))) < 3 then
    raise exception 'VALIDATION_ERROR: indica el motivo del rechazo' using errcode = '22023';
  end if;

  update public.work_orders
  set status = v_new_status,
      cost_estimate = coalesce(p_cost_estimate, cost_estimate),
      closed_at = case when v_new_status = 'cancelled' then now() else closed_at end
  where id = p_work_order_id
  returning * into v_row;

  insert into public.work_order_events (organization_id, work_order_id, event_type, from_status, to_status, body, cost, actor_kind, actor_user_id)
  values (
    v_row.organization_id, p_work_order_id, case when p_approved then 'approved' else 'rejected' end,
    'diagnosed', v_new_status, nullif(btrim(coalesce(p_note, '')), ''), p_cost_estimate, 'staff', (select auth.uid())
  );

  return v_row;
end;
$$;

create or replace function public.assign_work_order(
  p_work_order_id uuid,
  p_vendor_id uuid default null,
  p_assigned_to uuid default null,
  p_scheduled_at timestamptz default null
)
returns public.work_orders
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_row public.work_orders;
begin
  select * into v_row from public.work_orders where id = p_work_order_id for update;
  if not found then
    raise exception 'WORK_ORDER_NOT_FOUND' using errcode = 'P0002';
  end if;
  perform public.assert_org_permission(v_row.organization_id, 'maintenance.write');
  if v_row.status <> 'approved' then
    raise exception 'VALIDATION_ERROR: solo se asigna una orden ya aprobada' using errcode = '22023';
  end if;
  if p_vendor_id is null and p_assigned_to is null then
    raise exception 'VALIDATION_ERROR: asigna un proveedor o un responsable interno' using errcode = '22023';
  end if;
  if p_assigned_to is not null and not exists (
    select 1 from public.organization_members where organization_id = v_row.organization_id and user_id = p_assigned_to
  ) then
    raise exception 'VALIDATION_ERROR: el responsable no pertenece al equipo' using errcode = '22023';
  end if;

  update public.work_orders
  set status = 'assigned', vendor_id = coalesce(p_vendor_id, vendor_id), assigned_to = coalesce(p_assigned_to, assigned_to),
      scheduled_at = coalesce(p_scheduled_at, scheduled_at)
  where id = p_work_order_id
  returning * into v_row;

  insert into public.work_order_events (organization_id, work_order_id, event_type, from_status, to_status, actor_kind, actor_user_id)
  values (v_row.organization_id, p_work_order_id, 'assigned', 'approved', 'assigned', 'staff', (select auth.uid()));

  return v_row;
end;
$$;

create or replace function public.start_work_order(p_work_order_id uuid)
returns public.work_orders
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_row public.work_orders;
begin
  select * into v_row from public.work_orders where id = p_work_order_id for update;
  if not found then
    raise exception 'WORK_ORDER_NOT_FOUND' using errcode = 'P0002';
  end if;
  perform public.assert_org_permission(v_row.organization_id, 'maintenance.write');
  if v_row.status <> 'assigned' then
    raise exception 'VALIDATION_ERROR: solo se inicia una orden ya asignada' using errcode = '22023';
  end if;

  update public.work_orders set status = 'in_progress', started_at = now() where id = p_work_order_id returning * into v_row;

  insert into public.work_order_events (organization_id, work_order_id, event_type, from_status, to_status, actor_kind, actor_user_id)
  values (v_row.organization_id, p_work_order_id, 'started', 'assigned', 'in_progress', 'staff', (select auth.uid()));

  return v_row;
end;
$$;

-- Registra qué se hizo (texto) y el costo final, y deja la orden lista
-- para el checkpoint de validación.
create or replace function public.add_work_order_evidence(p_work_order_id uuid, p_note text, p_cost_final numeric default null)
returns public.work_orders
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_row public.work_orders;
begin
  select * into v_row from public.work_orders where id = p_work_order_id for update;
  if not found then
    raise exception 'WORK_ORDER_NOT_FOUND' using errcode = 'P0002';
  end if;
  perform public.assert_org_permission(v_row.organization_id, 'maintenance.write');
  if v_row.status <> 'in_progress' then
    raise exception 'VALIDATION_ERROR: solo se agrega evidencia a una orden en ejecución' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_note, ''))) < 3 then
    raise exception 'VALIDATION_ERROR: describe qué se hizo' using errcode = '22023';
  end if;

  update public.work_orders
  set status = 'pending_validation', cost_final = coalesce(p_cost_final, cost_final)
  where id = p_work_order_id
  returning * into v_row;

  insert into public.work_order_events (organization_id, work_order_id, event_type, from_status, to_status, body, cost, actor_kind, actor_user_id)
  values (v_row.organization_id, p_work_order_id, 'evidence_added', 'in_progress', 'pending_validation', btrim(p_note), p_cost_final, 'staff', (select auth.uid()));

  return v_row;
end;
$$;

-- Checkpoint de validación (maintenance.approve): confirma que el
-- trabajo quedó bien hecho y cierra, o lo reabre si falta algo.
create or replace function public.close_work_order(p_work_order_id uuid, p_validated boolean, p_note text default null)
returns public.work_orders
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_row public.work_orders;
  v_new_status text := case when p_validated then 'closed' else 'in_progress' end;
begin
  select * into v_row from public.work_orders where id = p_work_order_id for update;
  if not found then
    raise exception 'WORK_ORDER_NOT_FOUND' using errcode = 'P0002';
  end if;
  perform public.assert_org_permission(v_row.organization_id, 'maintenance.approve');
  if v_row.status <> 'pending_validation' then
    raise exception 'VALIDATION_ERROR: solo se valida una orden con evidencia registrada' using errcode = '22023';
  end if;
  if not p_validated and length(btrim(coalesce(p_note, ''))) < 3 then
    raise exception 'VALIDATION_ERROR: indica qué falta para poder cerrarla' using errcode = '22023';
  end if;

  update public.work_orders
  set status = v_new_status, closed_at = case when p_validated then now() else null end
  where id = p_work_order_id
  returning * into v_row;

  insert into public.work_order_events (organization_id, work_order_id, event_type, from_status, to_status, body, actor_kind, actor_user_id)
  values (
    v_row.organization_id, p_work_order_id, case when p_validated then 'closed' else 'validation_rejected' end,
    'pending_validation', v_new_status, nullif(btrim(coalesce(p_note, '')), ''), 'staff', (select auth.uid())
  );

  return v_row;
end;
$$;

create or replace function public.cancel_work_order(p_work_order_id uuid, p_reason text)
returns public.work_orders
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_row public.work_orders;
begin
  select * into v_row from public.work_orders where id = p_work_order_id for update;
  if not found then
    raise exception 'WORK_ORDER_NOT_FOUND' using errcode = 'P0002';
  end if;
  perform public.assert_org_permission(v_row.organization_id, 'maintenance.write');
  if v_row.status in ('closed', 'cancelled') then
    raise exception 'VALIDATION_ERROR: esa orden ya está cerrada o cancelada' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'VALIDATION_ERROR: indica el motivo de la cancelación' using errcode = '22023';
  end if;

  update public.work_orders set status = 'cancelled', closed_at = now() where id = p_work_order_id returning * into v_row;

  insert into public.work_order_events (organization_id, work_order_id, event_type, from_status, to_status, body, actor_kind, actor_user_id)
  values (v_row.organization_id, p_work_order_id, 'cancelled', v_row.status, 'cancelled', btrim(p_reason), 'staff', (select auth.uid()));

  return v_row;
end;
$$;

revoke execute on function
  public.create_vendor(uuid, text, text, text, text, text),
  public.update_vendor(uuid, text, text, text, text, text, boolean),
  public.create_asset(uuid, text, text, text, date, date, text),
  public.update_asset(uuid, text, text, text, date, date, text, text),
  public.create_maintenance_schedule(uuid, text, integer, date, uuid, text),
  public.update_maintenance_schedule(uuid, text, integer, date, text, boolean),
  public.mark_maintenance_schedule_done(uuid, date),
  public.create_work_order(uuid, text, text, text, uuid, uuid, text),
  public.diagnose_work_order(uuid, text, numeric),
  public.approve_work_order(uuid, boolean, text, numeric),
  public.assign_work_order(uuid, uuid, uuid, timestamptz),
  public.start_work_order(uuid),
  public.add_work_order_evidence(uuid, text, numeric),
  public.close_work_order(uuid, boolean, text),
  public.cancel_work_order(uuid, text)
from public, anon, authenticated;

grant execute on function
  public.create_vendor(uuid, text, text, text, text, text),
  public.update_vendor(uuid, text, text, text, text, text, boolean),
  public.create_asset(uuid, text, text, text, date, date, text),
  public.update_asset(uuid, text, text, text, date, date, text, text),
  public.create_maintenance_schedule(uuid, text, integer, date, uuid, text),
  public.update_maintenance_schedule(uuid, text, integer, date, text, boolean),
  public.mark_maintenance_schedule_done(uuid, date),
  public.create_work_order(uuid, text, text, text, uuid, uuid, text),
  public.diagnose_work_order(uuid, text, numeric),
  public.approve_work_order(uuid, boolean, text, numeric),
  public.assign_work_order(uuid, uuid, uuid, timestamptz),
  public.start_work_order(uuid),
  public.add_work_order_evidence(uuid, text, numeric),
  public.close_work_order(uuid, boolean, text),
  public.cancel_work_order(uuid, text)
to authenticated;

-- ------------------------------------------------------------
-- Auditoría: mismo mecanismo que el resto de la plataforma. Los eventos
-- (work_order_events) no se auditan aparte, igual que pqrs_events: son
-- en sí mismos el historial append-only.
-- ------------------------------------------------------------
create trigger trg_vendors_audit after insert or update or delete on public.vendors
  for each row execute function public.audit_row_change();
create trigger trg_assets_audit after insert or update or delete on public.assets
  for each row execute function public.audit_row_change();
create trigger trg_maintenance_schedules_audit after insert or update or delete on public.maintenance_schedules
  for each row execute function public.audit_row_change();
create trigger trg_work_orders_audit after insert or update or delete on public.work_orders
  for each row execute function public.audit_row_change();

-- ------------------------------------------------------------
-- Permisos maintenance.read / maintenance.write / maintenance.approve.
-- council aprueba y valida (gobierno) pero no opera el día a día, igual
-- que en asamblea; accountant y auditor solo leen (visibilidad de costos
-- y trazabilidad, sin poder ejecutar cambios).
-- ------------------------------------------------------------
insert into public.role_permissions (role, permission)
values
  ('owner', 'maintenance.read'), ('owner', 'maintenance.write'), ('owner', 'maintenance.approve'),
  ('admin', 'maintenance.read'), ('admin', 'maintenance.write'), ('admin', 'maintenance.approve'),
  ('assistant', 'maintenance.read'), ('assistant', 'maintenance.write'),
  ('accountant', 'maintenance.read'),
  ('council', 'maintenance.read'), ('council', 'maintenance.approve'),
  ('auditor', 'maintenance.read')
on conflict do nothing;
