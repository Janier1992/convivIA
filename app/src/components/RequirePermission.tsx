import { Outlet } from "react-router-dom";
import { PackageX, ShieldAlert } from "lucide-react";
import { useOrganization } from "@/hooks/useOrganization";
import { EmptyState } from "@/components/EmptyState";
import { FullscreenLoader } from "@/components/RequireAuth";
import type { ModuleKey, Permission } from "@/types/domain";

/**
 * Guarda de ruta. Dos chequeos independientes, cualquiera de los dos
 * puede bloquear:
 * - `permission`: lo decide el ROL dentro de la copropiedad (RBAC). La
 *   seguridad real la aplica RLS en la base de datos, esto solo evita
 *   mostrar un botón que fallaría.
 * - `module`: lo decide SOPORTE para toda la copropiedad (qué contrató),
 *   sin importar el rol — un owner tampoco ve un módulo no contratado.
 */
export function RequirePermission({ permission, module }: { permission?: Permission; module?: ModuleKey }) {
  const { can, hasModule, isLoading } = useOrganization();
  if (isLoading) return <FullscreenLoader />;
  if (module && !hasModule(module)) {
    return (
      <EmptyState
        icon={PackageX}
        title="Este módulo no está disponible"
        description="Tu copropiedad no tiene contratado este módulo. Si lo necesitas, escríbele a soporte."
      />
    );
  }
  if (permission && !can(permission)) {
    return (
      <EmptyState
        icon={ShieldAlert}
        title="No tienes acceso a esta sección"
        description="Tu rol en esta copropiedad no incluye este permiso. Si lo necesitas, pídelo a quien administra el equipo."
      />
    );
  }
  return <Outlet />;
}
