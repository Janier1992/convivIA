import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Mail, Plus, Trash2, UsersRound } from "lucide-react";
import { insforge } from "@/lib/insforgeClient";
import { assertOk, errorMessage, rpc } from "@/lib/rpc";
import { isValidEmail } from "@/lib/validation";
import { formatDateTime } from "@/lib/format";
import { INVITABLE_ROLES, ROLE_DESCRIPTIONS, ROLE_LABELS } from "@/lib/labels";
import { useOrganization, useOrgId } from "@/hooks/useOrganization";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/PageHeader";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import type { OrganizationRole, TeamMember } from "@/types/domain";

interface Invite {
  id: string;
  email: string;
  role: OrganizationRole;
  status: "pending" | "accepted" | "revoked";
  created_at: string;
}

export function TeamPage() {
  const orgId = useOrgId();
  const { can, currentRole } = useOrganization();
  const canManage = can("team.manage");
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<OrganizationRole>("assistant");
  const [inviting, setInviting] = useState(false);
  const [removing, setRemoving] = useState<TeamMember | null>(null);

  const { data: members = [], isLoading } = useQuery({
    queryKey: ["team-members", orgId],
    enabled: !!orgId,
    queryFn: () => rpc<TeamMember[]>("get_team_members", { p_organization_id: orgId })
  });

  const { data: invites = [] } = useQuery({
    queryKey: ["team-invites", orgId],
    enabled: !!orgId && canManage,
    queryFn: async () => {
      const { data, error } = await insforge.database.from("organization_invites").select("*").eq("organization_id", orgId).eq("status", "pending").order("created_at", { ascending: false });
      if (error) throw error;
      return data as Invite[];
    }
  });

  async function invite() {
    if (!isValidEmail(email)) return toast.error("Escribe un correo válido.");
    setInviting(true);
    try {
      assertOk(await insforge.database.from("organization_invites").insert([{ organization_id: orgId, email: email.trim().toLowerCase(), role, invited_by: null }]).select("id"));
      toast.success("Invitación creada. La persona la verá al iniciar sesión con ese correo.");
      setEmail("");
      await queryClient.invalidateQueries({ queryKey: ["team-invites", orgId] });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setInviting(false);
    }
  }

  async function changeRole(member: TeamMember, newRole: OrganizationRole) {
    try {
      assertOk(await insforge.database.from("organization_members").update({ role: newRole }).eq("id", member.member_id).select("id"));
      await queryClient.invalidateQueries({ queryKey: ["team-members", orgId] });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function revokeInvite(id: string) {
    await insforge.database.from("organization_invites").delete().eq("id", id);
    await queryClient.invalidateQueries({ queryKey: ["team-invites", orgId] });
  }

  async function confirmRemove() {
    if (!removing) return;
    try {
      await insforge.database.from("organization_members").delete().eq("id", removing.member_id);
      toast.success("Acceso revocado.");
      await queryClient.invalidateQueries({ queryKey: ["team-members", orgId] });
    } catch (err) {
      toast.error(errorMessage(err));
      throw err;
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Equipo" description="Quién administra esta copropiedad y con qué rol." />

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><UsersRound className="h-4 w-4" aria-hidden /> Miembros</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {isLoading ? <Skeleton className="h-32 w-full" /> : members.map((m) => (
            <div key={m.member_id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3">
              <div>
                <p className="text-sm font-medium">{m.full_name ?? m.email}</p>
                <p className="text-xs text-muted-foreground">{m.email}</p>
              </div>
              <div className="flex items-center gap-2">
                {canManage && m.role !== "owner" ? (
                  <Select value={m.role} onValueChange={(v) => changeRole(m, v as OrganizationRole)}>
                    <SelectTrigger className="h-8 w-48"><SelectValue /></SelectTrigger>
                    <SelectContent>{INVITABLE_ROLES.map((r) => <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>)}</SelectContent>
                  </Select>
                ) : (
                  <Badge>{ROLE_LABELS[m.role]}</Badge>
                )}
                {canManage && m.role !== "owner" && (
                  <Button variant="ghost" size="icon" onClick={() => setRemoving(m)} aria-label={`Quitar a ${m.full_name ?? m.email}`}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {canManage && (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Mail className="h-4 w-4" aria-hidden /> Invitar</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="correo@ejemplo.com" className="flex-1" />
              <Select value={role} onValueChange={(v) => setRole(v as OrganizationRole)}>
                <SelectTrigger className="sm:w-56"><SelectValue /></SelectTrigger>
                <SelectContent>{INVITABLE_ROLES.map((r) => <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>)}</SelectContent>
              </Select>
              <Button onClick={invite} disabled={inviting}><Plus className="h-4 w-4" aria-hidden /> Invitar</Button>
            </div>
            <p className="text-xs text-muted-foreground">{ROLE_DESCRIPTIONS[role]}</p>
            {invites.length > 0 && (
              <div className="space-y-1.5 border-t border-border pt-3">
                <p className="text-sm font-medium">Invitaciones pendientes</p>
                {invites.map((inv) => (
                  <div key={inv.id} className="flex items-center justify-between text-sm">
                    <span>{inv.email} · {ROLE_LABELS[inv.role]} · {formatDateTime(inv.created_at)}</span>
                    <Button variant="ghost" size="sm" onClick={() => revokeInvite(inv.id)}>Revocar</Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {currentRole && (
        <p className="text-xs text-muted-foreground">Tu rol: {ROLE_LABELS[currentRole]} — {ROLE_DESCRIPTIONS[currentRole]}</p>
      )}

      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title="Quitar del equipo"
        description={removing ? `${removing.full_name ?? removing.email} perderá acceso a esta copropiedad.` : undefined}
        confirmLabel="Quitar"
        destructive
        onConfirm={confirmRemove}
      />
    </div>
  );
}
