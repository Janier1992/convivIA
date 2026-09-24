-- ============================================================
-- Equipo de la administración: invitaciones por email, listado del
-- equipo con su correo y contadores atómicos por copropiedad.
-- ============================================================

-- ------------------------------------------------------------
-- Invitaciones de equipo por email. InsForge no expone auth.users por el
-- data API: la persona invitada acepta al iniciar sesión con ese email.
-- ------------------------------------------------------------
create or replace function public.current_user_email()
returns text
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select email from auth.users where id = (select auth.uid());
$$;

create table if not exists public.organization_invites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  role text not null default 'assistant',
  status text not null default 'pending',
  invited_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_invites_role_check
    check (role in ('admin', 'assistant', 'accountant', 'council', 'auditor')),
  constraint organization_invites_status_check check (status in ('pending', 'accepted', 'revoked')),
  constraint organization_invites_org_email_unique unique (organization_id, email)
);

create index if not exists idx_org_invites_email on public.organization_invites (lower(email));
create index if not exists idx_org_invites_org on public.organization_invites (organization_id);

alter table public.organization_invites enable row level security;

create trigger trg_organization_invites_updated_at
  before update on public.organization_invites
  for each row execute function system.update_updated_at();

create policy "org_invites_select_team_manager"
  on public.organization_invites for select
  to authenticated
  using (public.has_org_permission(organization_id, 'team.manage'));

create policy "org_invites_select_own_email"
  on public.organization_invites for select
  to authenticated
  using (status = 'pending' and lower(email) = lower(public.current_user_email()));

create policy "org_invites_insert_team_manager"
  on public.organization_invites for insert
  to authenticated
  with check (public.has_org_permission(organization_id, 'team.manage') and invited_by = (select auth.uid()));

create policy "org_invites_delete_team_manager"
  on public.organization_invites for delete
  to authenticated
  using (public.has_org_permission(organization_id, 'team.manage'));

revoke all on public.organization_invites from anon, authenticated;
grant select, insert, delete on public.organization_invites to authenticated;

create or replace function public.accept_organization_invite(p_invite_id uuid)
returns public.organization_members
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_invite public.organization_invites;
  v_member public.organization_members;
begin
  if (select auth.uid()) is null then
    raise exception 'Se requiere autenticación' using errcode = '28000';
  end if;

  select * into v_invite from public.organization_invites where id = p_invite_id for update;
  if not found then
    raise exception 'INVITE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_invite.status <> 'pending' then
    raise exception 'INVITE_NOT_PENDING' using errcode = 'P0001';
  end if;
  if lower(v_invite.email) <> lower(public.current_user_email()) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  insert into public.organization_members (organization_id, user_id, role)
  values (v_invite.organization_id, (select auth.uid()), v_invite.role)
  on conflict (organization_id, user_id) do update set role = excluded.role
  returning * into v_member;

  update public.organization_invites set status = 'accepted' where id = p_invite_id;
  return v_member;
end;
$$;

-- Equipo con email visible para la página de Equipo (auth.users no está
-- expuesto por el data API).
create or replace function public.get_team_members(p_organization_id uuid)
returns table (member_id uuid, user_id uuid, role text, email text, full_name text, created_at timestamptz)
language plpgsql
security definer
stable
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if not public.is_org_member(p_organization_id) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  return query
    select m.id, m.user_id, m.role, u.email::text,
           coalesce(u.profile ->> 'name', u.profile ->> 'full_name')::text, m.created_at
    from public.organization_members m
    join auth.users u on u.id = m.user_id
    where m.organization_id = p_organization_id
    order by m.created_at;
end;
$$;

-- ------------------------------------------------------------
-- Contadores por copropiedad (radicados de PQRS, etc.). Atómicos por
-- UPDATE ... RETURNING dentro de la transacción del llamador.
-- ------------------------------------------------------------
create table if not exists public.organization_counters (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  counter_key text not null,
  value bigint not null default 0,
  primary key (organization_id, counter_key)
);

alter table public.organization_counters enable row level security;
revoke all on public.organization_counters from anon, authenticated;

create or replace function public.next_org_counter(p_organization_id uuid, p_counter_key text)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_value bigint;
begin
  insert into public.organization_counters (organization_id, counter_key, value)
  values (p_organization_id, p_counter_key, 1)
  on conflict (organization_id, counter_key)
  do update set value = public.organization_counters.value + 1
  returning value into v_value;
  return v_value;
end;
$$;

revoke execute on function
  public.current_user_email(), public.accept_organization_invite(uuid), public.get_team_members(uuid),
  public.next_org_counter(uuid, text)
from public, anon;

grant execute on function
  public.current_user_email(), public.accept_organization_invite(uuid), public.get_team_members(uuid)
to authenticated;
