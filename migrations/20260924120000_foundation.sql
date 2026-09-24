-- ============================================================
-- ConvivIA — Fundaciones multi-tenant
--
-- Tenant = copropiedad (organizations). Una empresa administradora que
-- gestiona varias copropiedades es un equipo con membresía en cada una
-- (ver PRPs/convivia-mvp-2026-09-24.md, decisión 1).
--
-- Convenciones de todo el esquema:
--   - Toda tabla de negocio lleva organization_id y RLS activo.
--   - Las funciones auxiliares de RLS son SECURITY DEFINER con
--     search_path fijo (evita recursión de RLS y secuestro de search_path).
--   - EXECUTE sobre funciones se revoca de PUBLIC/anon y se otorga
--     explícitamente: auth.uid() nulo dentro de un RPC significa entonces
--     "clave admin del compute service", nunca un visitante anónimo.
-- ============================================================
create extension if not exists btree_gist;

-- ------------------------------------------------------------
-- organizations: una fila por copropiedad
-- ------------------------------------------------------------
create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  property_type text not null default 'residential_complex',
  status text not null default 'active',
  timezone text not null default 'America/Bogota',
  subscription_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organizations_name_check check (length(btrim(name)) between 2 and 160),
  constraint organizations_property_type_check
    check (property_type in ('residential_complex', 'building', 'condominium', 'mixed_use', 'other')),
  constraint organizations_status_check check (status in ('active', 'suspended', 'cancelled')),
  constraint organizations_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

alter table public.organizations enable row level security;

create trigger trg_organizations_updated_at
  before update on public.organizations
  for each row execute function system.update_updated_at();

grant usage on schema public to authenticated;

-- ------------------------------------------------------------
-- organization_members: equipo de la administración con su rol
-- ------------------------------------------------------------
create table if not exists public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'assistant',
  created_at timestamptz not null default now(),
  constraint organization_members_role_check
    check (role in ('owner', 'admin', 'assistant', 'accountant', 'council', 'auditor')),
  constraint organization_members_org_user_unique unique (organization_id, user_id)
);

create index if not exists idx_org_members_user on public.organization_members (user_id);
create index if not exists idx_org_members_org on public.organization_members (organization_id);

alter table public.organization_members enable row level security;

-- ------------------------------------------------------------
-- role_permissions: RBAC granular. Nunca "admin = acceso total" como
-- único modelo: cada rol recibe capacidades concretas.
-- ------------------------------------------------------------
create table if not exists public.role_permissions (
  role text not null,
  permission text not null,
  primary key (role, permission),
  constraint role_permissions_role_check
    check (role in ('owner', 'admin', 'assistant', 'accountant', 'council', 'auditor'))
);

alter table public.role_permissions enable row level security;

insert into public.role_permissions (role, permission)
select r.role, p.permission
from (values
  ('owner'), ('admin')
) as r(role)
cross join (values
  ('residents.read'), ('residents.write'), ('finance.read'), ('finance.write'),
  ('pqrs.read'), ('pqrs.write'), ('reservations.read'), ('reservations.write'),
  ('communications.read'), ('communications.send'), ('inbox.read'), ('inbox.reply'),
  ('documents.read'), ('documents.write'), ('agent.manage'), ('integrations.manage'),
  ('team.manage'), ('settings.manage'), ('audit.read'), ('data.export')
) as p(permission)
on conflict do nothing;

insert into public.role_permissions (role, permission) values
  -- Auxiliar administrativo: operación diaria, sin configuración ni finanzas de escritura.
  ('assistant', 'residents.read'), ('assistant', 'residents.write'), ('assistant', 'finance.read'),
  ('assistant', 'pqrs.read'), ('assistant', 'pqrs.write'), ('assistant', 'reservations.read'),
  ('assistant', 'reservations.write'), ('assistant', 'communications.read'), ('assistant', 'communications.send'),
  ('assistant', 'inbox.read'), ('assistant', 'inbox.reply'), ('assistant', 'documents.read'),
  -- Contador / tesorero: cartera y pagos.
  ('accountant', 'residents.read'), ('accountant', 'finance.read'), ('accountant', 'finance.write'),
  ('accountant', 'pqrs.read'), ('accountant', 'documents.read'), ('accountant', 'data.export'),
  -- Consejo de administración: supervisión sin datos personales del censo.
  ('council', 'finance.read'), ('council', 'pqrs.read'), ('council', 'reservations.read'),
  ('council', 'communications.read'), ('council', 'documents.read'),
  -- Revisor fiscal: lectura amplia + auditoría.
  ('auditor', 'residents.read'), ('auditor', 'finance.read'), ('auditor', 'pqrs.read'),
  ('auditor', 'reservations.read'), ('auditor', 'communications.read'), ('auditor', 'documents.read'),
  ('auditor', 'audit.read'), ('auditor', 'data.export')
on conflict do nothing;

create policy "role_permissions_select_authenticated"
  on public.role_permissions for select
  to authenticated
  using (true);

revoke all on public.role_permissions from anon, authenticated;
grant select on public.role_permissions to authenticated;

-- ------------------------------------------------------------
-- Funciones auxiliares de autorización (language sql: se validan al
-- crearse, por eso viven después de las tablas que consultan).
-- ------------------------------------------------------------
create or replace function public.get_user_organization_ids()
returns setof uuid
language sql
security definer
stable
set search_path = pg_catalog, public, pg_temp
as $$
  select organization_id from public.organization_members where user_id = (select auth.uid());
$$;

create or replace function public.is_org_member(p_organization_id uuid)
returns boolean
language sql
security definer
stable
set search_path = pg_catalog, public, pg_temp
as $$
  select exists (
    select 1 from public.organization_members
    where organization_id = p_organization_id and user_id = (select auth.uid())
  );
$$;

create or replace function public.is_org_owner(p_organization_id uuid)
returns boolean
language sql
security definer
stable
set search_path = pg_catalog, public, pg_temp
as $$
  select exists (
    select 1 from public.organization_members
    where organization_id = p_organization_id and user_id = (select auth.uid()) and role = 'owner'
  );
$$;

create or replace function public.has_org_permission(p_organization_id uuid, p_permission text)
returns boolean
language sql
security definer
stable
set search_path = pg_catalog, public, pg_temp
as $$
  select exists (
    select 1
    from public.organization_members m
    join public.role_permissions rp on rp.role = m.role
    where m.organization_id = p_organization_id
      and m.user_id = (select auth.uid())
      and rp.permission = p_permission
  );
$$;

create or replace function public.get_my_permissions(p_organization_id uuid)
returns text[]
language sql
security definer
stable
set search_path = pg_catalog, public, pg_temp
as $$
  select coalesce(array_agg(rp.permission order by rp.permission), '{}')
  from public.organization_members m
  join public.role_permissions rp on rp.role = m.role
  where m.organization_id = p_organization_id and m.user_id = (select auth.uid());
$$;

-- Guardas para RPCs. Con auth.uid() nulo la llamada viene del compute
-- service con la clave admin (anon no tiene EXECUTE sobre ningún RPC).
create or replace function public.assert_org_permission(p_organization_id uuid, p_permission text)
returns void
language plpgsql
security definer
stable
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if (select auth.uid()) is null then
    return;
  end if;
  if not public.has_org_permission(p_organization_id, p_permission) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.assert_org_member(p_organization_id uuid)
returns void
language plpgsql
security definer
stable
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if (select auth.uid()) is null then
    return;
  end if;
  if not public.is_org_member(p_organization_id) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
end;
$$;

-- Marca de actor para la auditoría (agent/system/staff). Este backend
-- gestionado bloquea cualquier cambio de configuración de sesión, así que
-- la marca viaja en una tabla temporal propia de la transacción del RPC
-- que la fija (se autodestruye con ON COMMIT DROP; nunca sobrevive ni se
-- filtra a otra llamada).
create or replace function public.set_audit_actor(p_actor_kind text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  create temporary table if not exists pg_temp.audit_actor_ctx (actor_kind text) on commit drop;
  delete from pg_temp.audit_actor_ctx;
  insert into pg_temp.audit_actor_ctx (actor_kind) values (nullif(p_actor_kind, ''));
end;
$$;

-- ------------------------------------------------------------
-- Integridad multi-tenant de referencias cruzadas. Uso:
--   execute function public.enforce_tenant_refs('unit_id:units', 'person_id:persons')
-- Verifica que cada referencia no nula pertenezca a la MISMA copropiedad
-- que la fila (una FK simple no lo garantiza: el id existe, pero en otro
-- tenant).
-- ------------------------------------------------------------
create or replace function public.enforce_tenant_refs()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_new jsonb := to_jsonb(new);
  v_old jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  v_spec text;
  v_column text;
  v_table text;
  v_value uuid;
  v_ref_org uuid;
begin
  foreach v_spec in array tg_argv loop
    v_column := split_part(v_spec, ':', 1);
    v_table := split_part(v_spec, ':', 2);
    if v_new ->> v_column is null then
      continue;
    end if;
    if tg_op = 'UPDATE' and (v_new ->> v_column) is not distinct from (v_old ->> v_column)
       and (v_new ->> 'organization_id') is not distinct from (v_old ->> 'organization_id') then
      continue;
    end if;
    v_value := (v_new ->> v_column)::uuid;
    execute format('select organization_id from public.%I where id = $1', v_table) into v_ref_org using v_value;
    if v_ref_org is null or v_ref_org <> (v_new ->> 'organization_id')::uuid then
      raise exception 'TENANT_MISMATCH: % no pertenece a esta copropiedad', v_column using errcode = '23503';
    end if;
  end loop;
  return new;
end;
$$;

-- Evita mover filas entre copropiedades.
create or replace function public.prevent_organization_change()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if new.organization_id is distinct from old.organization_id then
    raise exception 'organization_id es inmutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- ------------------------------------------------------------
-- Guarda de miembros:
--   1. Solo un owner asigna el rol owner (salvo el bootstrap de una
--      copropiedad sin miembros).
--   2. Solo un owner modifica o elimina a otro owner.
--   3. Nunca queda una copropiedad sin owner (salvo que se esté borrando
--      la copropiedad completa: en el cascade la fila padre ya no existe).
-- ------------------------------------------------------------
create or replace function public.guard_organization_members()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_remaining_owners integer;
  v_existing_members integer;
  v_is_server boolean := (select auth.uid()) is null;
begin
  if tg_op in ('INSERT', 'UPDATE') and new.role = 'owner' and not v_is_server
     and not public.is_org_owner(new.organization_id) then
    select count(*) into v_existing_members
    from public.organization_members
    where organization_id = new.organization_id
      and id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid);
    if v_existing_members > 0 then
      raise exception 'Solo un owner puede asignar el rol owner' using errcode = '42501';
    end if;
  end if;

  if tg_op in ('UPDATE', 'DELETE') and old.role = 'owner' and not v_is_server
     and not public.is_org_owner(old.organization_id)
     and exists (select 1 from public.organizations where id = old.organization_id) then
    raise exception 'Solo un owner puede modificar a otro owner' using errcode = '42501';
  end if;

  if (tg_op = 'UPDATE' and old.role = 'owner' and new.role <> 'owner')
     or (tg_op = 'DELETE' and old.role = 'owner') then
    if exists (select 1 from public.organizations where id = old.organization_id) then
      select count(*) into v_remaining_owners
      from public.organization_members
      where organization_id = old.organization_id and role = 'owner' and id <> old.id;
      if v_remaining_owners = 0 then
        raise exception 'La copropiedad debe conservar al menos un owner' using errcode = '42501';
      end if;
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger trg_guard_organization_members
  before insert or update or delete on public.organization_members
  for each row execute function public.guard_organization_members();

create trigger trg_org_members_immutable_org
  before update on public.organization_members
  for each row execute function public.prevent_organization_change();

-- ------------------------------------------------------------
-- Policies de organizations y organization_members
-- ------------------------------------------------------------
create policy "organizations_select_member"
  on public.organizations for select
  to authenticated
  using (id in (select public.get_user_organization_ids()));

create policy "organizations_update_settings"
  on public.organizations for update
  to authenticated
  using (public.has_org_permission(id, 'settings.manage'))
  with check (public.has_org_permission(id, 'settings.manage'));

create policy "organizations_delete_owner"
  on public.organizations for delete
  to authenticated
  using (public.is_org_owner(id));

-- Sin INSERT directo: se crea con create_organization_with_owner().
revoke all on public.organizations from anon, authenticated;
grant select, delete on public.organizations to authenticated;
grant update (name, property_type, timezone) on public.organizations to authenticated;

create policy "org_members_select_same_org"
  on public.organization_members for select
  to authenticated
  using (organization_id in (select public.get_user_organization_ids()));

create policy "org_members_update_team_manager"
  on public.organization_members for update
  to authenticated
  using (public.has_org_permission(organization_id, 'team.manage'))
  with check (public.has_org_permission(organization_id, 'team.manage'));

create policy "org_members_delete_team_manager"
  on public.organization_members for delete
  to authenticated
  using (public.has_org_permission(organization_id, 'team.manage') or user_id = (select auth.uid()));

-- Altas solo por invitación aceptada (accept_organization_invite) o bootstrap.
revoke all on public.organization_members from anon, authenticated;
grant select, delete on public.organization_members to authenticated;
grant update (role) on public.organization_members to authenticated;

-- ------------------------------------------------------------
-- EXECUTE explícito
-- ------------------------------------------------------------
revoke execute on function
  public.get_user_organization_ids(), public.is_org_member(uuid), public.is_org_owner(uuid),
  public.has_org_permission(uuid, text), public.get_my_permissions(uuid),
  public.assert_org_permission(uuid, text), public.assert_org_member(uuid), public.set_audit_actor(text),
  public.enforce_tenant_refs(), public.prevent_organization_change(), public.guard_organization_members()
from public, anon;

grant execute on function
  public.get_user_organization_ids(), public.is_org_member(uuid), public.is_org_owner(uuid),
  public.has_org_permission(uuid, text), public.get_my_permissions(uuid)
to authenticated;
