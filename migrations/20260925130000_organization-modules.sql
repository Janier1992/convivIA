-- ============================================================
-- Módulos habilitados por copropiedad: control comercial, no de rol. Un
-- rol (owner/admin/...) decide QUÉ PUEDE HACER alguien dentro de los
-- módulos que su copropiedad SÍ tiene contratados; esto decide cuáles
-- módulos existen para esa copropiedad en absoluto (ej. vendieron el
-- servicio solo con Inicio + Portafolio + Conversaciones). Solo soporte
-- lo cambia, nunca la propia copropiedad — mismo mecanismo que ya usa
-- `status` (columna en organizations, trigger guard_organization_update
-- redefinido acá para agregar esta columna a su lista protegida).
-- ============================================================

alter table public.organizations
  add column if not exists enabled_modules text[] not null default array[
    'portfolio', 'inbox', 'pqrs', 'reservations', 'porteria', 'maintenance', 'communications',
    'finance', 'units', 'residents', 'assembly', 'documents', 'agent', 'integrations', 'team', 'audit', 'settings'
  ]::text[];

alter table public.organizations
  add constraint organizations_enabled_modules_check check (
    enabled_modules <@ array[
      'portfolio', 'inbox', 'pqrs', 'reservations', 'porteria', 'maintenance', 'communications',
      'finance', 'units', 'residents', 'assembly', 'documents', 'agent', 'integrations', 'team', 'audit', 'settings'
    ]::text[]
  );

-- Redefine el guard existente (mismo trigger, mismo nombre de función:
-- CREATE OR REPLACE conserva el OID, el trigger ya creado en
-- 20260924121200_platform.sql sigue apuntando a esta definición nueva)
-- agregando enabled_modules a la lista de columnas exclusivas de soporte.
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
  if (new.status is distinct from old.status or new.subscription_expires_at is distinct from old.subscription_expires_at
      or new.enabled_modules is distinct from old.enabled_modules)
     and not public.is_support_staff() then
    raise exception 'Solo soporte puede cambiar el estado de la suscripción o los módulos habilitados' using errcode = '42501';
  end if;
  if (new.name is distinct from old.name or new.slug is distinct from old.slug
      or new.property_type is distinct from old.property_type or new.timezone is distinct from old.timezone)
     and not public.has_org_permission(new.id, 'settings.manage') then
    raise exception 'Soporte solo puede cambiar el estado de la copropiedad' using errcode = '42501';
  end if;
  return new;
end;
$$;

grant update (enabled_modules) on public.organizations to authenticated;
