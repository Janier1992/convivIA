-- ============================================================
-- Observabilidad del asistente (sección 15 del prompt maestro): tasa de
-- escalamiento, groundedness y errores de herramientas, calculadas sobre
-- ai_traces (que ya registra cada turno, sin contenido de mensajes).
--
-- Nota honesta sobre "tasa de alucinación": no se puede calcular de forma
-- confiable sobre tráfico real sin guardar contenido de mensajes (rompería
-- el diseño de privacidad ya elegido para ai_traces) o sin muestrear con
-- un juez-IA en producción (costo y complejidad no justificados aún). La
-- proxy determinista que SÍ es correcta hoy es "groundedness": de las
-- respuestas que el asistente dio como reply, ¿cuántas se apoyaron en al
-- menos una herramienta real (tools_used no vacío) contra cuántas fueron
-- una respuesta "desnuda" sin ninguna consulta de por medio? Medir la
-- alucinación en sí es el trabajo de la suite de evaluación offline
-- (server/tests/agentSecurity.test.ts), con casos de prueba y respuesta
-- esperada conocida — no de la observabilidad en vivo.
-- ============================================================

create or replace function public.get_agent_observability(p_organization_id uuid, p_days integer default 30)
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_since timestamptz := now() - make_interval(days => greatest(1, least(p_days, 365)));
  v_result jsonb;
begin
  perform public.assert_org_permission(p_organization_id, 'agent.manage');

  with scoped as (
    select * from public.ai_traces
    where organization_id = p_organization_id and created_at >= v_since and not is_preview
  ), totals as (
    select
      count(*) as turns,
      count(*) filter (where outcome = 'reply') as replies,
      count(*) filter (where outcome = 'handoff') as handoffs,
      count(*) filter (where outcome = 'fallback') as fallbacks,
      count(*) filter (where outcome = 'error') as errors,
      count(*) filter (where outcome = 'reply' and coalesce(array_length(tools_used, 1), 0) = 0) as ungrounded_replies,
      count(*) filter (where tool_errors > 0) as turns_with_tool_errors,
      avg(latency_ms) as avg_latency_ms,
      percentile_cont(0.95) within group (order by latency_ms) as p95_latency_ms,
      avg(coalesce(prompt_tokens, 0) + coalesce(completion_tokens, 0)) as avg_tokens
    from scoped
  ), daily as (
    select jsonb_agg(jsonb_build_object(
      'date', d.day, 'turns', d.turns, 'handoffs', d.handoffs, 'errors', d.errors
    ) order by d.day) as rows
    from (
      select created_at::date as day, count(*) as turns,
        count(*) filter (where outcome = 'handoff') as handoffs,
        count(*) filter (where outcome in ('fallback', 'error')) as errors
      from scoped group by created_at::date
    ) d
  ), by_channel as (
    select jsonb_agg(jsonb_build_object('channel', coalesce(channel, 'desconocido'), 'turns', c.turns) order by c.turns desc) as rows
    from (select channel, count(*) as turns from scoped group by channel) c
  )
  select jsonb_build_object(
    'as_of', now(),
    'window_days', p_days,
    'totals', jsonb_build_object(
      'turns', t.turns, 'replies', t.replies, 'handoffs', t.handoffs, 'fallbacks', t.fallbacks, 'errors', t.errors
    ),
    'escalation_rate', case when t.turns > 0 then round(t.handoffs::numeric / t.turns, 4) end,
    'error_rate', case when t.turns > 0 then round((t.fallbacks + t.errors)::numeric / t.turns, 4) end,
    'groundedness_rate', case when t.replies > 0 then round((t.replies - t.ungrounded_replies)::numeric / t.replies, 4) end,
    'tool_error_rate', case when t.turns > 0 then round(t.turns_with_tool_errors::numeric / t.turns, 4) end,
    'avg_latency_ms', round(t.avg_latency_ms::numeric, 0),
    'p95_latency_ms', round(t.p95_latency_ms::numeric, 0),
    'avg_tokens', round(t.avg_tokens::numeric, 0),
    'daily', coalesce(d.rows, '[]'::jsonb),
    'by_channel', coalesce(bc.rows, '[]'::jsonb)
  ) into v_result
  from totals t, daily d, by_channel bc;

  return v_result;
end;
$$;

-- Vista de plataforma (todas las copropiedades): red de seguridad si un
-- cambio de modelo o de prompt degrada la calidad en todo el fleet, no
-- solo en una copropiedad puntual. Solo soporte.
create or replace function public.get_platform_agent_observability(p_days integer default 30)
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_since timestamptz := now() - make_interval(days => greatest(1, least(p_days, 365)));
  v_result jsonb;
begin
  if not public.is_support_staff() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  with scoped as (
    select * from public.ai_traces where created_at >= v_since and not is_preview
  ), totals as (
    select
      count(*) as turns,
      count(distinct organization_id) as organizations,
      count(*) filter (where outcome = 'reply') as replies,
      count(*) filter (where outcome = 'handoff') as handoffs,
      count(*) filter (where outcome = 'fallback') as fallbacks,
      count(*) filter (where outcome = 'error') as errors,
      count(*) filter (where outcome = 'reply' and coalesce(array_length(tools_used, 1), 0) = 0) as ungrounded_replies,
      avg(latency_ms) as avg_latency_ms
    from scoped
  ), daily as (
    select jsonb_agg(jsonb_build_object(
      'date', d.day, 'turns', d.turns, 'handoffs', d.handoffs, 'errors', d.errors
    ) order by d.day) as rows
    from (
      select created_at::date as day, count(*) as turns,
        count(*) filter (where outcome = 'handoff') as handoffs,
        count(*) filter (where outcome in ('fallback', 'error')) as errors
      from scoped group by created_at::date
    ) d
  ), by_model as (
    select jsonb_agg(jsonb_build_object(
      'model', coalesce(m.model, 'desconocido'), 'turns', m.turns,
      'escalation_rate', case when m.turns > 0 then round(m.handoffs::numeric / m.turns, 4) end,
      'error_rate', case when m.turns > 0 then round((m.fallbacks + m.errors)::numeric / m.turns, 4) end
    ) order by m.turns desc) as rows
    from (
      select model, count(*) as turns,
        count(*) filter (where outcome = 'handoff') as handoffs,
        count(*) filter (where outcome = 'fallback') as fallbacks,
        count(*) filter (where outcome = 'error') as errors
      from scoped group by model
    ) m
  ), by_org as (
    select jsonb_agg(jsonb_build_object(
      'organization_id', o.organization_id, 'organization_name', coalesce(pp.display_name, org.name), 'turns', o.turns,
      'escalation_rate', case when o.turns > 0 then round(o.handoffs::numeric / o.turns, 4) end,
      'error_rate', case when o.turns > 0 then round((o.fallbacks + o.errors)::numeric / o.turns, 4) end
    ) order by o.turns desc) as rows
    from (
      select organization_id, count(*) as turns,
        count(*) filter (where outcome = 'handoff') as handoffs,
        count(*) filter (where outcome = 'fallback') as fallbacks,
        count(*) filter (where outcome = 'error') as errors
      from scoped group by organization_id
      order by count(*) desc
      limit 20
    ) o
    join public.organizations org on org.id = o.organization_id
    left join public.property_profiles pp on pp.organization_id = o.organization_id
  )
  select jsonb_build_object(
    'as_of', now(),
    'window_days', p_days,
    'totals', jsonb_build_object(
      'turns', t.turns, 'organizations', t.organizations, 'replies', t.replies,
      'handoffs', t.handoffs, 'fallbacks', t.fallbacks, 'errors', t.errors
    ),
    'escalation_rate', case when t.turns > 0 then round(t.handoffs::numeric / t.turns, 4) end,
    'error_rate', case when t.turns > 0 then round((t.fallbacks + t.errors)::numeric / t.turns, 4) end,
    'groundedness_rate', case when t.replies > 0 then round((t.replies - t.ungrounded_replies)::numeric / t.replies, 4) end,
    'avg_latency_ms', round(t.avg_latency_ms::numeric, 0),
    'daily', coalesce(d.rows, '[]'::jsonb),
    'by_model', coalesce(bm.rows, '[]'::jsonb),
    'top_organizations', coalesce(bo.rows, '[]'::jsonb)
  ) into v_result
  from totals t, daily d, by_model bm, by_org bo;

  return v_result;
end;
$$;

revoke execute on function public.get_agent_observability(uuid, integer), public.get_platform_agent_observability(integer)
  from public, anon;
grant execute on function public.get_agent_observability(uuid, integer), public.get_platform_agent_observability(integer)
  to authenticated;
