import { useState } from "react";
import { toast } from "sonner";
import { errorMessage, rpc } from "@/lib/rpc";
import { ROLE_LABELS } from "@/lib/labels";
import { usePendingInvitesForMe } from "@/hooks/usePendingInvites";
import { useOrganization } from "@/hooks/useOrganization";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Se muestra cuando un usuario recién registrado (o sin organizaciones)
 * tiene invitaciones pendientes: le permite aceptarlas en vez de forzarlo
 * al asistente de alta para crear una copropiedad nueva.
 */
export function AcceptInvites({ onAccepted }: { onAccepted: () => void }) {
  const { data: invites = [], refetch } = usePendingInvitesForMe();
  const { refetch: refetchOrganizations, setCurrentOrganizationId } = useOrganization();
  const [acceptingId, setAcceptingId] = useState<string | null>(null);

  async function accept(inviteId: string, organizationId: string) {
    setAcceptingId(inviteId);
    try {
      await rpc("accept_organization_invite", { p_invite_id: inviteId });
      toast.success("¡Te uniste al equipo!");
      await refetchOrganizations();
      setCurrentOrganizationId(organizationId);
      await refetch();
      onAccepted();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setAcceptingId(null);
    }
  }

  if (invites.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Invitaciones pendientes</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {invites.map((invite) => (
          <div key={invite.id} className="flex items-center justify-between rounded-md border border-border p-3">
            <div>
              <p className="text-sm font-medium">{invite.organizations?.name ?? "Copropiedad"}</p>
              <p className="text-xs text-muted-foreground">Rol: {ROLE_LABELS[invite.role] ?? invite.role}</p>
            </div>
            <Button size="sm" disabled={acceptingId === invite.id} onClick={() => accept(invite.id, invite.organization_id)}>
              {acceptingId === invite.id ? "Uniéndote..." : "Aceptar"}
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
