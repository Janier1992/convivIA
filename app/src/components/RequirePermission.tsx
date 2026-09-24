import { Outlet } from "react-router-dom";
import { ShieldAlert } from "lucide-react";
import { useOrganization } from "@/hooks/useOrganization";
import { EmptyState } from "@/components/EmptyState";
import { FullscreenLoader } from "@/components/RequireAuth";
import type { Permission } from "@/types/domain";

/** Guarda de ruta por permiso. La seguridad real la aplica RLS en la base de datos. */
export function RequirePermission({ permission }: { permission: Permission }) {
  const { can, isLoading } = useOrganization();
  if (isLoading) return <FullscreenLoader />;
  if (!can(permission)) {
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
