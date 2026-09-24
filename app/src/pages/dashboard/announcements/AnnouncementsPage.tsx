import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Megaphone, Plus, Send, Trash2 } from "lucide-react";
import { insforge } from "@/lib/insforgeClient";
import { errorMessage, rpc } from "@/lib/rpc";
import { formatDateTime } from "@/lib/format";
import { AUDIENCE_LABELS } from "@/lib/labels";
import { useOrganization, useOrgId } from "@/hooks/useOrganization";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { QueryErrorState } from "@/components/QueryErrorState";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import type { Announcement } from "@/types/domain";
import { ComposeAnnouncementDialog } from "./ComposeAnnouncementDialog";

export function AnnouncementsPage() {
  const orgId = useOrgId();
  const { can } = useOrganization();
  const canSend = can("communications.send");
  const queryClient = useQueryClient();
  const [composing, setComposing] = useState(false);
  const [sending, setSending] = useState<Announcement | null>(null);
  const [deleting, setDeleting] = useState<Announcement | null>(null);

  const { data: announcements = [], isLoading, isError, refetch } = useQuery({
    queryKey: ["announcements", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await insforge.database
        .from("announcements")
        .select("*")
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data as Announcement[];
    }
  });

  async function confirmSend() {
    if (!sending) return;
    try {
      const result = await rpc<{ queued: number; without_channel: number }>("send_announcement", { p_announcement_id: sending.id });
      toast.success(`Enviado a ${result.queued} personas${result.without_channel > 0 ? ` (${result.without_channel} sin canal vinculado)` : ""}.`);
      await queryClient.invalidateQueries({ queryKey: ["announcements", orgId] });
    } catch (err) {
      toast.error(errorMessage(err));
      throw err;
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    try {
      await insforge.database.from("announcements").delete().eq("id", deleting.id);
      toast.success("Borrador eliminado.");
      await queryClient.invalidateQueries({ queryKey: ["announcements", orgId] });
    } catch (err) {
      toast.error(errorMessage(err));
      throw err;
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Comunicados"
        description="Se entregan como mensaje privado por el chat de cada persona: nunca como lista pública."
        actions={canSend && <Button onClick={() => setComposing(true)}><Plus className="h-4 w-4" aria-hidden /> Nuevo comunicado</Button>}
      />

      {isError ? (
        <QueryErrorState onRetry={() => refetch()} message="No se pudieron cargar los comunicados." />
      ) : isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : announcements.length === 0 ? (
        <EmptyState icon={Megaphone} title="Aún no hay comunicados" description="Redacta el primero, con ayuda de la IA si quieres." />
      ) : (
        <div className="space-y-3">
          {announcements.map((a) => (
            <Card key={a.id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold">{a.title}</p>
                  <p className="mt-1 whitespace-pre-line text-sm text-muted-foreground line-clamp-3">{a.body}</p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {AUDIENCE_LABELS[a.audience_type]}
                    {a.status === "sent" && ` · Enviado el ${formatDateTime(a.sent_at)} a ${a.recipients_count} personas${a.without_channel_count > 0 ? ` (${a.without_channel_count} sin canal)` : ""}`}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {a.status === "draft" ? <Badge variant="muted">Borrador</Badge> : <Badge variant="success">Enviado</Badge>}
                  {canSend && a.status === "draft" && (
                    <>
                      <Button size="sm" onClick={() => setSending(a)}><Send className="h-4 w-4" aria-hidden /> Enviar</Button>
                      <Button size="sm" variant="ghost" onClick={() => setDeleting(a)}><Trash2 className="h-4 w-4 text-destructive" aria-hidden /></Button>
                    </>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <ComposeAnnouncementDialog open={composing} onOpenChange={setComposing} />
      <ConfirmDialog
        open={!!sending}
        onOpenChange={(o) => !o && setSending(null)}
        title="Enviar comunicado"
        description={sending ? `Se enviará "${sending.title}" a: ${AUDIENCE_LABELS[sending.audience_type]}. Esta acción no se puede deshacer.` : undefined}
        confirmLabel="Enviar"
        onConfirm={confirmSend}
      />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Eliminar borrador"
        confirmLabel="Eliminar"
        destructive
        onConfirm={confirmDelete}
      />
    </div>
  );
}
