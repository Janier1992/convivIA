-- ============================================================
-- get_agent_observability() pasa a ser una herramienta interna de
-- soporte (se llama desde el detalle de una copropiedad en /soporte, no
-- desde el panel de la propia copropiedad, que ya no la muestra): además
-- del rol con agent.manage, ahora también is_support_staff() puede
-- consultar la observabilidad de CUALQUIER copropiedad, no solo la suya.
-- CREATE OR REPLACE conserva el mismo OID: no hace falta recrear grants.
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
  if not (public.is_support_staff() or public.has_org_permission(p_organization_id, 'agent.manage')) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

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
