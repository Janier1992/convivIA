import { Navigate, Outlet } from "react-router-dom";
import { useOrganization } from "@/hooks/useOrganization";
import { usePendingInvitesForMe } from "@/hooks/usePendingInvites";
import { useSupportStaff } from "@/hooks/useSupportStaff";
import { useDeletedAccount } from "@/hooks/useDeletedAccount";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { AcceptInvites } from "./AcceptInvites";
import { FullscreenLoader } from "./RequireAuth";

const SUSPENDED_MESSAGE = "Te informamos que la cuenta de tu copropiedad ha sido bloqueada por falta de pago. Si deseas usar el servicio, realiza el pago.";
const CANCELLED_MESSAGE = "Esta cuenta fue cancelada. Contacta a la administración de tu copropiedad si crees que es un error.";
const DELETED_ACCOUNT_MESSAGE =
  "La copropiedad fue eliminada. Para más información, debes contactar a Soporte: synflow.ia@gmail.com";

function BlockedOrganizationScreen({ message }: { message: string }) {
  const { signOut } = useAuth();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md space-y-4 rounded-lg border border-destructive/30 bg-card p-6 text-center">
        <h1 className="text-xl font-semibold text-destructive">Cuenta bloqueada</h1>
        <p className="text-sm text-muted-foreground">{message}</p>
        <Button variant="outline" onClick={() => signOut()}>
          Cerrar sesión
        </Button>
      </div>
    </div>
  );
}

/**
 * Si el usuario todavía no tiene ninguna organización, revisa primero si
 * tiene invitaciones pendientes (de un owner/admin que lo invitó), después
 * si es parte del equipo de soporte (una cuenta de soporte pura no tiene
 * por qué tener una copropiedad propia) antes de mandarlo al asistente de
 * alta para crear una copropiedad nueva.
 */
export function RequireOrganization() {
  const { memberships, isLoading, currentOrganizationId } = useOrganization();
  const { data: pendingInvites = [], isLoading: invitesLoading, refetch: refetchInvites } = usePendingInvitesForMe();
  const { isSupportStaff, isLoading: supportLoading } = useSupportStaff();
  const { isDeletedAccount, isLoading: deletedLoading } = useDeletedAccount();

  if (isLoading || invitesLoading || supportLoading || deletedLoading) return <FullscreenLoader />;

  if (memberships.length === 0) {
    if (pendingInvites.length > 0) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-background px-4">
          <div className="w-full max-w-md space-y-4">
            <div className="text-center">
              <h1 className="text-xl font-semibold">Te invitaron a un equipo</h1>
              <p className="text-sm text-muted-foreground">Aceptá para empezar a colaborar.</p>
            </div>
            <AcceptInvites onAccepted={() => refetchInvites()} />
          </div>
        </div>
      );
    }
    if (isSupportStaff) return <Navigate to="/soporte" replace />;
    // La copropiedad de esta cuenta fue eliminada por soporte: nunca dejar
    // que se cree una nueva silenciosamente con la misma cuenta, como si
    // nada hubiera pasado (punto reportado explícitamente por el usuario).
    if (isDeletedAccount) return <BlockedOrganizationScreen message={DELETED_ACCOUNT_MESSAGE} />;
    return <Navigate to="/onboarding" replace />;
  }

  // El usuario SÍ tiene organizaciones: si currentOrganizationId todavía no se
  // sincronizó (por ejemplo, primera carga en un navegador/sesión nuevos,
  // donde localStorage arranca vacío hasta que el efecto de
  // OrganizationProvider elige la primera membership), es un instante de
  // carga, no una señal de "hay que crear una copropiedad" — nunca hay que
  // mandar a un usuario con copropiedad ya creada de vuelta al onboarding.
  if (!currentOrganizationId) return <FullscreenLoader />;

  const currentOrgStatus = memberships.find((m) => m.organization_id === currentOrganizationId)?.organizations.status;
  if (currentOrgStatus === "suspended") return <BlockedOrganizationScreen message={SUSPENDED_MESSAGE} />;
  if (currentOrgStatus === "cancelled") return <BlockedOrganizationScreen message={CANCELLED_MESSAGE} />;

  return <Outlet />;
}
