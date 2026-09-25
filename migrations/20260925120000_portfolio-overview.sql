-- ============================================================
-- Panel consolidado multi-copropiedad (sección "empresa administradora"
-- del roadmap de ampliación): para alguien que administra varias
-- copropiedades a la vez (ya modelado como membresía en varias
-- organizations, selector existente), agrega cartera vencida, PQRS y
-- mantenimiento de todas ellas en una sola consulta.
--
-- Sin tablas nuevas: RLS ya resuelto porque solo lee organization_members
-- del usuario autenticado (auth.uid()), y cada cifra se calcula con la
-- misma función determinista que ya usa su módulo (ledger_open_items),
-- nunca reinventando la lógica de mora. Cada bloque de cifras se oculta
-- (null) si el usuario no tiene el permiso de lectura correspondiente EN
-- ESA copropiedad puntual — el rol puede variar de una a otra.
-- ============================================================

create or replace function public.get_portfolio_overview()
returns table (
  organization_id uuid,
  organization_name text,
  role text,
  units_total integer,
  overdue_total numeric,
  units_overdue integer,
  pqrs_open integer,
  pqrs_overdue integer,
  work_orders_open integer,
  work_orders_pending_approval integer
)
language sql
security definer
stable
set search_path = pg_catalog, public, pg_temp
as $$
  select
    o.id,
    coalesce(pp.display_name, o.name),
    m.role,
    (select count(*)::integer from public.units u where u.organization_id = o.id and u.is_active),
    case when public.has_org_permission(o.id, 'finance.read') then
      coalesce((
        select sum(li.unpaid) from public.ledger_open_items(o.id) li
        where li.unpaid > 0 and li.due_date < public.org_today(o.id)
      ), 0)
    end,
    case when public.has_org_permission(o.id, 'finance.read') then
      (
        select count(distinct li.unit_id)::integer from public.ledger_open_items(o.id) li
        where li.unpaid > 0 and li.due_date < public.org_today(o.id)
      )
    end,
    case when public.has_org_permission(o.id, 'pqrs.read') then
      (select count(*)::integer from public.pqrs_tickets
       where organization_id = o.id and status not in ('answered', 'closed'))
    end,
    case when public.has_org_permission(o.id, 'pqrs.read') then
      (select count(*)::integer from public.pqrs_tickets
       where organization_id = o.id and status not in ('answered', 'closed') and due_at < now())
    end,
    case when public.has_org_permission(o.id, 'maintenance.read') then
      (select count(*)::integer from public.work_orders
       where organization_id = o.id and status not in ('closed', 'cancelled'))
    end,
    case when public.has_org_permission(o.id, 'maintenance.read') then
      (select count(*)::integer from public.work_orders where organization_id = o.id and status = 'diagnosed')
    end
  from public.organization_members m
  join public.organizations o on o.id = m.organization_id
  left join public.property_profiles pp on pp.organization_id = o.id
  where m.user_id = (select auth.uid())
  order by coalesce(pp.display_name, o.name);
$$;

revoke execute on function public.get_portfolio_overview() from public, anon;
grant execute on function public.get_portfolio_overview() to authenticated;
