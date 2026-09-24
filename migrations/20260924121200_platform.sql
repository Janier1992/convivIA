-- ============================================================
-- Plataforma SaaS: equipo de soporte, suscripción de las copropiedades,
-- bajas de cuentas, políticas de storage y red de seguridad final de
-- privilegios.
--
-- Privacidad (Ley 1581): soporte NO lee censo, mensajes ni cartera de las
-- copropiedades. Ve metadatos operativos (estado, canales, trazas del
-- asistente sin contenido) y cifras agregadas.
-- ============================================================

create table if not exists public.support_staff (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'support',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint support_staff_role_check check (role in ('support', 'admin'))
);

alter table public.support_staff enable row level security;

create policy "support_staff_select_self" on public.support_staff for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.support_staff from anon, authenticated;
grant select on public.support_staff to authenticated;

create or replace function public.is_support_staff()
returns boolean
language sql
security definer
stable
set search_path = pg_catalog, public, pg_temp
as $$
  select exists (select 1 from public.support_staff where user_id = (select auth.uid()) and active);
$$;

create or replace function public.is_support_admin()
returns boolean
language sql
security definer
stable
set search_path = pg_catalog, public, pg_temp
as $$
  select exists (select 1 from public.support_staff where user_id = (select auth.uid()) and active and role = 'admin');
$$;

create policy "organizations_select_support" on public.organizations for select to authenticated
  using (public.is_support_staff());
create policy "organizations_update_support" on public.organizations for update to authenticated
  using (public.is_support_staff()) with check (public.is_support_staff());
create policy "organizations_delete_support_admin" on public.organizations for delete to authenticated
  using (public.is_support_admin());
create policy "property_profiles_select_support" on public.property_profiles for select to authenticated
  using (public.is_support_staff());
create policy "agents_select_support" on public.agents for select to authenticated
  using (public.is_support_staff());
create policy "agents_update_support" on public.agents for update to authenticated
  using (public.is_support_staff()) with check (public.is_support_staff());
create policy "integrations_select_support" on public.integrations for select to authenticated
  using (public.is_support_staff());
create policy "ai_traces_select_support" on public.ai_traces for select to authenticated
  using (public.is_support_staff());

grant update (status) on public.organizations to authenticated;

-- Estado y vencimiento de suscripción: solo soporte (o el servidor). Una
-- copropiedad suspendida no puede reactivarse a sí misma.
create or replace function public.guard_organization_update()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if (select auth.uid()) is null then
    return new;
  end if;
  if (new.status is distinct from old.status or new.subscription_expires_at is distinct from old.subscription_expires_at)
     and not public.is_support_staff() then
    raise exception 'Solo soporte puede cambiar el estado de la suscripción' using errcode = '42501';
  end if;
  if (new.name is distinct from old.name or new.slug is distinct from old.slug
      or new.property_type is distinct from old.property_type or new.timezone is distinct from old.timezone)
     and not public.has_org_permission(new.id, 'settings.manage') then
    raise exception 'Soporte solo puede cambiar el estado de la copropiedad' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger trg_guard_organization_update before update on public.organizations
  for each row execute function public.guard_organization_update();

-- Soporte solo pausa/reactiva el asistente, nunca edita su configuración.
create or replace function public.restrict_support_agent_update()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if (select auth.uid()) is null or public.has_org_permission(new.organization_id, 'agent.manage') then
    return new;
  end if;
  if (to_jsonb(new) - 'enabled' - 'updated_at') is distinct from (to_jsonb(old) - 'enabled' - 'updated_at') then
    raise exception 'Soporte solo puede pausar o reactivar el asistente' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger trg_restrict_support_agent_update before update on public.agents
  for each row execute function public.restrict_support_agent_update();

create table if not exists public.support_notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  author_user_id uuid not null references auth.users(id),
  note text not null,
  created_at timestamptz not null default now(),
  constraint support_notes_length check (length(btrim(note)) between 2 and 4000)
);

alter table public.support_notes enable row level security;

create policy "support_notes_select_support" on public.support_notes for select to authenticated
  using (public.is_support_staff());
create policy "support_notes_insert_support" on public.support_notes for insert to authenticated
  with check (public.is_support_staff() and author_user_id = (select auth.uid()));

revoke all on public.support_notes from anon, authenticated;
grant select, insert on public.support_notes to authenticated;

-- Resumen agregado para soporte (sin datos personales).
create or replace function public.get_support_overview(p_organization_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if not public.is_support_staff() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'units', (select count(*) from public.units where organization_id = p_organization_id),
    'persons', (select count(*) from public.persons where organization_id = p_organization_id),
    'team_members', (select count(*) from public.organization_members where organization_id = p_organization_id),
    'verified_residents', (select count(distinct person_id) from public.conversations
                           where organization_id = p_organization_id and identity_status = 'verified' and not is_preview),
    'conversations_30d', (select count(*) from public.conversations
                          where organization_id = p_organization_id and not is_preview
                            and last_inbound_at > now() - interval '30 days'),
    'pqrs_open', (select count(*) from public.pqrs_tickets
                  where organization_id = p_organization_id and status not in ('answered', 'closed')),
    'outbound_failed_7d', (select count(*) from public.outbound_messages
                           where organization_id = p_organization_id and status = 'failed' and created_at > now() - interval '7 days'),
    'last_activity_at', (select max(last_message_at) from public.conversations where organization_id = p_organization_id)
  );
end;
$$;

-- ------------------------------------------------------------
-- Bajas hechas por soporte: la cuenta no puede recrear la copropiedad en
-- silencio (InsForge no permite borrar usuarios de auth desde la app).
-- ------------------------------------------------------------
create table if not exists public.deleted_user_accounts (
  user_id uuid primary key,
  deleted_at timestamptz not null default now(),
  reason text
);

alter table public.deleted_user_accounts enable row level security;

create policy "deleted_user_accounts_select_self" on public.deleted_user_accounts for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.deleted_user_accounts from anon, authenticated;
grant select on public.deleted_user_accounts to authenticated;

create or replace function public.tombstone_members_on_support_org_delete()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if public.is_support_admin() then
    insert into public.deleted_user_accounts (user_id, reason)
    select user_id, 'organization_deleted_by_support'
    from public.organization_members where organization_id = old.id
    on conflict (user_id) do nothing;
  end if;
  return old;
end;
$$;

create trigger trg_tombstone_members_on_org_delete before delete on public.organizations
  for each row execute function public.tombstone_members_on_support_org_delete();

-- ------------------------------------------------------------
-- Suscripción de la plataforma (lo que la copropiedad paga por ConvivIA).
-- Manual por ahora: se reporta el comprobante y soporte lo confirma.
-- ------------------------------------------------------------
create table if not exists public.subscription_payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  submitted_by uuid not null references auth.users(id),
  receipt_storage_path text not null,
  amount numeric,
  note text,
  status text not null default 'pending',
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint subscription_payments_status_check check (status in ('pending', 'confirmed', 'rejected')),
  constraint subscription_payments_amount_check check (amount is null or amount >= 0)
);

create index if not exists idx_subscription_payments_org on public.subscription_payments (organization_id, created_at desc);

alter table public.subscription_payments enable row level security;

create policy "subscription_payments_select_member" on public.subscription_payments for select to authenticated
  using (public.has_org_permission(organization_id, 'settings.manage'));
create policy "subscription_payments_insert_owner" on public.subscription_payments for insert to authenticated
  with check (public.has_org_permission(organization_id, 'settings.manage') and submitted_by = (select auth.uid()));
create policy "subscription_payments_select_support" on public.subscription_payments for select to authenticated
  using (public.is_support_staff());
create policy "subscription_payments_update_support" on public.subscription_payments for update to authenticated
  using (public.is_support_staff()) with check (public.is_support_staff());

revoke all on public.subscription_payments from anon, authenticated;
grant select, insert on public.subscription_payments to authenticated;
grant update (status, reviewed_by, reviewed_at) on public.subscription_payments to authenticated;

-- ------------------------------------------------------------
-- Storage. Llaves con formato "<organization_id>/...".
--   property-logos         público, escribe settings.manage
--   documents              privado, escribe documents.write (lectura por URL firmada)
--   payment-receipts       privado, escribe finance.write (lectura por URL firmada)
--   subscription-receipts  privado, escribe settings.manage
-- ------------------------------------------------------------
create or replace function public.has_permission_for_storage_key(p_key text, p_permission text)
returns boolean
language plpgsql
security definer
stable
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_org_id uuid;
begin
  begin
    v_org_id := split_part(p_key, '/', 1)::uuid;
  exception when others then
    return false;
  end;
  return public.has_org_permission(v_org_id, p_permission);
end;
$$;

alter table storage.objects enable row level security;

drop policy if exists "property_logos_public_read" on storage.objects;
create policy "property_logos_public_read" on storage.objects for select to anon, authenticated
  using (bucket = 'property-logos');

drop policy if exists "property_logos_write" on storage.objects;
create policy "property_logos_write" on storage.objects for insert to authenticated
  with check (bucket = 'property-logos' and public.has_permission_for_storage_key(key, 'settings.manage'));

drop policy if exists "property_logos_update" on storage.objects;
create policy "property_logos_update" on storage.objects for update to authenticated
  using (bucket = 'property-logos' and public.has_permission_for_storage_key(key, 'settings.manage'))
  with check (bucket = 'property-logos' and public.has_permission_for_storage_key(key, 'settings.manage'));

drop policy if exists "documents_write" on storage.objects;
create policy "documents_write" on storage.objects for insert to authenticated
  with check (bucket = 'documents' and public.has_permission_for_storage_key(key, 'documents.write'));

drop policy if exists "documents_delete" on storage.objects;
create policy "documents_delete" on storage.objects for delete to authenticated
  using (bucket = 'documents' and public.has_permission_for_storage_key(key, 'documents.write'));

drop policy if exists "payment_receipts_write" on storage.objects;
create policy "payment_receipts_write" on storage.objects for insert to authenticated
  with check (bucket = 'payment-receipts' and public.has_permission_for_storage_key(key, 'finance.write'));

drop policy if exists "subscription_receipts_write" on storage.objects;
create policy "subscription_receipts_write" on storage.objects for insert to authenticated
  with check (bucket = 'subscription-receipts' and public.has_permission_for_storage_key(key, 'settings.manage'));

grant select on storage.objects to anon, authenticated;
grant insert, update, delete on storage.objects to authenticated;

-- ------------------------------------------------------------
-- Red de seguridad: anon no ejecuta ni lee nada del esquema público
-- (InsForge otorga privilegios amplios por defecto; RLS ya lo bloquea,
-- esto lo hace explícito).
-- ------------------------------------------------------------
revoke execute on function
  public.is_support_staff(), public.is_support_admin(), public.guard_organization_update(),
  public.restrict_support_agent_update(), public.get_support_overview(uuid),
  public.tombstone_members_on_support_org_delete(), public.has_permission_for_storage_key(text, text)
from public, anon, authenticated;

grant execute on function
  public.is_support_staff(), public.is_support_admin(), public.get_support_overview(uuid),
  public.has_permission_for_storage_key(text, text)
to authenticated;

revoke all on all tables in schema public from anon;
revoke execute on all functions in schema public from anon;
