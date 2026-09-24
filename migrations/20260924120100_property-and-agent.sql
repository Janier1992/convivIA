-- ============================================================
-- Perfil de la copropiedad, configuración del asistente de IA,
-- integraciones de canales y suscripciones push.
-- ============================================================

-- ------------------------------------------------------------
-- property_profiles (1:1 con organizations). Toda regla que depende del
-- reglamento o de decisiones de la copropiedad es configurable aquí; nada
-- de esto se asume universal (tasa de mora, redondeo, días de vencimiento).
-- ------------------------------------------------------------
create table if not exists public.property_profiles (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  display_name text not null,
  legal_name text,
  nit text,
  address text,
  city text,
  department text,
  phone text,
  email text,
  website text,
  logo_url text,
  description text,
  administrator_name text,
  office_hours text,
  privacy_policy_url text,
  payment_instructions text,
  currency text not null default 'COP',
  due_day integer not null default 10,
  late_interest_monthly_rate numeric(6,4) not null default 0,
  rounding_unit integer not null default 100,
  payment_reminder_days_before integer not null default 3,
  payment_reminder_days_after integer not null default 5,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint property_profiles_due_day_check check (due_day between 1 and 28),
  -- Tasa mensual en porcentaje (ej. 1.8 = 1,8% mensual). El tope legal
  -- vigente lo certifica la Superintendencia Financiera y cambia: la
  -- plataforma no lo asume, lo configura la administración.
  constraint property_profiles_interest_check check (late_interest_monthly_rate between 0 and 10),
  constraint property_profiles_rounding_check check (rounding_unit in (1, 10, 50, 100, 500, 1000)),
  constraint property_profiles_reminders_check
    check (payment_reminder_days_before between 0 and 30 and payment_reminder_days_after between 0 and 60)
);

alter table public.property_profiles enable row level security;

create trigger trg_property_profiles_updated_at
  before update on public.property_profiles
  for each row execute function system.update_updated_at();

create policy "property_profiles_select_member"
  on public.property_profiles for select
  to authenticated
  using (public.is_org_member(organization_id));

create policy "property_profiles_update_settings"
  on public.property_profiles for update
  to authenticated
  using (public.has_org_permission(organization_id, 'settings.manage'))
  with check (public.has_org_permission(organization_id, 'settings.manage'));

revoke all on public.property_profiles from anon, authenticated;
grant select on public.property_profiles to authenticated;
grant update (
  display_name, legal_name, nit, address, city, department, phone, email, website, logo_url, description,
  administrator_name, office_hours, privacy_policy_url, payment_instructions, currency, due_day,
  late_interest_monthly_rate, rounding_unit, payment_reminder_days_before, payment_reminder_days_after
) on public.property_profiles to authenticated;

-- ------------------------------------------------------------
-- agents: asistente de IA de la copropiedad (1:1). Cada capacidad se
-- puede apagar sin tocar código; las reglas críticas viven en el servidor
-- y no son editables desde aquí.
-- ------------------------------------------------------------
create table if not exists public.agents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations(id) on delete cascade,
  name text not null default 'Clara',
  enabled boolean not null default true,
  tone text not null default 'friendly',
  system_instructions text,
  finance_enabled boolean not null default true,
  payment_reports_enabled boolean not null default true,
  pqrs_enabled boolean not null default true,
  reservations_enabled boolean not null default true,
  documents_enabled boolean not null default true,
  handoff_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agents_tone_check check (tone in ('friendly', 'formal')),
  constraint agents_name_check check (length(btrim(name)) between 2 and 40),
  constraint agents_instructions_length check (system_instructions is null or length(system_instructions) <= 4000)
);

alter table public.agents enable row level security;

create trigger trg_agents_updated_at
  before update on public.agents
  for each row execute function system.update_updated_at();

create trigger trg_agents_immutable_org
  before update on public.agents
  for each row execute function public.prevent_organization_change();

create policy "agents_select_member"
  on public.agents for select
  to authenticated
  using (public.is_org_member(organization_id));

create policy "agents_update_manager"
  on public.agents for update
  to authenticated
  using (public.has_org_permission(organization_id, 'agent.manage'))
  with check (public.has_org_permission(organization_id, 'agent.manage'));

revoke all on public.agents from anon, authenticated;
grant select on public.agents to authenticated;
grant update (
  name, enabled, tone, system_instructions, finance_enabled, payment_reports_enabled, pqrs_enabled,
  reservations_enabled, documents_enabled, handoff_enabled
) on public.agents to authenticated;

create or replace function public.create_default_agent_for_org()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  insert into public.agents (organization_id) values (new.id) on conflict (organization_id) do nothing;
  return new;
end;
$$;

create trigger trg_create_default_agent
  after insert on public.organizations
  for each row execute function public.create_default_agent_for_org();

-- ------------------------------------------------------------
-- agent_rules: reglas adicionales de la copropiedad (se agregan DESPUÉS
-- de las reglas críticas y nunca pueden contradecirlas).
-- ------------------------------------------------------------
create table if not exists public.agent_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  instruction text not null,
  priority integer not null default 100,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agent_rules_instruction_length check (length(instruction) <= 1000)
);

create index if not exists idx_agent_rules_org on public.agent_rules (organization_id, priority);

alter table public.agent_rules enable row level security;

create trigger trg_agent_rules_updated_at
  before update on public.agent_rules
  for each row execute function system.update_updated_at();

create trigger trg_agent_rules_immutable_org
  before update on public.agent_rules
  for each row execute function public.prevent_organization_change();

create policy "agent_rules_select_member"
  on public.agent_rules for select
  to authenticated
  using (public.is_org_member(organization_id));

create policy "agent_rules_insert_manager"
  on public.agent_rules for insert
  to authenticated
  with check (public.has_org_permission(organization_id, 'agent.manage'));

create policy "agent_rules_update_manager"
  on public.agent_rules for update
  to authenticated
  using (public.has_org_permission(organization_id, 'agent.manage'))
  with check (public.has_org_permission(organization_id, 'agent.manage'));

create policy "agent_rules_delete_manager"
  on public.agent_rules for delete
  to authenticated
  using (public.has_org_permission(organization_id, 'agent.manage'));

revoke all on public.agent_rules from anon, authenticated;
grant select, insert, update, delete on public.agent_rules to authenticated;

-- ------------------------------------------------------------
-- integrations: credenciales de canales por copropiedad. La columna
-- credentials nunca es legible por el data API (ni siquiera por el
-- owner): solo el compute service y las Edge Functions con clave admin.
-- ------------------------------------------------------------
create table if not exists public.integrations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null,
  status text not null default 'disconnected',
  credentials jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  connected_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint integrations_provider_check check (provider in ('telegram', 'twilio')),
  constraint integrations_status_check check (status in ('disconnected', 'connected', 'error')),
  constraint integrations_org_provider_unique unique (organization_id, provider)
);

create index if not exists idx_integrations_org on public.integrations (organization_id);
create index if not exists idx_integrations_provider_status on public.integrations (provider, status);

alter table public.integrations enable row level security;

create trigger trg_integrations_updated_at
  before update on public.integrations
  for each row execute function system.update_updated_at();

create policy "integrations_select_manager"
  on public.integrations for select
  to authenticated
  using (public.has_org_permission(organization_id, 'integrations.manage'));

revoke all on public.integrations from anon, authenticated;
grant select (id, organization_id, provider, status, metadata, connected_at, updated_at)
  on public.integrations to authenticated;

-- Estado de canales visible para cualquier miembro (sin metadata sensible).
create or replace function public.get_channel_status(p_organization_id uuid)
returns table (provider text, status text, connected_at timestamptz)
language plpgsql
security definer
stable
set search_path = pg_catalog, public, pg_temp
as $$
begin
  perform public.assert_org_member(p_organization_id);
  return query
    select i.provider, i.status, i.connected_at
    from public.integrations i
    where i.organization_id = p_organization_id;
end;
$$;

-- ------------------------------------------------------------
-- push_subscriptions: Web Push por dispositivo de un miembro del equipo.
-- ------------------------------------------------------------
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  constraint uq_push_subscriptions_endpoint unique (endpoint)
);

create index if not exists idx_push_subscriptions_org on public.push_subscriptions (organization_id);

alter table public.push_subscriptions enable row level security;

create policy "push_subscriptions_select_own"
  on public.push_subscriptions for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "push_subscriptions_insert_own"
  on public.push_subscriptions for insert
  to authenticated
  with check (user_id = (select auth.uid()) and public.is_org_member(organization_id));

create policy "push_subscriptions_delete_own"
  on public.push_subscriptions for delete
  to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.push_subscriptions from anon, authenticated;
grant select, insert, delete on public.push_subscriptions to authenticated;

revoke execute on function public.create_default_agent_for_org(), public.get_channel_status(uuid) from public, anon;
grant execute on function public.get_channel_status(uuid) to authenticated;
