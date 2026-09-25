-- ============================================================
-- Completa la IA para administradores (sección 10 del prompt maestro):
-- de las 7 capacidades que describe, faltaban "mantenimientos pendientes"
-- y "resumen de la última acta" — ambas ya son posibles sin tablas
-- nuevas gracias a P1 (asamblea) y P2 (mantenimiento). Mismo patrón que
-- get_portfolio_weekly_changes: la función determinista trae los hechos,
-- la Edge Function ai-assist solo los redacta, nunca los calcula.
-- ============================================================

create or replace function public.get_maintenance_priority_brief(p_organization_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_today date := public.org_today(p_organization_id);
  v_result jsonb;
begin
  perform public.assert_org_permission(p_organization_id, 'maintenance.read');

  select jsonb_build_object(
    'as_of', now(),
    'today', v_today,
    'cronogramas_vencidos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'titulo', ms.title, 'activo', a.name, 'vence', ms.next_due_on, 'dias_vencido', v_today - ms.next_due_on
      ) order by ms.next_due_on)
      from public.maintenance_schedules ms
      left join public.assets a on a.id = ms.asset_id
      where ms.organization_id = p_organization_id and ms.is_active and ms.next_due_on < v_today
    ), '[]'::jsonb),
    'cronogramas_proximos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'titulo', ms.title, 'activo', a.name, 'vence', ms.next_due_on
      ) order by ms.next_due_on)
      from public.maintenance_schedules ms
      left join public.assets a on a.id = ms.asset_id
      where ms.organization_id = p_organization_id and ms.is_active
        and ms.next_due_on between v_today and v_today + 7
    ), '[]'::jsonb),
    'ordenes_esperando_aprobacion', coalesce((
      select jsonb_agg(jsonb_build_object(
        'codigo', wo.code, 'titulo', wo.title, 'prioridad', wo.priority, 'dias_esperando', v_today - wo.created_at::date
      ) order by wo.created_at)
      from public.work_orders wo
      where wo.organization_id = p_organization_id and wo.status = 'diagnosed'
    ), '[]'::jsonb),
    'ordenes_esperando_validacion', coalesce((
      select jsonb_agg(jsonb_build_object(
        'codigo', wo.code, 'titulo', wo.title, 'prioridad', wo.priority, 'dias_esperando', v_today - wo.created_at::date
      ) order by wo.created_at)
      from public.work_orders wo
      where wo.organization_id = p_organization_id and wo.status = 'pending_validation'
    ), '[]'::jsonb),
    'ordenes_urgentes_abiertas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'codigo', wo.code, 'titulo', wo.title, 'estado', wo.status
      ) order by wo.created_at)
      from public.work_orders wo
      where wo.organization_id = p_organization_id and wo.priority = 'urgent' and wo.status not in ('closed', 'cancelled')
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

-- Trae el texto de la última asamblea que ya tiene acta cargada (documents,
-- vía assemblies.minutes_document_id), pegado o extraído de sus chunks —
-- lo que exista. Nunca calcula quórum ni resultados: eso lo hace
-- get_assembly_quorum / get_vote_results, y el resumen de texto no los toca.
create or replace function public.get_latest_assembly_minutes(p_organization_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_assembly record;
  v_doc record;
  v_text text;
begin
  perform public.assert_org_permission(p_organization_id, 'assembly.read');

  select id, title, assembly_type, scheduled_at, closed_at, minutes_document_id
  into v_assembly
  from public.assemblies
  where organization_id = p_organization_id and minutes_document_id is not null
  order by coalesce(closed_at, scheduled_at) desc
  limit 1;

  if v_assembly.id is null then
    return jsonb_build_object('found', false);
  end if;

  select id, title, effective_date, source_text into v_doc
  from public.documents where id = v_assembly.minutes_document_id;

  v_text := v_doc.source_text;
  if v_text is null or length(btrim(v_text)) = 0 then
    select string_agg(content, E'\n\n' order by chunk_index) into v_text
    from public.document_chunks where document_id = v_assembly.minutes_document_id;
  end if;

  return jsonb_build_object(
    'found', true,
    'assembly', jsonb_build_object(
      'id', v_assembly.id, 'title', v_assembly.title, 'assembly_type', v_assembly.assembly_type,
      'scheduled_at', v_assembly.scheduled_at, 'closed_at', v_assembly.closed_at
    ),
    'document', jsonb_build_object('id', v_doc.id, 'title', v_doc.title, 'effective_date', v_doc.effective_date),
    'full_text', left(coalesce(v_text, ''), 12000)
  );
end;
$$;

revoke execute on function public.get_maintenance_priority_brief(uuid), public.get_latest_assembly_minutes(uuid) from public, anon;
grant execute on function public.get_maintenance_priority_brief(uuid), public.get_latest_assembly_minutes(uuid) to authenticated;
