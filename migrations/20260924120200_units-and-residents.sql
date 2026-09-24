-- ============================================================
-- Núcleo de la copropiedad: torres, unidades, personas y la relación
-- persona-unidad (propietario, arrendatario, residente, autorizado).
--
-- Una persona puede relacionarse con varias unidades; una unidad tiene
-- varias personas. Las unidades (código, tipo, coeficiente) no son datos
-- personales y las ve cualquier miembro del equipo; las personas sí lo son
-- y exigen residents.read (Ley 1581: minimización por rol).
-- ============================================================

-- ------------------------------------------------------------
-- Normalización de teléfonos a E.164 (Colombia por defecto). Es la llave
-- de identidad del residente en WhatsApp/Telegram, así que vive en SQL:
-- una sola implementación para importación, dashboard y agente.
-- ------------------------------------------------------------
create or replace function public.normalize_phone(p_raw text)
returns text
language plpgsql
immutable
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_trimmed text := btrim(coalesce(p_raw, ''));
  v_digits text;
begin
  if v_trimmed = '' then
    return null;
  end if;
  v_digits := regexp_replace(v_trimmed, '\D', '', 'g');
  if v_digits = '' then
    return null;
  end if;
  if left(v_trimmed, 1) = '+' then
    return '+' || v_digits;
  end if;
  if left(v_digits, 2) = '00' then
    return '+' || substr(v_digits, 3);
  end if;
  -- Celulares (3xx) y fijos nacionales (60x) colombianos de 10 dígitos.
  if length(v_digits) = 10 and (left(v_digits, 1) = '3' or left(v_digits, 2) = '60') then
    return '+57' || v_digits;
  end if;
  if length(v_digits) = 12 and left(v_digits, 2) = '57' then
    return '+' || v_digits;
  end if;
  if length(v_digits) >= 11 then
    return '+' || v_digits;
  end if;
  return v_digits;
end;
$$;

-- ------------------------------------------------------------
-- towers
-- ------------------------------------------------------------
create table if not exists public.towers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  import_batch_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint towers_name_check check (length(btrim(name)) between 1 and 60),
  constraint towers_org_name_unique unique (organization_id, name)
);

alter table public.towers enable row level security;

create trigger trg_towers_updated_at before update on public.towers
  for each row execute function system.update_updated_at();
create trigger trg_towers_immutable_org before update on public.towers
  for each row execute function public.prevent_organization_change();

-- ------------------------------------------------------------
-- units
-- ------------------------------------------------------------
create table if not exists public.units (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  tower_id uuid references public.towers(id) on delete restrict,
  code text not null,
  unit_type text not null default 'apartment',
  floor text,
  area_m2 numeric(10,2),
  -- Coeficiente de copropiedad en porcentaje (la suma de todas las
  -- unidades debería dar 100). Base para cuotas por coeficiente y quórum.
  coefficient_pct numeric(9,6) not null default 0,
  is_active boolean not null default true,
  notes text,
  import_batch_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint units_code_check check (length(btrim(code)) between 1 and 40),
  constraint units_type_check
    check (unit_type in ('apartment', 'house', 'commercial', 'office', 'parking', 'storage', 'other')),
  constraint units_area_check check (area_m2 is null or area_m2 > 0),
  constraint units_coefficient_check check (coefficient_pct >= 0 and coefficient_pct <= 100),
  constraint units_org_code_unique unique (organization_id, code)
);

create index if not exists idx_units_org on public.units (organization_id);
create index if not exists idx_units_tower on public.units (tower_id);

alter table public.units enable row level security;

create trigger trg_units_updated_at before update on public.units
  for each row execute function system.update_updated_at();
create trigger trg_units_immutable_org before update on public.units
  for each row execute function public.prevent_organization_change();
create trigger trg_units_tenant_refs before insert or update on public.units
  for each row execute function public.enforce_tenant_refs('tower_id:towers');

-- ------------------------------------------------------------
-- persons: propietarios, arrendatarios, residentes y autorizados.
-- ------------------------------------------------------------
create table if not exists public.persons (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  full_name text not null,
  document_type text,
  document_number text,
  phone text,
  email text,
  notes text,
  data_consent_at timestamptz,
  data_consent_source text,
  import_batch_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint persons_name_check check (length(btrim(full_name)) between 2 and 160),
  constraint persons_document_type_check
    check (document_type is null or document_type in ('CC', 'CE', 'NIT', 'PAS', 'TI', 'PPT', 'OTRO')),
  constraint persons_email_check check (email is null or email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);

-- El teléfono identifica al residente en los canales: único por copropiedad.
create unique index if not exists uq_persons_org_phone on public.persons (organization_id, phone) where phone is not null;
create unique index if not exists uq_persons_org_document
  on public.persons (organization_id, document_type, document_number) where document_number is not null;
create index if not exists idx_persons_org_name on public.persons (organization_id, lower(full_name));

alter table public.persons enable row level security;

create or replace function public.normalize_person_fields()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  new.full_name := btrim(regexp_replace(new.full_name, '\s+', ' ', 'g'));
  new.phone := public.normalize_phone(new.phone);
  new.email := nullif(lower(btrim(coalesce(new.email, ''))), '');
  new.document_number := nullif(upper(regexp_replace(coalesce(new.document_number, ''), '[\s.\-]', '', 'g')), '');
  return new;
end;
$$;

create trigger trg_persons_normalize before insert or update on public.persons
  for each row execute function public.normalize_person_fields();
create trigger trg_persons_updated_at before update on public.persons
  for each row execute function system.update_updated_at();
create trigger trg_persons_immutable_org before update on public.persons
  for each row execute function public.prevent_organization_change();

-- ------------------------------------------------------------
-- unit_persons: relación persona-unidad con vigencia. Una relación
-- terminada conserva la fila (ends_on) para la memoria institucional.
-- ------------------------------------------------------------
create table if not exists public.unit_persons (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  person_id uuid not null references public.persons(id) on delete cascade,
  relation text not null,
  is_primary_contact boolean not null default false,
  starts_on date,
  ends_on date,
  import_batch_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint unit_persons_relation_check check (relation in ('owner', 'tenant', 'resident', 'authorized')),
  constraint unit_persons_dates_check check (ends_on is null or starts_on is null or ends_on >= starts_on)
);

create unique index if not exists uq_unit_persons_active
  on public.unit_persons (unit_id, person_id, relation) where ends_on is null;
create index if not exists idx_unit_persons_person on public.unit_persons (person_id);
create index if not exists idx_unit_persons_org on public.unit_persons (organization_id);

alter table public.unit_persons enable row level security;

create trigger trg_unit_persons_updated_at before update on public.unit_persons
  for each row execute function system.update_updated_at();
create trigger trg_unit_persons_immutable_org before update on public.unit_persons
  for each row execute function public.prevent_organization_change();
create trigger trg_unit_persons_tenant_refs before insert or update on public.unit_persons
  for each row execute function public.enforce_tenant_refs('unit_id:units', 'person_id:persons');

-- ------------------------------------------------------------
-- Policies
-- ------------------------------------------------------------
create policy "towers_select_member" on public.towers for select to authenticated
  using (public.is_org_member(organization_id));
create policy "towers_insert_writer" on public.towers for insert to authenticated
  with check (public.has_org_permission(organization_id, 'residents.write'));
create policy "towers_update_writer" on public.towers for update to authenticated
  using (public.has_org_permission(organization_id, 'residents.write'))
  with check (public.has_org_permission(organization_id, 'residents.write'));
create policy "towers_delete_writer" on public.towers for delete to authenticated
  using (public.has_org_permission(organization_id, 'residents.write'));

create policy "units_select_member" on public.units for select to authenticated
  using (public.is_org_member(organization_id));
create policy "units_insert_writer" on public.units for insert to authenticated
  with check (public.has_org_permission(organization_id, 'residents.write'));
create policy "units_update_writer" on public.units for update to authenticated
  using (public.has_org_permission(organization_id, 'residents.write'))
  with check (public.has_org_permission(organization_id, 'residents.write'));
create policy "units_delete_writer" on public.units for delete to authenticated
  using (public.has_org_permission(organization_id, 'residents.write'));

create policy "persons_select_reader" on public.persons for select to authenticated
  using (public.has_org_permission(organization_id, 'residents.read'));
create policy "persons_insert_writer" on public.persons for insert to authenticated
  with check (public.has_org_permission(organization_id, 'residents.write'));
create policy "persons_update_writer" on public.persons for update to authenticated
  using (public.has_org_permission(organization_id, 'residents.write'))
  with check (public.has_org_permission(organization_id, 'residents.write'));
create policy "persons_delete_writer" on public.persons for delete to authenticated
  using (public.has_org_permission(organization_id, 'residents.write'));

create policy "unit_persons_select_reader" on public.unit_persons for select to authenticated
  using (public.has_org_permission(organization_id, 'residents.read'));
create policy "unit_persons_insert_writer" on public.unit_persons for insert to authenticated
  with check (public.has_org_permission(organization_id, 'residents.write'));
create policy "unit_persons_update_writer" on public.unit_persons for update to authenticated
  using (public.has_org_permission(organization_id, 'residents.write'))
  with check (public.has_org_permission(organization_id, 'residents.write'));
create policy "unit_persons_delete_writer" on public.unit_persons for delete to authenticated
  using (public.has_org_permission(organization_id, 'residents.write'));

revoke all on public.towers, public.units, public.persons, public.unit_persons from anon, authenticated;
grant select, insert, update, delete on public.towers, public.units, public.persons, public.unit_persons to authenticated;
-- data_consent_* solo lo fija el flujo de verificación (servidor) o el import.
revoke update on public.persons from authenticated;
grant update (full_name, document_type, document_number, phone, email, notes) on public.persons to authenticated;

-- ------------------------------------------------------------
-- Identidad para el agente (solo compute service): persona por teléfono
-- y sus unidades con permisos derivados de la relación.
-- Acceso financiero: propietario o arrendatario de la unidad.
-- ------------------------------------------------------------
create or replace function public.find_person_by_phone(p_organization_id uuid, p_phone text)
returns table (person_id uuid, full_name text, phone text)
language sql
security definer
stable
set search_path = pg_catalog, public, pg_temp
as $$
  select p.id, p.full_name, p.phone
  from public.persons p
  where p.organization_id = p_organization_id
    and p.phone = public.normalize_phone(p_phone)
  limit 1;
$$;

create or replace function public.get_person_identity(p_organization_id uuid, p_person_id uuid)
returns jsonb
language sql
security definer
stable
set search_path = pg_catalog, public, pg_temp
as $$
  select jsonb_build_object(
    'person_id', p.id,
    'full_name', p.full_name,
    'units', coalesce((
      select jsonb_agg(jsonb_build_object(
        'unit_id', x.unit_id,
        'code', x.code,
        'tower', x.tower_name,
        'relations', x.relations,
        'finance_access', x.finance_access
      ) order by x.code)
      from (
        select u.id as unit_id, u.code, t.name as tower_name,
               array_agg(distinct up.relation order by up.relation) as relations,
               bool_or(up.relation in ('owner', 'tenant')) as finance_access
        from public.unit_persons up
        join public.units u on u.id = up.unit_id and u.is_active
        left join public.towers t on t.id = u.tower_id
        where up.person_id = p.id
          and up.organization_id = p_organization_id
          and (up.ends_on is null or up.ends_on >= current_date)
        group by u.id, u.code, t.name
      ) x
    ), '[]'::jsonb)
  )
  from public.persons p
  where p.id = p_person_id and p.organization_id = p_organization_id;
$$;

revoke execute on function
  public.normalize_phone(text), public.normalize_person_fields(),
  public.find_person_by_phone(uuid, text), public.get_person_identity(uuid, uuid)
from public, anon, authenticated;
-- Función pura: la usa el trigger de persons en el contexto del usuario.
grant execute on function public.normalize_phone(text) to authenticated;
