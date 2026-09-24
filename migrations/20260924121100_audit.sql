-- ============================================================
-- Auditoría: quién + qué + cuándo + desde dónde + antes/después.
-- Registrada por triggers en la base de datos (nunca depende de texto
-- generado por IA ni del código del cliente). Las credenciales y el texto
-- completo de documentos se excluyen del registro.
-- ============================================================

create table if not exists public.audit_events (
  id bigint generated always as identity primary key,
  organization_id uuid references public.organizations(id) on delete cascade,
  actor_user_id uuid,
  actor_kind text not null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  before jsonb,
  after jsonb,
  changed_fields text[],
  client_ip text,
  created_at timestamptz not null default now(),
  constraint audit_events_action_check check (action in ('insert', 'update', 'delete')),
  constraint audit_events_actor_check check (actor_kind in ('staff', 'agent', 'system', 'resident'))
);

create index if not exists idx_audit_events_org_created on public.audit_events (organization_id, created_at desc);
create index if not exists idx_audit_events_entity on public.audit_events (entity_type, entity_id);

alter table public.audit_events enable row level security;

create policy "audit_events_select_auditor" on public.audit_events for select to authenticated
  using (public.has_org_permission(organization_id, 'audit.read'));

revoke all on public.audit_events from anon, authenticated;
grant select on public.audit_events to authenticated;

create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_before jsonb;
  v_after jsonb;
  v_changed text[];
  v_org uuid;
  v_entity uuid;
  v_actor text;
  v_actor_kind text;
  v_ip text;
  v_headers text;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    v_before := to_jsonb(old) - 'credentials' - 'tsv' - 'source_text';
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    v_after := to_jsonb(new) - 'credentials' - 'tsv' - 'source_text';
  end if;

  if tg_op = 'UPDATE' then
    select array_agg(e.key order by e.key) into v_changed
    from jsonb_each(v_after) e
    where (v_before -> e.key) is distinct from e.value and e.key <> 'updated_at';
    if v_changed is null then
      return new;
    end if;
    select jsonb_object_agg(k, v_before -> k), jsonb_object_agg(k, v_after -> k)
    into v_before, v_after
    from unnest(v_changed) k;
  end if;

  if tg_table_name = 'organizations' then
    v_org := coalesce(v_after ->> 'id', v_before ->> 'id', to_jsonb(old) ->> 'id')::uuid;
  else
    v_org := coalesce(to_jsonb(coalesce(new, old)) ->> 'organization_id')::uuid;
  end if;
  -- Si la copropiedad completa se está eliminando no hay a quién auditar.
  if v_org is null or not exists (select 1 from public.organizations where id = v_org) then
    return coalesce(new, old);
  end if;

  v_entity := coalesce(to_jsonb(coalesce(new, old)) ->> 'id', to_jsonb(coalesce(new, old)) ->> 'organization_id')::uuid;

  -- La marca de actor la deja set_audit_actor() en una tabla temporal de
  -- esta misma transacción (ver esa función: este backend bloquea cambiar
  -- la configuración de sesión, así que no se puede leer de una GUC).
  if to_regclass('pg_temp.audit_actor_ctx') is not null then
    select actor_kind into v_actor_kind from pg_temp.audit_actor_ctx limit 1;
  end if;
  v_actor := case
    when (select auth.uid()) is not null then 'staff'
    else coalesce(v_actor_kind, 'system')
  end;

  begin
    v_headers := current_setting('request.headers', true);
    if coalesce(v_headers, '') <> '' then
      v_ip := nullif(btrim(split_part(coalesce(v_headers::json ->> 'x-forwarded-for', v_headers::json ->> 'x-real-ip', ''), ',', 1)), '');
    end if;
  exception when others then
    v_ip := null;
  end;

  insert into public.audit_events (
    organization_id, actor_user_id, actor_kind, action, entity_type, entity_id, before, after, changed_fields, client_ip
  ) values (
    v_org, (select auth.uid()), case when v_actor in ('staff', 'agent', 'system', 'resident') then v_actor else 'system' end,
    lower(tg_op), tg_table_name, v_entity, v_before, v_after, v_changed, v_ip
  );
  return coalesce(new, old);
end;
$$;

revoke execute on function public.audit_row_change() from public, anon, authenticated;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'organization_members', 'organization_invites', 'property_profiles', 'agents', 'agent_rules', 'integrations',
    'towers', 'units', 'persons', 'unit_persons', 'charge_concepts', 'payments', 'pqrs_categories', 'pqrs_tickets',
    'common_areas', 'common_area_hours', 'area_reservations', 'announcements', 'documents'
  ] loop
    execute format(
      'create trigger trg_%1$s_audit after insert or update or delete on public.%1$I
         for each row execute function public.audit_row_change()', v_table);
  end loop;
end $$;

create trigger trg_organizations_audit after update or delete on public.organizations
  for each row execute function public.audit_row_change();

-- Las liquidaciones masivas quedan en charge_batches; cada cargo manual,
-- de reserva o de importación, y toda anulación, queda aquí.
create trigger trg_charges_audit_insert after insert on public.charges
  for each row when (new.source not in ('batch', 'interest'))
  execute function public.audit_row_change();
create trigger trg_charges_audit_change after update or delete on public.charges
  for each row execute function public.audit_row_change();
