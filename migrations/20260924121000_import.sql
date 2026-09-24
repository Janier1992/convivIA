-- ============================================================
-- Importación del censo (unidades, propietarios, ocupantes, coeficientes
-- y saldos iniciales) desde XLSX/CSV.
--
-- cargar -> mapear (frontend) -> validar -> simular -> aprobar -> importar
-- -> auditar. La simulación ejecuta EXACTAMENTE el mismo código que la
-- importación real y luego revierte, así que la vista previa nunca miente.
-- La importación es todo-o-nada; nunca sobrescribe datos personales
-- existentes (solo completa vacíos y avisa) y reporta cada cambio sobre
-- unidades existentes antes de confirmarlo.
-- ============================================================

create table if not exists public.import_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null default 'units_residents',
  file_name text,
  status text not null default 'completed',
  summary jsonb not null default '{}'::jsonb,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  rolled_back_at timestamptz,
  rolled_back_by uuid,
  constraint import_batches_kind_check check (kind in ('units_residents')),
  constraint import_batches_status_check check (status in ('completed', 'rolled_back'))
);

create index if not exists idx_import_batches_org on public.import_batches (organization_id, created_at desc);

alter table public.import_batches enable row level security;

create policy "import_batches_select_reader" on public.import_batches for select to authenticated
  using (public.has_org_permission(organization_id, 'residents.read'));

revoke all on public.import_batches from anon, authenticated;
grant select on public.import_batches to authenticated;

-- ------------------------------------------------------------
-- Persona: busca por documento, luego por teléfono; si no existe la crea.
-- Nunca sobrescribe datos existentes: completa vacíos y reporta avisos.
-- ------------------------------------------------------------
create or replace function public.import_upsert_person(
  p_organization_id uuid, p_batch_id uuid, p_name text, p_document_type text, p_document_number text,
  p_phone text, p_email text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_person public.persons;
  v_phone text := public.normalize_phone(p_phone);
  v_doc text := nullif(upper(regexp_replace(coalesce(p_document_number, ''), '[\s.\-]', '', 'g')), '');
  v_doc_type text := case when v_doc is null then null else coalesce(nullif(upper(btrim(coalesce(p_document_type, ''))), ''), 'CC') end;
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_warnings text[] := '{}';
  v_phone_owner uuid;
begin
  if v_doc is not null then
    select * into v_person from public.persons
    where organization_id = p_organization_id and document_type = v_doc_type and document_number = v_doc;
  end if;
  if v_person.id is null and v_phone is not null then
    select * into v_person from public.persons where organization_id = p_organization_id and phone = v_phone;
  end if;

  if v_person.id is null then
    insert into public.persons (organization_id, full_name, document_type, document_number, phone, email, import_batch_id)
    values (p_organization_id, p_name, v_doc_type, v_doc, v_phone, v_email, p_batch_id)
    returning * into v_person;
    return jsonb_build_object('person_id', v_person.id, 'created', true, 'warnings', to_jsonb(v_warnings));
  end if;

  if lower(v_person.full_name) <> lower(btrim(regexp_replace(p_name, '\s+', ' ', 'g'))) then
    v_warnings := v_warnings || format('La persona ya existe como "%s"; se conserva ese nombre.', v_person.full_name);
  end if;
  if v_person.phone is null and v_phone is not null then
    select id into v_phone_owner from public.persons where organization_id = p_organization_id and phone = v_phone;
    if v_phone_owner is null then
      update public.persons set phone = v_phone where id = v_person.id;
    else
      v_warnings := v_warnings || format('El teléfono %s ya pertenece a otra persona; no se asignó.', v_phone);
    end if;
  elsif v_phone is not null and v_person.phone <> v_phone then
    v_warnings := v_warnings || format('%s ya tiene el teléfono %s; no se cambió.', v_person.full_name, v_person.phone);
  end if;
  if v_person.email is null and v_email is not null then
    update public.persons set email = v_email where id = v_person.id;
  end if;
  return jsonb_build_object('person_id', v_person.id, 'created', false, 'warnings', to_jsonb(v_warnings));
end;
$$;

create or replace function public.import_link_person(
  p_organization_id uuid, p_batch_id uuid, p_unit_id uuid, p_person_id uuid, p_relation text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if exists (
    select 1 from public.unit_persons
    where unit_id = p_unit_id and person_id = p_person_id and relation = p_relation and ends_on is null
  ) then
    return false;
  end if;
  insert into public.unit_persons (organization_id, unit_id, person_id, relation, import_batch_id)
  values (p_organization_id, p_unit_id, p_person_id, p_relation, p_batch_id);
  return true;
end;
$$;

-- ------------------------------------------------------------
-- Una fila: torre, unidad (crear o actualizar reportando cambios),
-- propietario, ocupante y saldo inicial. Devuelve contadores parciales.
-- ------------------------------------------------------------
create or replace function public.import_apply_row(
  p_organization_id uuid, p_batch_id uuid, p_row jsonb, p_can_finance boolean
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_code text := upper(btrim(regexp_replace(coalesce(p_row ->> 'unit_code', ''), '\s+', ' ', 'g')));
  v_type text := coalesce(nullif(btrim(coalesce(p_row ->> 'unit_type', '')), ''), 'apartment');
  v_tower_name text := nullif(btrim(coalesce(p_row ->> 'tower', '')), '');
  v_area numeric := nullif(btrim(coalesce(p_row ->> 'area_m2', '')), '')::numeric;
  v_coef numeric := nullif(btrim(coalesce(p_row ->> 'coefficient_pct', '')), '')::numeric;
  v_balance numeric := nullif(btrim(coalesce(p_row ->> 'opening_balance', '')), '')::numeric;
  v_balance_date date := nullif(btrim(coalesce(p_row ->> 'opening_balance_date', '')), '')::date;
  v_occupant_relation text := coalesce(nullif(btrim(coalesce(p_row ->> 'occupant_relation', '')), ''), 'resident');
  v_tower_id uuid;
  v_unit public.units;
  v_result jsonb := jsonb_build_object('towers_created', 0, 'units_created', 0, 'units_updated', 0,
    'persons_created', 0, 'relations_created', 0, 'opening_balances', 0, 'opening_total', 0,
    'warnings', '[]'::jsonb, 'changes', '[]'::jsonb);
  v_person jsonb;
  v_changes jsonb := '[]'::jsonb;
  v_concept_id uuid;
begin
  if v_code = '' then
    raise exception 'IMPORT_ROW: falta el código de la unidad';
  end if;
  if v_type not in ('apartment', 'house', 'commercial', 'office', 'parking', 'storage', 'other') then
    raise exception 'IMPORT_ROW: tipo de unidad no reconocido (%)', v_type;
  end if;
  if v_occupant_relation not in ('tenant', 'resident', 'authorized') then
    raise exception 'IMPORT_ROW: relación del ocupante no reconocida (%)', v_occupant_relation;
  end if;

  if v_tower_name is not null then
    select id into v_tower_id from public.towers where organization_id = p_organization_id and name = v_tower_name;
    if v_tower_id is null then
      insert into public.towers (organization_id, name, import_batch_id)
      values (p_organization_id, v_tower_name, p_batch_id) returning id into v_tower_id;
      v_result := jsonb_set(v_result, '{towers_created}', '1');
    end if;
  end if;

  select * into v_unit from public.units where organization_id = p_organization_id and code = v_code;
  if v_unit.id is null then
    insert into public.units (organization_id, tower_id, code, unit_type, area_m2, coefficient_pct, import_batch_id)
    values (p_organization_id, v_tower_id, v_code, v_type, v_area, coalesce(v_coef, 0), p_batch_id)
    returning * into v_unit;
    v_result := jsonb_set(v_result, '{units_created}', '1');
  else
    if v_type is distinct from v_unit.unit_type then
      v_changes := v_changes || jsonb_build_object('unit_code', v_code, 'field', 'tipo', 'from', v_unit.unit_type, 'to', v_type);
    end if;
    if v_area is not null and v_area is distinct from v_unit.area_m2 then
      v_changes := v_changes || jsonb_build_object('unit_code', v_code, 'field', 'área', 'from', v_unit.area_m2, 'to', v_area);
    end if;
    if v_coef is not null and v_coef is distinct from v_unit.coefficient_pct then
      v_changes := v_changes || jsonb_build_object('unit_code', v_code, 'field', 'coeficiente', 'from', v_unit.coefficient_pct, 'to', v_coef);
    end if;
    if v_tower_id is not null and v_tower_id is distinct from v_unit.tower_id then
      v_changes := v_changes || jsonb_build_object('unit_code', v_code, 'field', 'torre', 'from', null, 'to', v_tower_name);
    end if;
    if jsonb_array_length(v_changes) > 0 then
      update public.units
      set unit_type = v_type, area_m2 = coalesce(v_area, area_m2), coefficient_pct = coalesce(v_coef, coefficient_pct),
          tower_id = coalesce(v_tower_id, tower_id)
      where id = v_unit.id;
      v_result := jsonb_set(v_result, '{units_updated}', '1');
    end if;
  end if;
  v_result := jsonb_set(v_result, '{changes}', v_changes);

  if nullif(btrim(coalesce(p_row ->> 'owner_name', '')), '') is not null then
    v_person := public.import_upsert_person(p_organization_id, p_batch_id, p_row ->> 'owner_name',
      p_row ->> 'owner_document_type', p_row ->> 'owner_document_number', p_row ->> 'owner_phone', p_row ->> 'owner_email');
    v_result := jsonb_set(v_result, '{persons_created}', to_jsonb((v_result ->> 'persons_created')::int + ((v_person ->> 'created')::boolean)::int));
    v_result := jsonb_set(v_result, '{warnings}', (v_result -> 'warnings') || (v_person -> 'warnings'));
    if public.import_link_person(p_organization_id, p_batch_id, v_unit.id, (v_person ->> 'person_id')::uuid, 'owner') then
      v_result := jsonb_set(v_result, '{relations_created}', to_jsonb((v_result ->> 'relations_created')::int + 1));
    end if;
  end if;

  if nullif(btrim(coalesce(p_row ->> 'occupant_name', '')), '') is not null then
    v_person := public.import_upsert_person(p_organization_id, p_batch_id, p_row ->> 'occupant_name',
      p_row ->> 'occupant_document_type', p_row ->> 'occupant_document_number', p_row ->> 'occupant_phone',
      p_row ->> 'occupant_email');
    v_result := jsonb_set(v_result, '{persons_created}', to_jsonb((v_result ->> 'persons_created')::int + ((v_person ->> 'created')::boolean)::int));
    v_result := jsonb_set(v_result, '{warnings}', (v_result -> 'warnings') || (v_person -> 'warnings'));
    if public.import_link_person(p_organization_id, p_batch_id, v_unit.id, (v_person ->> 'person_id')::uuid, v_occupant_relation) then
      v_result := jsonb_set(v_result, '{relations_created}', to_jsonb((v_result ->> 'relations_created')::int + 1));
    end if;
  end if;

  if coalesce(v_balance, 0) > 0 then
    if not p_can_finance then
      raise exception 'IMPORT_ROW: importar saldos iniciales requiere permiso de cartera';
    end if;
    if exists (select 1 from public.charges where unit_id = v_unit.id and status = 'active' and source = 'import') then
      raise exception 'IMPORT_ROW: la unidad % ya tiene un saldo inicial activo', v_code;
    end if;
    select id into v_concept_id from public.charge_concepts
    where organization_id = p_organization_id and kind = 'opening_balance' and is_system;
    insert into public.charges (organization_id, unit_id, concept_id, description, amount, due_date, source, import_batch_id, created_by)
    values (p_organization_id, v_unit.id, v_concept_id, 'Saldo inicial importado', v_balance,
            coalesce(v_balance_date, public.org_today(p_organization_id)), 'import', p_batch_id, (select auth.uid()));
    v_result := jsonb_set(v_result, '{opening_balances}', '1');
    v_result := jsonb_set(v_result, '{opening_total}', to_jsonb(v_balance));
  elsif v_balance < 0 then
    raise exception 'IMPORT_ROW: el saldo inicial no puede ser negativo (registre el anticipo como pago)';
  end if;

  return v_result;
end;
$$;

create or replace function public.import_units_residents(
  p_organization_id uuid, p_rows jsonb, p_dry_run boolean default true, p_file_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_batch_id uuid := gen_random_uuid();
  v_can_finance boolean;
  v_row jsonb;
  v_row_number integer;
  v_part jsonb;
  v_seen text[] := '{}';
  v_code text;
  v_errors jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_changes jsonb := '[]'::jsonb;
  v_counts jsonb := jsonb_build_object('rows', 0, 'towers_created', 0, 'units_created', 0, 'units_updated', 0,
    'persons_created', 0, 'relations_created', 0, 'opening_balances', 0, 'opening_total', 0);
  v_key text;
  v_applied boolean := false;
  v_message text;
begin
  perform public.assert_org_permission(p_organization_id, 'residents.write');
  v_can_finance := (select auth.uid()) is null or public.has_org_permission(p_organization_id, 'finance.write');
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'VALIDATION_ERROR: el archivo no tiene filas' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) > 5000 then
    raise exception 'VALIDATION_ERROR: máximo 5.000 filas por importación' using errcode = '22023';
  end if;
  perform public.set_audit_actor('staff');

  begin
    for v_row in select value from jsonb_array_elements(p_rows) loop
      v_row_number := coalesce((v_row ->> 'row_number')::integer, jsonb_array_length(v_errors) + 2);
      v_code := upper(btrim(regexp_replace(coalesce(v_row ->> 'unit_code', ''), '\s+', ' ', 'g')));
      if v_code <> '' and v_code = any (v_seen) then
        v_errors := v_errors || jsonb_build_object('row', v_row_number, 'message', 'Unidad repetida en el archivo: ' || v_code);
        continue;
      end if;
      v_seen := v_seen || v_code;
      begin
        v_part := public.import_apply_row(p_organization_id, v_batch_id, v_row, v_can_finance);
        foreach v_key in array array['towers_created', 'units_created', 'units_updated', 'persons_created',
                                     'relations_created', 'opening_balances', 'opening_total'] loop
          v_counts := jsonb_set(v_counts, array[v_key], to_jsonb((v_counts ->> v_key)::numeric + (v_part ->> v_key)::numeric));
        end loop;
        v_warnings := v_warnings || (select coalesce(jsonb_agg(jsonb_build_object('row', v_row_number, 'message', w)), '[]'::jsonb)
                                     from jsonb_array_elements_text(v_part -> 'warnings') w);
        v_changes := v_changes || (select coalesce(jsonb_agg(c || jsonb_build_object('row', v_row_number)), '[]'::jsonb)
                                   from jsonb_array_elements(v_part -> 'changes') c);
      exception when others then
        v_message := case
          when sqlerrm like 'IMPORT_ROW: %' then substr(sqlerrm, 13)
          when sqlerrm like '%uq_persons_org_phone%' then 'Hay un teléfono repetido entre personas distintas'
          when sqlerrm like '%uq_persons_org_document%' then 'Hay un documento repetido entre personas distintas'
          when sqlstate = '22P02' or sqlstate = '22007' or sqlstate = '22008' then 'Hay un número o una fecha con formato inválido'
          when sqlstate = '23514' then 'Un valor está fuera del rango permitido (' || sqlerrm || ')'
          else 'Error inesperado: ' || sqlerrm
        end;
        v_errors := v_errors || jsonb_build_object('row', v_row_number, 'message', v_message);
      end;
    end loop;
    v_counts := jsonb_set(v_counts, '{rows}', to_jsonb(jsonb_array_length(p_rows)));

    if p_dry_run or jsonb_array_length(v_errors) > 0 then
      raise exception 'IMPORT_ROLLBACK';
    end if;

    insert into public.import_batches (id, organization_id, file_name, summary, created_by)
    values (v_batch_id, p_organization_id, p_file_name,
            jsonb_build_object('counts', v_counts, 'warnings', jsonb_array_length(v_warnings),
                               'changes', jsonb_array_length(v_changes)),
            (select auth.uid()));
    v_applied := true;
  exception when others then
    if sqlerrm <> 'IMPORT_ROLLBACK' then
      raise;
    end if;
  end;

  return jsonb_build_object(
    'dry_run', p_dry_run,
    'applied', v_applied,
    'batch_id', case when v_applied then v_batch_id end,
    'counts', v_counts,
    'errors', (select coalesce(jsonb_agg(e), '[]'::jsonb) from (select e from jsonb_array_elements(v_errors) e limit 300) x),
    'error_count', jsonb_array_length(v_errors),
    'warnings', (select coalesce(jsonb_agg(w), '[]'::jsonb) from (select w from jsonb_array_elements(v_warnings) w limit 300) x),
    'changes', (select coalesce(jsonb_agg(c), '[]'::jsonb) from (select c from jsonb_array_elements(v_changes) c limit 500) x)
  );
end;
$$;

-- ------------------------------------------------------------
-- Reversión: deshace lo CREADO por el lote (saldos iniciales, relaciones,
-- unidades, personas y torres nuevas) si nada posterior depende de ello.
-- Los cambios sobre unidades existentes no se revierten (quedan en la
-- auditoría con su valor anterior).
-- ------------------------------------------------------------
create or replace function public.rollback_import_batch(p_batch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_batch public.import_batches;
  v_deleted jsonb;
  v_charges integer;
  v_relations integer;
  v_units integer;
  v_persons integer;
  v_towers integer;
begin
  select * into v_batch from public.import_batches where id = p_batch_id for update;
  if not found then
    raise exception 'IMPORT_NOT_FOUND' using errcode = 'P0002';
  end if;
  perform public.assert_org_permission(v_batch.organization_id, 'residents.write');
  if v_batch.status <> 'completed' then
    raise exception 'IMPORT_ALREADY_ROLLED_BACK' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.charges where import_batch_id = p_batch_id)
     and (select auth.uid()) is not null
     and not public.has_org_permission(v_batch.organization_id, 'finance.write') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  if exists (
    select 1 from public.payments p
    where p.unit_id in (select unit_id from public.charges where import_batch_id = p_batch_id
                        union select id from public.units where import_batch_id = p_batch_id)
      and p.created_at > v_batch.created_at
  ) or exists (
    select 1 from public.charges c
    where c.unit_id in (select id from public.units where import_batch_id = p_batch_id)
      and c.import_batch_id is distinct from p_batch_id
  ) or exists (
    select 1 from public.area_reservations r where r.unit_id in (select id from public.units where import_batch_id = p_batch_id)
  ) or exists (
    select 1 from public.pqrs_tickets t where t.unit_id in (select id from public.units where import_batch_id = p_batch_id)
  ) then
    raise exception 'IMPORT_HAS_DEPENDENT_DATA: hay movimientos posteriores sobre las unidades importadas' using errcode = 'P0001';
  end if;

  create temporary table if not exists pg_temp.import_rollback_ctx (dummy boolean) on commit drop;
  perform public.set_audit_actor('staff');

  delete from public.charges where import_batch_id = p_batch_id;
  get diagnostics v_charges = row_count;
  delete from public.unit_persons where import_batch_id = p_batch_id;
  get diagnostics v_relations = row_count;
  delete from public.units u
  where u.import_batch_id = p_batch_id
    and not exists (select 1 from public.unit_persons up where up.unit_id = u.id)
    and not exists (select 1 from public.charges c where c.unit_id = u.id);
  get diagnostics v_units = row_count;
  delete from public.persons p
  where p.import_batch_id = p_batch_id
    and not exists (select 1 from public.unit_persons up where up.person_id = p.id)
    and not exists (select 1 from public.conversations c where c.person_id = p.id)
    and not exists (select 1 from public.payments py where py.person_id = p.id)
    and not exists (select 1 from public.pqrs_tickets t where t.requester_person_id = p.id);
  get diagnostics v_persons = row_count;
  delete from public.towers t
  where t.import_batch_id = p_batch_id and not exists (select 1 from public.units u where u.tower_id = t.id);
  get diagnostics v_towers = row_count;

  drop table if exists pg_temp.import_rollback_ctx;

  v_deleted := jsonb_build_object('opening_balances', v_charges, 'relations', v_relations, 'units', v_units,
                                  'persons', v_persons, 'towers', v_towers);
  update public.import_batches
  set status = 'rolled_back', rolled_back_at = now(), rolled_back_by = (select auth.uid()),
      summary = summary || jsonb_build_object('rollback', v_deleted)
  where id = p_batch_id;
  return v_deleted;
end;
$$;

revoke execute on function
  public.import_upsert_person(uuid, uuid, text, text, text, text, text),
  public.import_link_person(uuid, uuid, uuid, uuid, text), public.import_apply_row(uuid, uuid, jsonb, boolean),
  public.import_units_residents(uuid, jsonb, boolean, text), public.rollback_import_batch(uuid)
from public, anon, authenticated;

grant execute on function public.import_units_residents(uuid, jsonb, boolean, text), public.rollback_import_batch(uuid)
to authenticated;
