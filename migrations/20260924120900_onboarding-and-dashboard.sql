-- ============================================================
-- Alta de copropiedades y tablero del administrador.
-- ============================================================

-- ------------------------------------------------------------
-- create_organization_with_owner: único punto de entrada para crear una
-- copropiedad. Crea de forma atómica la organización, el owner, el
-- perfil, el asistente (trigger), los conceptos de cobro del sistema y las
-- categorías de PQRS por defecto (editables después).
-- ------------------------------------------------------------
create or replace function public.create_organization_with_owner(
  p_name text,
  p_slug text,
  p_property_type text default 'residential_complex',
  p_timezone text default 'America/Bogota',
  p_city text default null
)
returns public.organizations
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_org public.organizations;
begin
  if (select auth.uid()) is null then
    raise exception 'Se requiere autenticación' using errcode = '28000';
  end if;

  insert into public.organizations (name, slug, property_type, timezone)
  values (btrim(p_name), p_slug, coalesce(p_property_type, 'residential_complex'), coalesce(p_timezone, 'America/Bogota'))
  returning * into v_org;

  insert into public.organization_members (organization_id, user_id, role)
  values (v_org.id, (select auth.uid()), 'owner');

  insert into public.property_profiles (organization_id, display_name, city)
  values (v_org.id, v_org.name, nullif(btrim(coalesce(p_city, '')), ''));

  insert into public.charge_concepts (organization_id, name, kind, calculation, amount, is_system) values
    (v_org.id, 'Cuota de administración', 'ordinary', 'coefficient', 0, false),
    (v_org.id, 'Cuota extraordinaria', 'extraordinary', 'manual', 0, false),
    (v_org.id, 'Multa', 'fine', 'manual', 0, false),
    (v_org.id, 'Intereses de mora', 'interest', 'manual', 0, true),
    (v_org.id, 'Alquiler de zonas comunes', 'common_area', 'manual', 0, true),
    (v_org.id, 'Saldo inicial', 'opening_balance', 'manual', 0, true);

  insert into public.pqrs_categories (organization_id, name, sla_hours, sort_order) values
    (v_org.id, 'Mantenimiento', 72, 10),
    (v_org.id, 'Seguridad', 24, 20),
    (v_org.id, 'Convivencia', 120, 30),
    (v_org.id, 'Zonas comunes', 72, 40),
    (v_org.id, 'Administración y cartera', 120, 50),
    (v_org.id, 'Certificados y paz y salvo', 72, 60),
    (v_org.id, 'Actualización de datos', 72, 70),
    (v_org.id, 'Otro', 120, 80);

  return v_org;
end;
$$;

-- ------------------------------------------------------------
-- Tablero del administrador: una sola consulta, cifras deterministas.
-- Las cifras financieras solo se devuelven con finance.read.
-- ------------------------------------------------------------
create or replace function public.get_admin_dashboard(p_organization_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_today date := public.org_today(p_organization_id);
  v_month_start date := date_trunc('month', public.org_today(p_organization_id))::date;
  v_tz text := (select timezone from public.organizations where id = p_organization_id);
  v_finance jsonb := null;
begin
  perform public.assert_org_member(p_organization_id);

  if (select auth.uid()) is null or public.has_org_permission(p_organization_id, 'finance.read') then
    with portfolio as (
      select li.unit_id, li.due_date, li.unpaid
      from public.ledger_open_items(p_organization_id) li
      where li.unpaid > 0
    )
    select jsonb_build_object(
      'collected_this_month', coalesce((
        select sum(amount) from public.payments
        where organization_id = p_organization_id and status = 'confirmed' and paid_on >= v_month_start), 0),
      'collected_prev_month', coalesce((
        select sum(amount) from public.payments
        where organization_id = p_organization_id and status = 'confirmed'
          and paid_on >= (v_month_start - interval '1 month')::date and paid_on < v_month_start), 0),
      'billed_this_month', coalesce((
        select sum(amount) from public.charges
        where organization_id = p_organization_id and status = 'active' and period = v_month_start), 0),
      'portfolio_total', coalesce((select sum(unpaid) from portfolio), 0),
      'overdue_total', coalesce((select sum(unpaid) from portfolio where due_date < v_today), 0),
      'units_overdue', (select count(distinct unit_id) from portfolio where due_date < v_today),
      'units_overdue_90', (select count(distinct unit_id) from portfolio where v_today - due_date > 90),
      'payments_pending_review', (
        select count(*) from public.payments where organization_id = p_organization_id and status = 'pending_review')
    ) into v_finance;
  end if;

  return jsonb_build_object(
    'as_of', now(),
    'finance', v_finance,
    'units_total', (select count(*) from public.units where organization_id = p_organization_id and is_active),
    'pqrs', jsonb_build_object(
      'open', (select count(*) from public.pqrs_tickets
               where organization_id = p_organization_id and status not in ('answered', 'closed')),
      'overdue', (select count(*) from public.pqrs_tickets
                  where organization_id = p_organization_id and status not in ('answered', 'closed') and due_at < now()),
      'due_soon', (select count(*) from public.pqrs_tickets
                   where organization_id = p_organization_id and status not in ('answered', 'closed')
                     and due_at between now() and now() + interval '24 hours'),
      'created_7d', (select count(*) from public.pqrs_tickets
                     where organization_id = p_organization_id and created_at > now() - interval '7 days')
    ),
    'reservations', jsonb_build_object(
      'today', (select count(*) from public.area_reservations
                where organization_id = p_organization_id and status = 'confirmed'
                  and (start_at at time zone v_tz)::date = v_today),
      'pending_approval', (select count(*) from public.area_reservations
                           where organization_id = p_organization_id and status = 'pending_approval')
    ),
    'conversations', jsonb_build_object(
      'handoff', (select count(*) from public.conversations
                  where organization_id = p_organization_id and status = 'handoff' and not is_preview),
      'active_7d', (select count(*) from public.conversations
                    where organization_id = p_organization_id and not is_preview
                      and last_inbound_at > now() - interval '7 days'),
      'verified_residents', (select count(distinct person_id) from public.conversations
                             where organization_id = p_organization_id and identity_status = 'verified' and not is_preview)
    ),
    'announcements_30d', (select count(*) from public.announcements
                          where organization_id = p_organization_id and status = 'sent' and sent_at > now() - interval '30 days')
  );
end;
$$;

revoke execute on function
  public.create_organization_with_owner(text, text, text, text, text), public.get_admin_dashboard(uuid)
from public, anon, authenticated;

grant execute on function
  public.create_organization_with_owner(text, text, text, text, text), public.get_admin_dashboard(uuid)
to authenticated;
