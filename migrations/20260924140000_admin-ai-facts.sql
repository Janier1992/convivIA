-- ============================================================
-- Hechos deterministas para la IA de administradores (sección 10 del
-- prompt maestro): "¿qué cambió en la cartera esta semana?". La IA solo
-- redacta sobre estas cifras, nunca las calcula ni las inventa.
-- ============================================================

create or replace function public.get_portfolio_weekly_changes(p_organization_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_today date := public.org_today(p_organization_id);
  v_week_ago date := v_today - 7;
  v_collected_7d numeric;
  v_billed_7d numeric;
  v_overdue_now numeric;
  v_units_overdue_now integer;
  v_newly_overdue jsonb;
  v_recovered jsonb;
begin
  perform public.assert_org_permission(p_organization_id, 'finance.read');

  select coalesce(sum(amount), 0) into v_collected_7d
  from public.payments
  where organization_id = p_organization_id and status = 'confirmed' and paid_on >= v_week_ago;

  select coalesce(sum(amount), 0) into v_billed_7d
  from public.charges
  where organization_id = p_organization_id and status = 'active' and created_at::date >= v_week_ago;

  -- STABLE no admite DDL (una tabla temporal cuenta como una): la "aging"
  -- de cada unidad se recalcula en cada consulta en vez de materializarla.
  with items as (
    select * from public.ledger_open_items(p_organization_id) where unpaid > 0
  ), aging as (
    select unit_id,
      min(due_date) filter (where due_date < v_today) as oldest_overdue,
      coalesce(sum(unpaid) filter (where due_date < v_today), 0) as overdue
    from items group by unit_id
  )
  select
    coalesce(sum(a.overdue), 0),
    count(*) filter (where a.overdue > 0),
    coalesce(jsonb_agg(jsonb_build_object('unidad', u.code, 'vencido_desde', a.oldest_overdue) order by a.oldest_overdue)
      filter (where a.overdue > 0 and a.oldest_overdue >= v_week_ago), '[]'::jsonb)
  into v_overdue_now, v_units_overdue_now, v_newly_overdue
  from aging a
  join public.units u on u.id = a.unit_id;

  -- Unidades que pagaron esta semana y hoy ya no tienen saldo vencido.
  with items as (
    select * from public.ledger_open_items(p_organization_id) where unpaid > 0
  ), aging as (
    select unit_id, coalesce(sum(unpaid) filter (where due_date < v_today), 0) as overdue
    from items group by unit_id
  )
  select coalesce(jsonb_agg(distinct jsonb_build_object('unidad', u.code)), '[]'::jsonb)
  into v_recovered
  from public.payments p
  join public.units u on u.id = p.unit_id
  left join aging a on a.unit_id = p.unit_id
  where p.organization_id = p_organization_id and p.status = 'confirmed' and p.paid_on >= v_week_ago
    and coalesce(a.overdue, 0) = 0;

  return jsonb_build_object(
    'as_of', v_today,
    'desde', v_week_ago,
    'recaudado_7d', v_collected_7d,
    'facturado_7d', v_billed_7d,
    'cartera_vencida_total', v_overdue_now,
    'unidades_en_mora_total', v_units_overdue_now,
    'unidades_nuevas_en_mora', v_newly_overdue,
    'unidades_recuperadas', v_recovered
  );
end;
$$;

revoke execute on function public.get_portfolio_weekly_changes(uuid) from public, anon, authenticated;
grant execute on function public.get_portfolio_weekly_changes(uuid) to authenticated;
