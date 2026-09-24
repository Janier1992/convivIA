-- ============================================================
-- Portería y visitantes: la función de más uso diario en un conjunto
-- residencial colombiano (cada visita, cada domicilio, cada vehículo),
-- ausente en la primera versión de ConvivIA. Cubre:
--   - preautorizaciones que crea un residente (panel o chat);
--   - bitácora real de ingreso/salida en la garita;
--   - paquetes recibidos y su entrega;
--   - novedades generales de portería.
-- Sigue exactamente las convenciones de 20260924120000_foundation.sql:
-- RLS activo, funciones SECURITY DEFINER con search_path fijo, y
-- assert_org_permission() como guarda de cada RPC de escritura.
-- ============================================================

-- ------------------------------------------------------------
-- visitor_authorizations: preautorización de una visita esperada.
-- La crea el equipo desde el panel o el asistente desde el chat
-- (proponer_autorizacion_visitante -> confirmar_accion), nunca la
-- ejecuta el modelo directamente.
-- ------------------------------------------------------------
create table if not exists public.visitor_authorizations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  requested_by_person_id uuid references public.persons(id) on delete set null,
  visitor_name text not null,
  visitor_document text,
  visitor_phone text,
  vehicle_plate text,
  valid_from timestamptz not null default now(),
  valid_until timestamptz not null,
  status text not null default 'pending',
  notes text,
  source text not null default 'dashboard',
  conversation_id uuid references public.conversations(id) on delete set null,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint visitor_authorizations_name_check check (length(btrim(visitor_name)) between 2 and 120),
  constraint visitor_authorizations_status_check check (status in ('pending', 'used', 'expired', 'revoked')),
  constraint visitor_authorizations_source_check check (source in ('dashboard', 'agent')),
  constraint visitor_authorizations_window_check check (valid_until > valid_from)
);

create index if not exists idx_visitor_auth_org_unit on public.visitor_authorizations (organization_id, unit_id, status);
create index if not exists idx_visitor_auth_window on public.visitor_authorizations (organization_id, valid_from, valid_until);

alter table public.visitor_authorizations enable row level security;

create trigger trg_visitor_auth_updated_at before update on public.visitor_authorizations
  for each row execute function system.update_updated_at();
create trigger trg_visitor_auth_immutable_org before update on public.visitor_authorizations
  for each row execute function public.prevent_organization_change();
create trigger trg_visitor_auth_tenant_refs before insert or update on public.visitor_authorizations
  for each row execute function public.enforce_tenant_refs('unit_id:units', 'requested_by_person_id:persons', 'conversation_id:conversations');

create policy "visitor_auth_select_reader" on public.visitor_authorizations for select to authenticated
  using (public.has_org_permission(organization_id, 'porteria.read'));

revoke all on public.visitor_authorizations from anon, authenticated;
grant select on public.visitor_authorizations to authenticated;

-- ------------------------------------------------------------
-- visitor_logs: bitácora real de ingreso/salida en la garita. Puede
-- venir de una preautorización o registrarse directamente (proveedor,
-- domicilio, visita sin aviso previo).
-- ------------------------------------------------------------
create table if not exists public.visitor_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  unit_id uuid references public.units(id) on delete set null,
  authorization_id uuid references public.visitor_authorizations(id) on delete set null,
  visitor_name text not null,
  visitor_document text,
  visitor_phone text,
  vehicle_plate text,
  kind text not null default 'visitor',
  entry_at timestamptz not null default now(),
  exit_at timestamptz,
  registered_by uuid,
  notes text,
  created_at timestamptz not null default now(),
  constraint visitor_logs_name_check check (length(btrim(visitor_name)) between 2 and 120),
  constraint visitor_logs_kind_check check (kind in ('visitor', 'service', 'delivery', 'other')),
  constraint visitor_logs_exit_check check (exit_at is null or exit_at >= entry_at)
);

create index if not exists idx_visitor_logs_org_unit on public.visitor_logs (organization_id, unit_id, entry_at desc);
create index if not exists idx_visitor_logs_open on public.visitor_logs (organization_id, exit_at) where exit_at is null;
create index if not exists idx_visitor_logs_plate on public.visitor_logs (organization_id, vehicle_plate) where vehicle_plate is not null;

alter table public.visitor_logs enable row level security;

create trigger trg_visitor_logs_immutable_org before update on public.visitor_logs
  for each row execute function public.prevent_organization_change();
create trigger trg_visitor_logs_tenant_refs before insert or update on public.visitor_logs
  for each row execute function public.enforce_tenant_refs('unit_id:units', 'authorization_id:visitor_authorizations');

create policy "visitor_logs_select_reader" on public.visitor_logs for select to authenticated
  using (public.has_org_permission(organization_id, 'porteria.read'));

revoke all on public.visitor_logs from anon, authenticated;
grant select on public.visitor_logs to authenticated;

-- ------------------------------------------------------------
-- packages: encomiendas y domicilios recibidos en portería.
-- ------------------------------------------------------------
create table if not exists public.packages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  courier text,
  description text,
  status text not null default 'received',
  received_at timestamptz not null default now(),
  received_by uuid,
  delivered_at timestamptz,
  delivered_to_name text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint packages_status_check check (status in ('received', 'delivered', 'returned')),
  constraint packages_delivered_check check (status <> 'delivered' or delivered_at is not null)
);

create index if not exists idx_packages_org_unit on public.packages (organization_id, unit_id, status);
create index if not exists idx_packages_pending on public.packages (organization_id, status) where status = 'received';

alter table public.packages enable row level security;

create trigger trg_packages_updated_at before update on public.packages
  for each row execute function system.update_updated_at();
create trigger trg_packages_immutable_org before update on public.packages
  for each row execute function public.prevent_organization_change();
create trigger trg_packages_tenant_refs before insert or update on public.packages
  for each row execute function public.enforce_tenant_refs('unit_id:units');

create policy "packages_select_reader" on public.packages for select to authenticated
  using (public.has_org_permission(organization_id, 'porteria.read'));

revoke all on public.packages from anon, authenticated;
grant select on public.packages to authenticated;

-- ------------------------------------------------------------
-- gate_notes: novedades generales de portería (no ligadas a una unidad):
-- rondas, incidentes, fallas de equipos, cambios de turno.
-- ------------------------------------------------------------
create table if not exists public.gate_notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  category text not null default 'general',
  note text not null,
  shift text,
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint gate_notes_category_check check (category in ('security', 'maintenance', 'general', 'incident')),
  constraint gate_notes_note_check check (length(btrim(note)) between 3 and 2000)
);

create index if not exists idx_gate_notes_org_created on public.gate_notes (organization_id, created_at desc);

alter table public.gate_notes enable row level security;

create policy "gate_notes_select_reader" on public.gate_notes for select to authenticated
  using (public.has_org_permission(organization_id, 'porteria.read'));

revoke all on public.gate_notes from anon, authenticated;
grant select on public.gate_notes to authenticated;

-- ------------------------------------------------------------
-- RPCs de escritura. Todas exigen porteria.write cuando hay un usuario
-- autenticado (assert_org_permission deja pasar la clave admin del
-- compute service, igual que el resto de la plataforma).
-- ------------------------------------------------------------
create or replace function public.create_visitor_authorization(
  p_organization_id uuid,
  p_unit_id uuid,
  p_visitor_name text,
  p_valid_from timestamptz,
  p_valid_until timestamptz,
  p_visitor_document text default null,
  p_visitor_phone text default null,
  p_vehicle_plate text default null,
  p_notes text default null,
  p_requested_by_person_id uuid default null,
  p_conversation_id uuid default null,
  p_source text default 'dashboard',
  p_actor_kind text default 'staff'
)
returns public.visitor_authorizations
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_row public.visitor_authorizations;
begin
  perform public.assert_org_permission(p_organization_id, 'porteria.write');
  perform public.set_audit_actor(coalesce(p_actor_kind, 'staff'));

  if p_valid_until <= p_valid_from then
    raise exception 'VALIDATION_ERROR: la ventana de autorización no es válida' using errcode = '22023';
  end if;
  if p_valid_until > p_valid_from + interval '30 days' then
    raise exception 'VALIDATION_ERROR: la autorización no puede durar más de 30 días' using errcode = '22023';
  end if;

  insert into public.visitor_authorizations (
    organization_id, unit_id, requested_by_person_id, visitor_name, visitor_document, visitor_phone,
    vehicle_plate, valid_from, valid_until, notes, source, conversation_id, created_by
  ) values (
    p_organization_id, p_unit_id, p_requested_by_person_id, btrim(p_visitor_name),
    nullif(btrim(coalesce(p_visitor_document, '')), ''), nullif(btrim(coalesce(p_visitor_phone, '')), ''),
    nullif(upper(btrim(coalesce(p_vehicle_plate, ''))), ''), p_valid_from, p_valid_until,
    nullif(btrim(coalesce(p_notes, '')), ''), coalesce(p_source, 'dashboard'), p_conversation_id, (select auth.uid())
  ) returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.revoke_visitor_authorization(p_authorization_id uuid, p_reason text default null)
returns public.visitor_authorizations
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_row public.visitor_authorizations;
begin
  select * into v_row from public.visitor_authorizations where id = p_authorization_id for update;
  if not found then
    raise exception 'AUTHORIZATION_NOT_FOUND' using errcode = 'P0002';
  end if;
  perform public.assert_org_permission(v_row.organization_id, 'porteria.write');
  if v_row.status <> 'pending' then
    raise exception 'VALIDATION_ERROR: solo se puede anular una autorización pendiente' using errcode = '22023';
  end if;

  update public.visitor_authorizations
  set status = 'revoked', notes = coalesce(nullif(btrim(coalesce(p_reason, '')), ''), notes)
  where id = p_authorization_id
  returning * into v_row;
  return v_row;
end;
$$;

-- Registra el ingreso real en la garita. Si viene de una preautorización
-- vigente, la marca como usada; si ya venció o no está pendiente, sigue
-- registrando el ingreso pero lo deja anotado (nunca bloquea al portero
-- por un problema de datos: la decisión de dejar pasar es humana).
create or replace function public.register_visitor_entry(
  p_organization_id uuid,
  p_visitor_name text,
  p_unit_id uuid default null,
  p_authorization_id uuid default null,
  p_visitor_document text default null,
  p_visitor_phone text default null,
  p_vehicle_plate text default null,
  p_kind text default 'visitor',
  p_notes text default null
)
returns public.visitor_logs
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_auth public.visitor_authorizations;
  v_unit_id uuid := p_unit_id;
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  v_log public.visitor_logs;
begin
  perform public.assert_org_permission(p_organization_id, 'porteria.write');
  perform public.set_audit_actor('staff');

  if p_authorization_id is not null then
    select * into v_auth from public.visitor_authorizations
    where id = p_authorization_id and organization_id = p_organization_id for update;
    if not found then
      raise exception 'AUTHORIZATION_NOT_FOUND' using errcode = 'P0002';
    end if;
    v_unit_id := coalesce(v_unit_id, v_auth.unit_id);
    if v_auth.status = 'pending' and now() between v_auth.valid_from and v_auth.valid_until then
      update public.visitor_authorizations set status = 'used' where id = v_auth.id;
    else
      v_notes := trim(both E'\n' from
        coalesce(v_notes || E'\n', '') || 'Autorización ' ||
        case when v_auth.status <> 'pending' then 'ya estaba ' || v_auth.status else 'fuera de la ventana autorizada' end || '.');
    end if;
  end if;

  insert into public.visitor_logs (
    organization_id, unit_id, authorization_id, visitor_name, visitor_document, visitor_phone,
    vehicle_plate, kind, registered_by, notes
  ) values (
    p_organization_id, v_unit_id, p_authorization_id, btrim(p_visitor_name),
    nullif(btrim(coalesce(p_visitor_document, '')), ''), nullif(btrim(coalesce(p_visitor_phone, '')), ''),
    nullif(upper(btrim(coalesce(p_vehicle_plate, ''))), ''), coalesce(p_kind, 'visitor'), (select auth.uid()), v_notes
  ) returning * into v_log;

  return v_log;
end;
$$;

create or replace function public.register_visitor_exit(p_visitor_log_id uuid)
returns public.visitor_logs
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_log public.visitor_logs;
begin
  select * into v_log from public.visitor_logs where id = p_visitor_log_id for update;
  if not found then
    raise exception 'VISITOR_LOG_NOT_FOUND' using errcode = 'P0002';
  end if;
  perform public.assert_org_permission(v_log.organization_id, 'porteria.write');
  if v_log.exit_at is not null then
    raise exception 'VALIDATION_ERROR: esa salida ya estaba registrada' using errcode = '22023';
  end if;

  update public.visitor_logs set exit_at = now() where id = p_visitor_log_id returning * into v_log;
  return v_log;
end;
$$;

-- Registra un paquete y, si la unidad tiene un contacto con canal
-- conectado, le avisa por chat (mismo mecanismo que las novedades de
-- PQRS o comunicados: enqueue_outbound_to_person).
create or replace function public.register_package(
  p_organization_id uuid,
  p_unit_id uuid,
  p_courier text default null,
  p_description text default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_package public.packages;
  v_unit_code text;
  v_contact_person uuid;
  v_outbound uuid;
begin
  perform public.assert_org_permission(p_organization_id, 'porteria.write');
  perform public.set_audit_actor('staff');

  insert into public.packages (organization_id, unit_id, courier, description, received_by, notes)
  values (
    p_organization_id, p_unit_id, nullif(btrim(coalesce(p_courier, '')), ''),
    nullif(btrim(coalesce(p_description, '')), ''), (select auth.uid()), nullif(btrim(coalesce(p_notes, '')), '')
  ) returning * into v_package;

  select code into v_unit_code from public.units where id = p_unit_id;
  select up.person_id into v_contact_person
  from public.unit_persons up
  where up.unit_id = p_unit_id and up.organization_id = p_organization_id
    and (up.ends_on is null or up.ends_on >= current_date)
  order by up.is_primary_contact desc, up.created_at
  limit 1;

  if v_contact_person is not null then
    v_outbound := public.enqueue_outbound_to_person(
      p_organization_id, v_contact_person, 'system',
      'Portería recibió un paquete para tu unidad ' || coalesce(v_unit_code, '') ||
        coalesce(' (' || v_package.courier || ')', '') || '. Puedes reclamarlo cuando quieras.',
      null, '{}'::jsonb, 'package', v_package.id, 'package_received:' || v_package.id, true, null
    );
  end if;

  return jsonb_build_object('package', to_jsonb(v_package), 'notified', v_outbound is not null);
end;
$$;

create or replace function public.deliver_package(p_package_id uuid, p_delivered_to_name text default null)
returns public.packages
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_package public.packages;
begin
  select * into v_package from public.packages where id = p_package_id for update;
  if not found then
    raise exception 'PACKAGE_NOT_FOUND' using errcode = 'P0002';
  end if;
  perform public.assert_org_permission(v_package.organization_id, 'porteria.write');
  if v_package.status = 'delivered' then
    raise exception 'VALIDATION_ERROR: ese paquete ya fue entregado' using errcode = '22023';
  end if;

  update public.packages
  set status = 'delivered', delivered_at = now(), delivered_to_name = nullif(btrim(coalesce(p_delivered_to_name, '')), '')
  where id = p_package_id
  returning * into v_package;
  return v_package;
end;
$$;

create or replace function public.add_gate_note(
  p_organization_id uuid,
  p_note text,
  p_category text default 'general',
  p_shift text default null
)
returns public.gate_notes
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_row public.gate_notes;
begin
  perform public.assert_org_permission(p_organization_id, 'porteria.write');
  perform public.set_audit_actor('staff');

  insert into public.gate_notes (organization_id, category, note, shift, created_by)
  values (p_organization_id, coalesce(p_category, 'general'), btrim(p_note), nullif(btrim(coalesce(p_shift, '')), ''), (select auth.uid()))
  returning * into v_row;
  return v_row;
end;
$$;

revoke execute on function
  public.create_visitor_authorization(uuid, uuid, text, timestamptz, timestamptz, text, text, text, text, uuid, uuid, text, text),
  public.revoke_visitor_authorization(uuid, text),
  public.register_visitor_entry(uuid, text, uuid, uuid, text, text, text, text, text),
  public.register_visitor_exit(uuid),
  public.register_package(uuid, uuid, text, text, text),
  public.deliver_package(uuid, text),
  public.add_gate_note(uuid, text, text, text)
from public, anon, authenticated;

grant execute on function
  public.create_visitor_authorization(uuid, uuid, text, timestamptz, timestamptz, text, text, text, text, uuid, uuid, text, text),
  public.revoke_visitor_authorization(uuid, text),
  public.register_visitor_entry(uuid, text, uuid, uuid, text, text, text, text, text),
  public.register_visitor_exit(uuid),
  public.register_package(uuid, uuid, text, text, text),
  public.deliver_package(uuid, text),
  public.add_gate_note(uuid, text, text, text)
to authenticated;

-- ------------------------------------------------------------
-- Auditoría: mismo mecanismo que el resto de la plataforma.
-- ------------------------------------------------------------
create trigger trg_visitor_authorizations_audit after insert or update or delete on public.visitor_authorizations
  for each row execute function public.audit_row_change();
create trigger trg_visitor_logs_audit after insert or update or delete on public.visitor_logs
  for each row execute function public.audit_row_change();
create trigger trg_packages_audit after insert or update or delete on public.packages
  for each row execute function public.audit_row_change();
create trigger trg_gate_notes_audit after insert or delete on public.gate_notes
  for each row execute function public.audit_row_change();

-- ------------------------------------------------------------
-- Permiso porteria.read / porteria.write. owner y admin ya lo reciben
-- todo por cross join en foundation.sql para los permisos que existían
-- en ese momento; estos dos son nuevos, así que se insertan aparte.
-- ------------------------------------------------------------
insert into public.role_permissions (role, permission)
values
  ('owner', 'porteria.read'), ('owner', 'porteria.write'),
  ('admin', 'porteria.read'), ('admin', 'porteria.write'),
  ('assistant', 'porteria.read'), ('assistant', 'porteria.write'),
  ('council', 'porteria.read'),
  ('auditor', 'porteria.read')
on conflict do nothing;

-- ------------------------------------------------------------
-- Capacidad del asistente: autorizar visitantes y consultar paquetes
-- desde el chat, activable/desactivable como el resto de capacidades.
-- ------------------------------------------------------------
alter table public.agents add column if not exists visitors_enabled boolean not null default true;
grant update (visitors_enabled) on public.agents to authenticated;
