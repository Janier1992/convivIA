import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { insforge } from "@/lib/insforgeClient";
import { errorMessage, rpc } from "@/lib/rpc";
import { formatDateTime, formatNumber } from "@/lib/format";
import { PROPERTY_TYPE_LABELS } from "@/lib/labels";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/PageHeader";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import type { Organization } from "@/types/domain";

interface SupportOverview {
  units: number;
  persons: number;
  team_members: number;
  verified_residents: number;
  conversations_30d: number;
  pqrs_open: number;
  outbound_failed_7d: number;
  last_activity_at: string | null;
}

interface SupportNote {
  id: string;
  note: string;
  created_at: string;
}

export function SupportOrganizationDetailPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const queryClient = useQueryClient();
  const [note, setNote] = useState("");
  const [confirmSuspend, setConfirmSuspend] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { data: org } = useQuery({
    queryKey: ["support-org", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await insforge.database.from("organizations").select("*").eq("id", orgId).single();
      if (error) throw error;
      return data as Organization;
    }
  });

  const { data: overview } = useQuery({
    queryKey: ["support-overview", orgId],
    enabled: !!orgId,
    queryFn: () => rpc<SupportOverview>("get_support_overview", { p_organization_id: orgId })
  });

  const { data: agent } = useQuery({
    queryKey: ["support-agent", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await insforge.database.from("agents").select("id, enabled, name").eq("organization_id", orgId).single();
      if (error) throw error;
      return data as { id: string; enabled: boolean; name: string };
    }
  });

  const { data: notes = [] } = useQuery({
    queryKey: ["support-notes", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await insforge.database.from("support_notes").select("id, note, created_at").eq("organization_id", orgId).order("created_at", { ascending: false });
      if (error) throw error;
      return data as SupportNote[];
    }
  });

  async function toggleAgent() {
    if (!agent) return;
    try {
      await insforge.database.from("agents").update({ enabled: !agent.enabled }).eq("id", agent.id);
      await queryClient.invalidateQueries({ queryKey: ["support-agent", orgId] });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function addNote() {
    if (note.trim().length < 2) return;
    try {
      await insforge.database.from("support_notes").insert([{ organization_id: orgId, note: note.trim(), author_user_id: null }]);
      setNote("");
      await queryClient.invalidateQueries({ queryKey: ["support-notes", orgId] });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function toggleSuspend() {
    if (!org) return;
    await insforge.database.from("organizations").update({ status: org.status === "suspended" ? "active" : "suspended" }).eq("id", org.id);
    toast.success(org.status === "suspended" ? "Copropiedad reactivada." : "Copropiedad suspendida.");
    await queryClient.invalidateQueries({ queryKey: ["support-org", orgId] });
  }

  async function deleteOrganization() {
    await insforge.database.from("organizations").delete().eq("id", orgId);
    toast.success("Copropiedad eliminada.");
    window.location.href = "/soporte";
  }

  if (!org) return null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={org.name}
        description={`${PROPERTY_TYPE_LABELS[org.property_type] ?? org.property_type} · creada ${formatDateTime(org.created_at)}`}
        actions={
          <>
            <Button variant="outline" onClick={() => setConfirmSuspend(true)}>{org.status === "suspended" ? "Reactivar" : "Suspender"}</Button>
            <Button variant="destructive" onClick={() => setConfirmDelete(true)}>Eliminar</Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card className="p-4"><p className="text-xs text-muted-foreground">Unidades</p><p className="text-xl font-bold">{formatNumber(overview?.units)}</p></Card>
        <Card className="p-4"><p className="text-xs text-muted-foreground">Personas</p><p className="text-xl font-bold">{formatNumber(overview?.persons)}</p></Card>
        <Card className="p-4"><p className="text-xs text-muted-foreground">Residentes verificados</p><p className="text-xl font-bold">{formatNumber(overview?.verified_residents)}</p></Card>
        <Card className="p-4"><p className="text-xs text-muted-foreground">PQRS abiertas</p><p className="text-xl font-bold">{formatNumber(overview?.pqrs_open)}</p></Card>
        <Card className="p-4"><p className="text-xs text-muted-foreground">Miembros del equipo</p><p className="text-xl font-bold">{formatNumber(overview?.team_members)}</p></Card>
        <Card className="p-4"><p className="text-xs text-muted-foreground">Conversaciones (30d)</p><p className="text-xl font-bold">{formatNumber(overview?.conversations_30d)}</p></Card>
        <Card className="p-4"><p className="text-xs text-muted-foreground">Envíos fallidos (7d)</p><p className="text-xl font-bold">{formatNumber(overview?.outbound_failed_7d)}</p></Card>
        <Card className="p-4"><p className="text-xs text-muted-foreground">Última actividad</p><p className="text-sm font-medium">{overview?.last_activity_at ? formatDateTime(overview.last_activity_at) : "—"}</p></Card>
      </div>

      {agent && (
        <Card>
          <CardHeader><CardTitle>Asistente IA</CardTitle></CardHeader>
          <CardContent className="flex items-center justify-between">
            <p className="text-sm">{agent.name}</p>
            <div className="flex items-center gap-2">
              <span className="text-sm">{agent.enabled ? "Activo" : "Pausado"}</span>
              <Switch checked={agent.enabled} onCheckedChange={toggleAgent} />
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>Notas internas de soporte</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {notes.map((n) => (
            <div key={n.id} className="rounded-md border border-border p-2.5 text-sm">
              <p>{n.note}</p>
              <p className="mt-1 text-xs text-muted-foreground">{formatDateTime(n.created_at)}</p>
            </div>
          ))}
          <div className="flex gap-2">
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Nota interna (no la ve la copropiedad)" />
            <Button onClick={addNote}>Agregar</Button>
          </div>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmSuspend}
        onOpenChange={setConfirmSuspend}
        title={org.status === "suspended" ? "Reactivar copropiedad" : "Suspender copropiedad"}
        confirmLabel={org.status === "suspended" ? "Reactivar" : "Suspender"}
        destructive={org.status !== "suspended"}
        onConfirm={toggleSuspend}
      />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Eliminar copropiedad"
        description="Se elimina toda la información de la copropiedad de forma permanente. Esta acción no se puede deshacer."
        confirmLabel="Eliminar definitivamente"
        destructive
        reasonLabel="Motivo (para el registro)"
        onConfirm={deleteOrganization}
      />
    </div>
  );
}
