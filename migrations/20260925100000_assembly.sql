-- ============================================================
-- Asamblea y gobierno (sección 4.9 del prompt maestro, Ley 675 de 2001):
-- convocatoria, orden del día, poderes, quórum por coeficiente, votación
-- y acta. Es el dolor legal más recurrente de un administrador en
-- Colombia y hoy no existía ninguna tabla para esto.
--
-- Principios de diseño, explícitos en el prompt maestro:
--   - El quórum y la mayoría se calculan SIEMPRE sobre coeficientes reales
--     de units, nunca a mano ni "a ojo".
--   - Un poder tiene dueño, apoderado y un límite de unidades que puede
--     representar SEGÚN EL REGLAMENTO de cada copropiedad: configurable
--     en property_profiles.max_proxies_per_attorney, nunca hardcodeado
--     como una regla universal.
--   - El sistema entrega los NÚMEROS crudos de la votación (a favor, en
--     contra, abstención, por coeficiente); NUNCA certifica si una
--     decisión "quedó aprobada", porque el tipo de mayoría requerida
--     (simple, absoluta, calificada) depende del reglamento y del tema,
--     no es una interpretación que el sistema deba fijar.
--   - El acta final es un documento versionado (reutiliza public.documents,
--     doc_type = 'assembly_minutes'), no texto libre.
-- Sigue las mismas convenciones que 20260924130000_gatehouse.sql.
-- ============================================================

-- ------------------------------------------------------------
-- Límite de poderes por apoderado: configurable por copropiedad, no
-- universal (algunos reglamentos no ponen límite, otros sí).
-- ------------------------------------------------------------
alter table public.property_profiles add column if not exists max_proxies_per_attorney integer;
alter table public.property_profiles
  add constraint property_profiles_max_proxies_check check (max_proxies_per_attorney is null or max_proxies_per_attorney >= 1);

grant update (max_proxies_per_attorney) on public.property_profiles to authenticated;

-- ------------------------------------------------------------
-- assemblies
-- ------------------------------------------------------------
create table if not exists public.assemblies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null,
  assembly_type text not null default 'ordinaria',
  status text not null default 'draft',
  scheduled_at timestamptz not null,
  location text,
  first_call_quorum_pct numeric(5,2) not null default 51,
  second_call_quorum_pct numeric(5,2),
  agenda_notes text,
  convened_at timestamptz,
  closed_at timestamptz,
  minutes_document_id uuid references public.documents(id) on delete set null,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint assemblies_title_check check (length(btrim(title)) between 2 and 200),
  constraint assemblies_type_check check (assembly_type in ('ordinaria', 'extraordinaria')),
  constraint assemblies_status_check check (status in ('draft', 'in_progress', 'closed', 'cancelled')),
  constraint assemblies_first_call_check check (first_call_quorum_pct > 0 and first_call_quorum_pct <= 100),
  constraint assemblies_second_call_check check (second_call_quorum_pct is null or (second_call_quorum_pct > 0 and second_call_quorum_pct <= 100))
);

create index if not exists idx_assemblies_org_status on public.assemblies (organization_id, status, scheduled_at desc);

alter table public.assemblies enable row level security;

create trigger trg_assemblies_updated_at before update on public.assemblies
  for each row execute function system.update_updated_at();
create trigger trg_assemblies_immutable_org before update on public.assemblies
  for each row execute function public.prevent_organization_change();
create trigger trg_assemblies_tenant_refs before insert or update on public.assemblies
  for each row execute function public.enforce_tenant_refs('minutes_document_id:documents');

create policy "assemblies_select_reader" on public.assemblies for select to authenticated
  using (public.has_org_permission(organization_id, 'assembly.read'));

revoke all on public.assemblies from anon, authenticated;
grant select on public.assemblies to authenticated;

-- ------------------------------------------------------------
-- assembly_agenda_items
-- ------------------------------------------------------------
create table if not exists public.assembly_agenda_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  assembly_id uuid not null references public.assemblies(id) on delete cascade,
  position integer not null default 1,
  title text not null,
  description text,
  requires_vote boolean not null default true,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  constraint agenda_items_title_check check (length(btrim(title)) between 2 and 200),
  constraint agenda_items_status_check check (status in ('pending', 'voting', 'closed'))
);

create index if not exists idx_agenda_items_assembly on public.assembly_agenda_items (assembly_id, position);

alter table public.assembly_agenda_items enable row level security;

create trigger trg_agenda_items_immutable_org before update on public.assembly_agenda_items
  for each row execute function public.prevent_organization_change();
create trigger trg_agenda_items_tenant_refs before insert or update on public.assembly_agenda_items
  for each row execute function public.enforce_tenant_refs('assembly_id:assemblies');

create policy "agenda_items_select_reader" on public.assembly_agenda_items for select to authenticated
  using (public.has_org_permission(organization_id, 'assembly.read'));

revoke all on public.assembly_agenda_items from anon, authenticated;
grant select on public.assembly_agenda_items to authenticated;

-- ------------------------------------------------------------
-- proxies: poderes. Se conserva el historial (revocar crea una fila
-- 'revoked', no borra), así que solo hay una unicidad PARCIAL: máximo un
-- poder 'accepted' por unidad y asamblea a la vez.
-- ------------------------------------------------------------
create table if not exists public.proxies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  assembly_id uuid not null references public.assemblies(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  grantor_person_id uuid not null references public.persons(id) on delete restrict,
  attorney_person_id uuid not null references public.persons(id) on delete restrict,
  status text not null default 'accepted',
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint proxies_status_check check (status in ('accepted', 'revoked')),
  constraint proxies_distinct_people_check check (grantor_person_id <> attorney_person_id)
);

create index if not exists idx_proxies_assembly on public.proxies (assembly_id, unit_id);
create index if not exists idx_proxies_attorney on public.proxies (assembly_id, attorney_person_id) where status = 'accepted';
create unique index if not exists uq_proxies_active_unit on public.proxies (assembly_id, unit_id) where status = 'accepted';

alter table public.proxies enable row level security;

create trigger trg_proxies_immutable_org before update on public.proxies
  for each row execute function public.prevent_organization_change();
create trigger trg_proxies_tenant_refs before insert or update on public.proxies
  for each row execute function public.enforce_tenant_refs('assembly_id:assemblies', 'unit_id:units', 'grantor_person_id:persons', 'attorney_person_id:persons');

create policy "proxies_select_reader" on public.proxies for select to authenticated
  using (public.has_org_permission(organization_id, 'assembly.read'));

revoke all on public.proxies from anon, authenticated;
grant select on public.proxies to authenticated;

-- ------------------------------------------------------------
-- assembly_attendees: una fila por UNIDAD presente (no por persona). El
-- coeficiente queda congelado al momento del registro: si alguien corrige
-- el coeficiente de una unidad después, no reescribe el quórum ya vivido.
-- ------------------------------------------------------------
create table if not exists public.assembly_attendees (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  assembly_id uuid not null references public.assemblies(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  person_id uuid not null references public.persons(id) on delete restrict,
  proxy_id uuid references public.proxies(id) on delete set null,
  coefficient_pct numeric(9,6) not null,
  checked_in_by uuid,
  checked_in_at timestamptz not null default now(),
  constraint assembly_attendees_unit_unique unique (assembly_id, unit_id)
);

create index if not exists idx_attendees_assembly on public.assembly_attendees (assembly_id);

alter table public.assembly_attendees enable row level security;

create trigger trg_attendees_immutable_org before update on public.assembly_attendees
  for each row execute function public.prevent_organization_change();
create trigger trg_attendees_tenant_refs before insert or update on public.assembly_attendees
  for each row execute function public.enforce_tenant_refs('assembly_id:assemblies', 'unit_id:units', 'person_id:persons', 'proxy_id:proxies');

create policy "attendees_select_reader" on public.assembly_attendees for select to authenticated
  using (public.has_org_permission(organization_id, 'assembly.read'));

revoke all on public.assembly_attendees from anon, authenticated;
grant select on public.assembly_attendees to authenticated;

-- ------------------------------------------------------------
-- votes: una fila por unidad y punto del orden del día. El coeficiente se
-- toma del registro de asistencia (assembly_attendees), no se recalcula.
-- ------------------------------------------------------------
create table if not exists public.votes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  assembly_id uuid not null references public.assemblies(id) on delete cascade,
  agenda_item_id uuid not null references public.assembly_agenda_items(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  choice text not null,
  coefficient_pct numeric(9,6) not null,
  cast_by uuid,
  cast_at timestamptz not null default now(),
  constraint votes_choice_check check (choice in ('a_favor', 'en_contra', 'abstencion')),
  constraint votes_unique unique (agenda_item_id, unit_id)
);

create index if not exists idx_votes_item on public.votes (agenda_item_id);

alter table public.votes enable row level security;

create trigger trg_votes_immutable_org before update on public.votes
  for each row execute function public.prevent_organization_change();
create trigger trg_votes_tenant_refs before insert or update on public.votes
  for each row execute function public.enforce_tenant_refs('assembly_id:assemblies', 'agenda_item_id:assembly_agenda_items', 'unit_id:units');

create policy "votes_select_reader" on public.votes for select to authenticated
  using (public.has_org_permission(organization_id, 'assembly.read'));

revoke all on public.votes from anon, authenticated;
grant select on public.votes to authenticated;

-- ------------------------------------------------------------
-- RPCs de escritura y consulta. Todas exigen assembly.write o
-- assembly.read (assert_org_permission deja pasar la clave admin del
-- compute service, igual que el resto de la plataforma).
-- ------------------------------------------------------------
create or replace function public.create_assembly(
  p_organization_id uuid,
  p_title text,
  p_scheduled_at timestamptz,
  p_assembly_type text default 'ordinaria',
  p_location text default null,
  p_first_call_quorum_pct numeric default 51,
  p_second_call_quorum_pct numeric default null,
  p_agenda_notes text default null
)
returns public.assemblies
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_row public.assemblies;
begin
  perform public.assert_org_permission(p_organization_id, 'assembly.write');
  perform public.set_audit_actor('staff');

  insert into public.assemblies (
    organization_id, title, assembly_type, scheduled_at, location,
    first_call_quorum_pct, second_call_quorum_pct, agenda_notes, created_by
  ) values (
    p_organization_id, btrim(p_title), coalesce(p_assembly_type, 'ordinaria'), p_scheduled_at,
    nullif(btrim(coalesce(p_location, '')), ''), coalesce(p_first_call_quorum_pct, 51), p_second_call_quorum_pct,
    nullif(btrim(coalesce(p_agenda_notes, '')), ''), (select auth.uid())
  ) returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.add_agenda_item(
  p_assembly_id uuid,
  p_title text,
  p_description text default null,
  p_requires_vote boolean default true,
  p_position integer default null
)
returns public.assembly_agenda_items
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_assembly public.assemblies;
  v_position integer;
  v_row public.assembly_agenda_items;
begin
  select * into v_assembly from public.assemblies where id = p_assembly_id;
  if not found then
    raise exception 'ASSEMBLY_NOT_FOUND' using errcode = 'P0002';
  end if;
  perform public.assert_org_permission(v_assembly.organization_id, 'assembly.write');
  if v_assembly.status not in ('draft', 'in_progress') then
    raise exception 'VALIDATION_ERROR: la asamblea ya cerró o se canceló' using errcode = '22023';
  end if;

  if p_position is not null then
    v_position := p_position;
  else
    select coalesce(max(position), 0) + 1 into v_position from public.assembly_agenda_items where assembly_id = p_assembly_id;
  end if;

  insert into public.assembly_agenda_items (organization_id, assembly_id, position, title, description, requires_vote)
  values (
    v_assembly.organization_id, p_assembly_id, v_position, btrim(p_title),
    nullif(btrim(coalesce(p_description, '')), ''), coalesce(p_requires_vote, true)
  ) returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.start_assembly(p_assembly_id uuid)
returns public.assemblies
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_row public.assemblies;
begin
  select * into v_row from public.assemblies where id = p_assembly_id for update;
  if not found then
    raise exception 'ASSEMBLY_NOT_FOUND' using errcode = 'P0002';
  end if;
  perform public.assert_org_permission(v_row.organization_id, 'assembly.write');
  if v_row.status <> 'draft' then
    raise exception 'VALIDATION_ERROR: solo una asamblea en borrador puede iniciarse' using errcode = '22023';
  end if;

  update public.assemblies set status = 'in_progress', convened_at = now() where id = p_assembly_id returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.close_assembly(p_assembly_id uuid)
returns public.assemblies
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_row public.assemblies;
begin
  select * into v_row from public.assemblies where id = p_assembly_id for update;
  if not found then
    raise exception 'ASSEMBLY_NOT_FOUND' using errcode = 'P0002';
  end if;
  perform public.assert_org_permission(v_row.organization_id, 'assembly.write');
  if v_row.status <> 'in_progress' then
    raise exception 'VALIDATION_ERROR: solo una asamblea en curso puede cerrarse' using errcode = '22023';
  end if;

  update public.assemblies set status = 'closed', closed_at = now() where id = p_assembly_id returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.cancel_assembly(p_assembly_id uuid, p_reason text default null)
returns public.assemblies
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_row public.assemblies;
begin
  select * into v_row from public.assemblies where id = p_assembly_id for update;
  if not found then
    raise exception 'ASSEMBLY_NOT_FOUND' using errcode = 'P0002';
  end if;
  perform public.assert_org_permission(v_row.organization_id, 'assembly.write');
  if v_row.status not in ('draft', 'in_progress') then
    raise exception 'VALIDATION_ERROR: esa asamblea ya no se puede cancelar' using errcode = '22023';
  end if;

  update public.assemblies
  set status = 'cancelled', agenda_notes = coalesce(nullif(btrim(coalesce(p_reason, '')), ''), agenda_notes)
  where id = p_assembly_id
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.set_assembly_minutes(p_assembly_id uuid, p_document_id uuid)
returns public.assemblies
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_row public.assemblies;
  v_doc public.documents;
begin
  select * into v_row from public.assemblies where id = p_assembly_id for update;
  if not found then
    raise exception 'ASSEMBLY_NOT_FOUND' using errcode = 'P0002';
  end if;
  perform public.assert_org_permission(v_row.organization_id, 'assembly.write');
  if v_row.status = 'cancelled' then
    raise exception 'VALIDATION_ERROR: una asamblea cancelada no lleva acta' using errcode = '22023';
  end if;

  select * into v_doc from public.documents where id = p_document_id and organization_id = v_row.organization_id;
  if not found then
    raise exception 'DOCUMENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_doc.doc_type <> 'assembly_minutes' then
    raise exception 'VALIDATION_ERROR: el documento vinculado debe ser de tipo acta de asamblea' using errcode = '22023';
  end if;

  update public.assemblies set minutes_document_id = p_document_id where id = p_assembly_id returning * into v_row;
  return v_row;
end;
$$;

-- Personas vinculadas a una unidad (propietario, arrendatario, residente,
-- autorizado), solo nombre y relación: exposición mínima necesaria para
-- registrar asistencia y poderes sin exigir residents.read.
create or replace function public.get_unit_active_people(p_organization_id uuid, p_unit_id uuid)
returns table (person_id uuid, full_name text, relation text)
language plpgsql
security definer
stable
set search_path = pg_catalog, public, pg_temp
as $$
begin
  perform public.assert_org_permission(p_organization_id, 'assembly.read');
  return query
  select p.id, p.full_name, up.relation
  from public.unit_persons up
  join public.persons p on p.id = up.person_id
  where up.unit_id = p_unit_id and up.organization_id = p_organization_id
    and (up.ends_on is null or up.ends_on >= current_date)
  order by (up.relation = 'owner') desc, p.full_name;
end;
$$;

-- Búsqueda de personas por nombre para asignar un apoderado que no
-- necesariamente está vinculado a la unidad que representa.
create or replace function public.search_persons_basic(p_organization_id uuid, p_query text, p_limit integer default 10)
returns table (person_id uuid, full_name text)
language plpgsql
security definer
stable
set search_path = pg_catalog, public, pg_temp
as $$
begin
  perform public.assert_org_permission(p_organization_id, 'assembly.write');
  return query
  select p.id, p.full_name
  from public.persons p
  where p.organization_id = p_organization_id
    and (p_query is null or btrim(p_query) = '' or p.full_name ilike '%' || btrim(p_query) || '%')
  order by p.full_name
  limit greatest(1, least(coalesce(p_limit, 10), 25));
end;
$$;

create or replace function public.register_proxy(
  p_organization_id uuid,
  p_assembly_id uuid,
  p_unit_id uuid,
  p_grantor_person_id uuid,
  p_attorney_person_id uuid
)
returns public.proxies
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_assembly public.assemblies;
  v_max_per_attorney integer;
  v_current_count integer;
  v_row public.proxies;
begin
  perform public.assert_org_permission(p_organization_id, 'assembly.write');

  select * into v_assembly from public.assemblies where id = p_assembly_id and organization_id = p_organization_id;
  if not found then
    raise exception 'ASSEMBLY_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_assembly.status not in ('draft', 'in_progress') then
    raise exception 'VALIDATION_ERROR: la asamblea ya cerró o se canceló' using errcode = '22023';
  end if;

  if p_grantor_person_id = p_attorney_person_id then
    raise exception 'VALIDATION_ERROR: el apoderado no puede ser el mismo propietario que otorga el poder' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.unit_persons
    where unit_id = p_unit_id and person_id = p_grantor_person_id and relation = 'owner'
      and (ends_on is null or ends_on >= current_date)
  ) then
    raise exception 'VALIDATION_ERROR: quien otorga el poder no figura como propietario activo de esa unidad' using errcode = '22023';
  end if;

  select max_proxies_per_attorney into v_max_per_attorney
  from public.property_profiles where organization_id = p_organization_id;

  if v_max_per_attorney is not null then
    select count(*) into v_current_count
    from public.proxies
    where assembly_id = p_assembly_id and attorney_person_id = p_attorney_person_id and status = 'accepted';
    if v_current_count >= v_max_per_attorney then
      raise exception 'VALIDATION_ERROR: ese apoderado ya alcanzó el límite de unidades que puede representar' using errcode = '22023';
    end if;
  end if;

  update public.proxies set status = 'revoked'
  where assembly_id = p_assembly_id and unit_id = p_unit_id and status = 'accepted';

  perform public.set_audit_actor('staff');

  insert into public.proxies (organization_id, assembly_id, unit_id, grantor_person_id, attorney_person_id, created_by)
  values (p_organization_id, p_assembly_id, p_unit_id, p_grantor_person_id, p_attorney_person_id, (select auth.uid()))
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.revoke_proxy(p_proxy_id uuid)
returns public.proxies
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_row public.proxies;
begin
  select * into v_row from public.proxies where id = p_proxy_id for update;
  if not found then
    raise exception 'PROXY_NOT_FOUND' using errcode = 'P0002';
  end if;
  perform public.assert_org_permission(v_row.organization_id, 'assembly.write');
  if v_row.status <> 'accepted' then
    raise exception 'VALIDATION_ERROR: ese poder ya no está activo' using errcode = '22023';
  end if;

  update public.proxies set status = 'revoked' where id = p_proxy_id returning * into v_row;
  return v_row;
end;
$$;

-- Registra la asistencia de una UNIDAD (no de una persona): quien llega
-- debe estar vinculado a la unidad, o ser el apoderado de un poder
-- 'accepted' para esa unidad en esta asamblea.
create or replace function public.check_in_unit(
  p_organization_id uuid,
  p_assembly_id uuid,
  p_unit_id uuid,
  p_person_id uuid,
  p_proxy_id uuid default null
)
returns public.assembly_attendees
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_assembly public.assemblies;
  v_proxy public.proxies;
  v_coefficient numeric;
  v_authorized boolean := false;
  v_row public.assembly_attendees;
begin
  perform public.assert_org_permission(p_organization_id, 'assembly.write');

  select * into v_assembly from public.assemblies where id = p_assembly_id and organization_id = p_organization_id;
  if not found then
    raise exception 'ASSEMBLY_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_assembly.status not in ('draft', 'in_progress') then
    raise exception 'VALIDATION_ERROR: la asamblea ya cerró o se canceló' using errcode = '22023';
  end if;

  select coefficient_pct into v_coefficient from public.units where id = p_unit_id and organization_id = p_organization_id;
  if not found then
    raise exception 'UNIT_NOT_FOUND' using errcode = 'P0002';
  end if;

  if p_proxy_id is not null then
    select * into v_proxy from public.proxies
    where id = p_proxy_id and assembly_id = p_assembly_id and unit_id = p_unit_id and status = 'accepted';
    if not found then
      raise exception 'VALIDATION_ERROR: el poder no es válido para esa unidad en esta asamblea' using errcode = '22023';
    end if;
    if v_proxy.attorney_person_id <> p_person_id then
      raise exception 'VALIDATION_ERROR: la persona que llega no es el apoderado del poder indicado' using errcode = '22023';
    end if;
    v_authorized := true;
  else
    v_authorized := exists (
      select 1 from public.unit_persons
      where unit_id = p_unit_id and person_id = p_person_id
        and (ends_on is null or ends_on >= current_date)
    );
  end if;

  if not v_authorized then
    raise exception 'VALIDATION_ERROR: esa persona no está vinculada a la unidad ni tiene un poder válido' using errcode = '22023';
  end if;

  perform public.set_audit_actor('staff');

  insert into public.assembly_attendees (organization_id, assembly_id, unit_id, person_id, proxy_id, coefficient_pct, checked_in_by)
  values (p_organization_id, p_assembly_id, p_unit_id, p_person_id, p_proxy_id, v_coefficient, (select auth.uid()))
  on conflict (assembly_id, unit_id) do update
    set person_id = excluded.person_id, proxy_id = excluded.proxy_id, coefficient_pct = excluded.coefficient_pct,
        checked_in_by = excluded.checked_in_by, checked_in_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

-- Listas con nombre para pantalla: exposición mínima (nombre y unidad,
-- nada más) sin exigir residents.read, igual que get_unit_active_people.
create or replace function public.get_assembly_attendees(p_assembly_id uuid)
returns table (
  id uuid, unit_id uuid, unit_code text, person_id uuid, full_name text,
  proxy_id uuid, coefficient_pct numeric, checked_in_at timestamptz
)
language plpgsql
security definer
stable
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_assembly public.assemblies;
begin
  select * into v_assembly from public.assemblies where assemblies.id = p_assembly_id;
  if not found then
    raise exception 'ASSEMBLY_NOT_FOUND' using errcode = 'P0002';
  end if;
  perform public.assert_org_permission(v_assembly.organization_id, 'assembly.read');

  return query
  select a.id, a.unit_id, u.code, a.person_id, p.full_name, a.proxy_id, a.coefficient_pct, a.checked_in_at
  from public.assembly_attendees a
  join public.units u on u.id = a.unit_id
  join public.persons p on p.id = a.person_id
  where a.assembly_id = p_assembly_id
  order by u.code;
end;
$$;

create or replace function public.get_assembly_proxies(p_assembly_id uuid)
returns table (
  id uuid, unit_id uuid, unit_code text, grantor_person_id uuid, grantor_name text,
  attorney_person_id uuid, attorney_name text, status text, created_at timestamptz
)
language plpgsql
security definer
stable
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_assembly public.assemblies;
begin
  select * into v_assembly from public.assemblies where assemblies.id = p_assembly_id;
  if not found then
    raise exception 'ASSEMBLY_NOT_FOUND' using errcode = 'P0002';
  end if;
  perform public.assert_org_permission(v_assembly.organization_id, 'assembly.read');

  return query
  select pr.id, pr.unit_id, u.code, pr.grantor_person_id, g.full_name, pr.attorney_person_id, at.full_name, pr.status, pr.created_at
  from public.proxies pr
  join public.units u on u.id = pr.unit_id
  join public.persons g on g.id = pr.grantor_person_id
  join public.persons at on at.id = pr.attorney_person_id
  where pr.assembly_id = p_assembly_id
  order by pr.created_at desc;
end;
$$;

create or replace function public.remove_attendee(p_attendee_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_row public.assembly_attendees;
begin
  select * into v_row from public.assembly_attendees where id = p_attendee_id;
  if not found then
    raise exception 'ATTENDEE_NOT_FOUND' using errcode = 'P0002';
  end if;
  perform public.assert_org_permission(v_row.organization_id, 'assembly.write');
  delete from public.assembly_attendees where id = p_attendee_id;
end;
$$;

-- Quórum: SIEMPRE calculado aquí sobre coeficientes reales, nunca a mano.
create or replace function public.get_assembly_quorum(p_assembly_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_assembly public.assemblies;
  v_total_coefficient numeric;
  v_total_units integer;
  v_present_coefficient numeric;
  v_present_units integer;
begin
  select * into v_assembly from public.assemblies where id = p_assembly_id;
  if not found then
    raise exception 'ASSEMBLY_NOT_FOUND' using errcode = 'P0002';
  end if;
  perform public.assert_org_permission(v_assembly.organization_id, 'assembly.read');

  select coalesce(sum(coefficient_pct), 0), count(*) into v_total_coefficient, v_total_units
  from public.units where organization_id = v_assembly.organization_id and is_active;

  select coalesce(sum(coefficient_pct), 0), count(*) into v_present_coefficient, v_present_units
  from public.assembly_attendees where assembly_id = p_assembly_id;

  return jsonb_build_object(
    'assembly_id', p_assembly_id,
    'total_units', v_total_units,
    'total_coefficient_pct', v_total_coefficient,
    'present_units', v_present_units,
    'present_coefficient_pct', v_present_coefficient,
    'first_call_quorum_pct', v_assembly.first_call_quorum_pct,
    'second_call_quorum_pct', v_assembly.second_call_quorum_pct,
    'reached_first_call', v_present_coefficient >= v_assembly.first_call_quorum_pct,
    'reached_second_call', v_assembly.second_call_quorum_pct is null or v_present_coefficient >= v_assembly.second_call_quorum_pct
  );
end;
$$;

create or replace function public.cast_vote(
  p_assembly_id uuid,
  p_agenda_item_id uuid,
  p_unit_id uuid,
  p_choice text
)
returns public.votes
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_assembly public.assemblies;
  v_item public.assembly_agenda_items;
  v_attendee public.assembly_attendees;
  v_row public.votes;
begin
  select * into v_assembly from public.assemblies where id = p_assembly_id;
  if not found then
    raise exception 'ASSEMBLY_NOT_FOUND' using errcode = 'P0002';
  end if;
  perform public.assert_org_permission(v_assembly.organization_id, 'assembly.write');
  if v_assembly.status <> 'in_progress' then
    raise exception 'VALIDATION_ERROR: la asamblea no está en curso' using errcode = '22023';
  end if;

  select * into v_item from public.assembly_agenda_items where id = p_agenda_item_id and assembly_id = p_assembly_id;
  if not found then
    raise exception 'AGENDA_ITEM_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not v_item.requires_vote then
    raise exception 'VALIDATION_ERROR: este punto del orden del día no requiere votación' using errcode = '22023';
  end if;

  select * into v_attendee from public.assembly_attendees where assembly_id = p_assembly_id and unit_id = p_unit_id;
  if not found then
    raise exception 'VALIDATION_ERROR: la unidad no está registrada como asistente de la asamblea' using errcode = '22023';
  end if;

  perform public.set_audit_actor('staff');

  insert into public.votes (organization_id, assembly_id, agenda_item_id, unit_id, choice, coefficient_pct, cast_by)
  values (v_assembly.organization_id, p_assembly_id, p_agenda_item_id, p_unit_id, p_choice, v_attendee.coefficient_pct, (select auth.uid()))
  on conflict (agenda_item_id, unit_id) do update
    set choice = excluded.choice, coefficient_pct = excluded.coefficient_pct, cast_by = excluded.cast_by, cast_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

-- Resultados CRUDOS de la votación: nunca un veredicto de "aprobada" o
-- "rechazada", porque el tipo de mayoría (simple, absoluta, calificada)
-- depende del reglamento y del tema, no es algo que el sistema deba fijar.
create or replace function public.get_vote_results(p_agenda_item_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_item public.assembly_agenda_items;
  v_assembly public.assemblies;
  v_favor numeric; v_contra numeric; v_abstencion numeric;
  v_count_favor integer; v_count_contra integer; v_count_abstencion integer;
begin
  select * into v_item from public.assembly_agenda_items where id = p_agenda_item_id;
  if not found then
    raise exception 'AGENDA_ITEM_NOT_FOUND' using errcode = 'P0002';
  end if;
  select * into v_assembly from public.assemblies where id = v_item.assembly_id;
  perform public.assert_org_permission(v_assembly.organization_id, 'assembly.read');

  select
    coalesce(sum(coefficient_pct) filter (where choice = 'a_favor'), 0),
    coalesce(sum(coefficient_pct) filter (where choice = 'en_contra'), 0),
    coalesce(sum(coefficient_pct) filter (where choice = 'abstencion'), 0),
    count(*) filter (where choice = 'a_favor'),
    count(*) filter (where choice = 'en_contra'),
    count(*) filter (where choice = 'abstencion')
  into v_favor, v_contra, v_abstencion, v_count_favor, v_count_contra, v_count_abstencion
  from public.votes where agenda_item_id = p_agenda_item_id;

  return jsonb_build_object(
    'agenda_item_id', p_agenda_item_id,
    'a_favor_pct', v_favor, 'en_contra_pct', v_contra, 'abstencion_pct', v_abstencion,
    'a_favor_count', v_count_favor, 'en_contra_count', v_count_contra, 'abstencion_count', v_count_abstencion,
    'total_coefficient_voted_pct', v_favor + v_contra + v_abstencion
  );
end;
$$;

revoke execute on function
  public.create_assembly(uuid, text, timestamptz, text, text, numeric, numeric, text),
  public.add_agenda_item(uuid, text, text, boolean, integer),
  public.start_assembly(uuid), public.close_assembly(uuid), public.cancel_assembly(uuid, text),
  public.set_assembly_minutes(uuid, uuid),
  public.get_unit_active_people(uuid, uuid), public.search_persons_basic(uuid, text, integer),
  public.register_proxy(uuid, uuid, uuid, uuid, uuid), public.revoke_proxy(uuid),
  public.check_in_unit(uuid, uuid, uuid, uuid, uuid), public.remove_attendee(uuid),
  public.get_assembly_attendees(uuid), public.get_assembly_proxies(uuid),
  public.get_assembly_quorum(uuid), public.cast_vote(uuid, uuid, uuid, text), public.get_vote_results(uuid)
from public, anon, authenticated;

grant execute on function
  public.create_assembly(uuid, text, timestamptz, text, text, numeric, numeric, text),
  public.add_agenda_item(uuid, text, text, boolean, integer),
  public.start_assembly(uuid), public.close_assembly(uuid), public.cancel_assembly(uuid, text),
  public.set_assembly_minutes(uuid, uuid),
  public.get_unit_active_people(uuid, uuid), public.search_persons_basic(uuid, text, integer),
  public.register_proxy(uuid, uuid, uuid, uuid, uuid), public.revoke_proxy(uuid),
  public.check_in_unit(uuid, uuid, uuid, uuid, uuid), public.remove_attendee(uuid),
  public.get_assembly_attendees(uuid), public.get_assembly_proxies(uuid),
  public.get_assembly_quorum(uuid), public.cast_vote(uuid, uuid, uuid, text), public.get_vote_results(uuid)
to authenticated;

-- ------------------------------------------------------------
-- Auditoría: mismo mecanismo que el resto de la plataforma.
-- ------------------------------------------------------------
create trigger trg_assemblies_audit after insert or update or delete on public.assemblies
  for each row execute function public.audit_row_change();
create trigger trg_agenda_items_audit after insert or update or delete on public.assembly_agenda_items
  for each row execute function public.audit_row_change();
create trigger trg_proxies_audit after insert or update or delete on public.proxies
  for each row execute function public.audit_row_change();
create trigger trg_attendees_audit after insert or update or delete on public.assembly_attendees
  for each row execute function public.audit_row_change();
create trigger trg_votes_audit after insert or update or delete on public.votes
  for each row execute function public.audit_row_change();

-- ------------------------------------------------------------
-- Permisos assembly.read / assembly.write.
-- ------------------------------------------------------------
insert into public.role_permissions (role, permission)
values
  ('owner', 'assembly.read'), ('owner', 'assembly.write'),
  ('admin', 'assembly.read'), ('admin', 'assembly.write'),
  ('assistant', 'assembly.read'), ('assistant', 'assembly.write'),
  ('council', 'assembly.read'), ('council', 'assembly.write'),
  ('auditor', 'assembly.read')
on conflict do nothing;

-- ------------------------------------------------------------
-- Capacidad del asistente: solo informativa (próxima asamblea, orden del
-- día). Nunca certifica quórum ni resultado de una votación.
-- ------------------------------------------------------------
alter table public.agents add column if not exists assembly_enabled boolean not null default true;
grant update (assembly_enabled) on public.agents to authenticated;
