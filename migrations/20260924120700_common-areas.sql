-- ============================================================
-- Zonas comunes y reservas. El motor de reservas es determinista y vive
-- en SQL: el LLM nunca "decide" disponibilidad, solo consulta
-- get_area_slots y propone; book_area_reservation valida todo de nuevo.
-- ============================================================

create table if not exists public.common_areas (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  description text,
  rules text,
  booking_mode text not null default 'exclusive',
  capacity integer,
  max_guests integer,
  requires_approval boolean not null default false,
  fee_amount numeric(14,2) not null default 0,
  deposit_amount numeric(14,2) not null default 0,
  slot_minutes integer not null default 60,
  min_duration_minutes integer not null default 60,
  max_duration_minutes integer not null default 240,
  advance_min_hours integer not null default 24,
  advance_max_days integer not null default 60,
  max_active_per_unit integer not null default 2,
  -- Restringir por mora depende del reglamento: desactivado por defecto.
  block_if_overdue boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint common_areas_name_check check (length(btrim(name)) between 2 and 80),
  constraint common_areas_mode_check check (booking_mode in ('exclusive', 'shared')),
  constraint common_areas_capacity_check check (capacity is null or capacity > 0),
  constraint common_areas_shared_capacity check (booking_mode = 'exclusive' or capacity is not null),
  constraint common_areas_guests_check check (max_guests is null or max_guests > 0),
  constraint common_areas_money_check check (fee_amount >= 0 and deposit_amount >= 0),
  constraint common_areas_slot_check check (slot_minutes between 15 and 720),
  constraint common_areas_duration_check
    check (min_duration_minutes between 15 and 1440 and max_duration_minutes between min_duration_minutes and 1440),
  constraint common_areas_window_check check (advance_min_hours between 0 and 720 and advance_max_days between 1 and 365),
  constraint common_areas_quota_check check (max_active_per_unit between 1 and 50),
  constraint common_areas_org_name_unique unique (organization_id, name)
);

alter table public.common_areas enable row level security;

create trigger trg_common_areas_updated_at before update on public.common_areas
  for each row execute function system.update_updated_at();
create trigger trg_common_areas_immutable_org before update on public.common_areas
  for each row execute function public.prevent_organization_change();

create table if not exists public.common_area_hours (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  area_id uuid not null references public.common_areas(id) on delete cascade,
  day_of_week integer not null,
  opens_at time not null,
  closes_at time not null,
  constraint common_area_hours_dow_check check (day_of_week between 0 and 6),
  constraint common_area_hours_range_check check (closes_at > opens_at)
);

create index if not exists idx_common_area_hours_area on public.common_area_hours (area_id, day_of_week);

alter table public.common_area_hours enable row level security;

create trigger trg_common_area_hours_tenant_refs before insert or update on public.common_area_hours
  for each row execute function public.enforce_tenant_refs('area_id:common_areas');

create table if not exists public.area_reservations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  area_id uuid not null references public.common_areas(id) on delete restrict,
  unit_id uuid not null references public.units(id) on delete restrict,
  person_id uuid references public.persons(id) on delete set null,
  conversation_id uuid references public.conversations(id) on delete set null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  guests integer not null default 1,
  is_exclusive boolean not null,
  status text not null default 'confirmed',
  fee_amount numeric(14,2) not null default 0,
  deposit_amount numeric(14,2) not null default 0,
  charge_id uuid references public.charges(id) on delete set null,
  notes text,
  source text not null default 'dashboard',
  decided_by uuid,
  decided_at timestamptz,
  decision_reason text,
  cancelled_at timestamptz,
  cancel_reason text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint area_reservations_range_check check (end_at > start_at),
  constraint area_reservations_guests_check check (guests > 0),
  constraint area_reservations_status_check
    check (status in ('pending_approval', 'confirmed', 'rejected', 'cancelled', 'completed', 'no_show')),
  constraint area_reservations_source_check check (source in ('agent', 'dashboard')),
  -- Anti doble reserva atómico para zonas de uso exclusivo.
  constraint area_reservations_no_overlap exclude using gist (
    area_id with =,
    tstzrange(start_at, end_at, '[)') with &&
  ) where (is_exclusive and status in ('pending_approval', 'confirmed'))
);

create index if not exists idx_area_reservations_area_start on public.area_reservations (area_id, start_at);
create index if not exists idx_area_reservations_org_start on public.area_reservations (organization_id, start_at);
create index if not exists idx_area_reservations_unit on public.area_reservations (unit_id, status);

alter table public.area_reservations enable row level security;

create trigger trg_area_reservations_updated_at before update on public.area_reservations
  for each row execute function system.update_updated_at();
create trigger trg_area_reservations_tenant_refs before insert or update on public.area_reservations
  for each row execute function public.enforce_tenant_refs(
    'area_id:common_areas', 'unit_id:units', 'person_id:persons', 'conversation_id:conversations');

alter table public.charges
  add constraint charges_reservation_fk foreign key (reservation_id) references public.area_reservations(id) on delete set null;

create policy "common_areas_select_member" on public.common_areas for select to authenticated
  using (public.is_org_member(organization_id));
create policy "common_areas_insert_writer" on public.common_areas for insert to authenticated
  with check (public.has_org_permission(organization_id, 'reservations.write'));
create policy "common_areas_update_writer" on public.common_areas for update to authenticated
  using (public.has_org_permission(organization_id, 'reservations.write'))
  with check (public.has_org_permission(organization_id, 'reservations.write'));
create policy "common_areas_delete_writer" on public.common_areas for delete to authenticated
  using (public.has_org_permission(organization_id, 'reservations.write'));

create policy "common_area_hours_select_member" on public.common_area_hours for select to authenticated
  using (public.is_org_member(organization_id));
create policy "common_area_hours_insert_writer" on public.common_area_hours for insert to authenticated
  with check (public.has_org_permission(organization_id, 'reservations.write'));
create policy "common_area_hours_update_writer" on public.common_area_hours for update to authenticated
  using (public.has_org_permission(organization_id, 'reservations.write'))
  with check (public.has_org_permission(organization_id, 'reservations.write'));
create policy "common_area_hours_delete_writer" on public.common_area_hours for delete to authenticated
  using (public.has_org_permission(organization_id, 'reservations.write'));

create policy "area_reservations_select_reader" on public.area_reservations for select to authenticated
  using (public.has_org_permission(organization_id, 'reservations.read'));

revoke all on public.common_areas, public.common_area_hours, public.area_reservations from anon, authenticated;
grant select, insert, update, delete on public.common_areas, public.common_area_hours to authenticated;
grant select on public.area_reservations to authenticated;
