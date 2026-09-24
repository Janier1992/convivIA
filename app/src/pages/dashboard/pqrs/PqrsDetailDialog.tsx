import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { insforge } from "@/lib/insforgeClient";
import { errorMessage, rpc } from "@/lib/rpc";
import { formatDateTime } from "@/lib/format";
import { CHANNEL_LABELS, PQRS_PRIORITY, PQRS_STATUS, PQRS_TYPE_LABELS } from "@/lib/labels";
import { useOrganization } from "@/hooks/useOrganization";
import { usePqrsCategories } from "@/hooks/useCatalogs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { PqrsEvent, PqrsTicket } from "@/types/domain";

const EVENT_LABELS: Record<string, string> = {
  created: "Radicada", status_changed: "Cambio de estado", assigned: "Asignación", priority_changed: "Cambio de prioridad",
  category_changed: "Cambio de categoría", internal_note: "Nota interna", public_response: "Respuesta al residente"
};

export function PqrsDetailDialog({ ticket, onOpenChange }: { ticket: PqrsTicket | null; onOpenChange: (open: boolean) => void }) {
  const { can } = useOrganization();
  const canWrite = can("pqrs.write");
  const queryClient = useQueryClient();
  const { data: categories = [] } = usePqrsCategories();
  const [response, setResponse] = useState("");
  const [closeAfter, setCloseAfter] = useState(true);
  const [busy, setBusy] = useState(false);

  const { data: events = [] } = useQuery({
    queryKey: ["pqrs-events", ticket?.id],
    enabled: !!ticket,
    queryFn: async () => {
      const { data, error } = await insforge.database
        .from("pqrs_events")
        .select("*")
        .eq("ticket_id", ticket!.id)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as PqrsEvent[];
    }
  });

  if (!ticket) return null;

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["pqrs"] });
    await queryClient.invalidateQueries({ queryKey: ["pqrs-events", ticket!.id] });
  }

  async function updateField(patch: { p_status?: string; p_priority?: string; p_category_id?: string }) {
    setBusy(true);
    try {
      await rpc("update_pqrs_ticket", {
        p_ticket_id: ticket!.id,
        p_status: patch.p_status ?? null,
        p_priority: patch.p_priority ?? null,
        p_assigned_to: null,
        p_category_id: patch.p_category_id ?? null,
        p_note: null
      });
      await refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function respond() {
    if (response.trim().length < 5) return toast.error("Escribe una respuesta más completa.");
    setBusy(true);
    try {
      const result = await rpc<{ notified: boolean }>("respond_pqrs_ticket", { p_ticket_id: ticket!.id, p_response: response.trim(), p_close: closeAfter });
      toast.success(result.notified ? "Respuesta enviada al residente por su chat." : "Respuesta guardada (el residente no tiene canal vinculado).");
      setResponse("");
      await refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const isFinal = ticket.status === "answered" || ticket.status === "closed";

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {ticket.radicado}
            <Badge variant={PQRS_STATUS[ticket.status].variant}>{PQRS_STATUS[ticket.status].label}</Badge>
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-md border border-border p-3 text-sm">
            <p className="font-medium">{ticket.subject}</p>
            <p className="mt-1 whitespace-pre-line text-muted-foreground">{ticket.description}</p>
            <p className="mt-2 text-xs text-muted-foreground">
              {PQRS_TYPE_LABELS[ticket.ticket_type]} · {ticket.requester_name ?? "Anónimo"}{ticket.units?.code ? ` · ${ticket.units.code}` : ""} · vía {CHANNEL_LABELS[ticket.channel] ?? ticket.channel} · {formatDateTime(ticket.created_at)}
            </p>
          </div>

          {canWrite && !isFinal && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Estado</label>
                <Select value={ticket.status} onValueChange={(v) => updateField({ p_status: v })} disabled={busy}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["classified", "assigned", "in_progress", "waiting_info"].map((s) => (
                      <SelectItem key={s} value={s}>{PQRS_STATUS[s as keyof typeof PQRS_STATUS].label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Prioridad</label>
                <Select value={ticket.priority} onValueChange={(v) => updateField({ p_priority: v })} disabled={busy}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(["low", "normal", "high", "urgent"] as const).map((p) => <SelectItem key={p} value={p}>{PQRS_PRIORITY[p].label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Categoría</label>
                <Select value={ticket.category_id ?? ""} onValueChange={(v) => updateField({ p_category_id: v })} disabled={busy}>
                  <SelectTrigger><SelectValue placeholder="Sin categoría" /></SelectTrigger>
                  <SelectContent>{categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <p className="text-sm font-semibold">Historial</p>
            <div className="max-h-48 space-y-2 overflow-y-auto rounded-md border border-border p-2 text-xs">
              {events.map((e) => (
                <div key={e.id} className="border-b border-border/60 pb-1.5 last:border-0">
                  <p><span className="font-medium">{EVENT_LABELS[e.event_type] ?? e.event_type}</span> · {e.actor_kind} · {formatDateTime(e.created_at)}</p>
                  {e.body && <p className="text-muted-foreground">{e.body}</p>}
                </div>
              ))}
              {events.length === 0 && <p className="text-muted-foreground">Sin eventos.</p>}
            </div>
          </div>

          {ticket.response && (
            <div className="rounded-md border border-success/30 bg-success/5 p-3 text-sm">
              <p className="font-medium text-success">Respuesta enviada</p>
              <p className="mt-1 whitespace-pre-line">{ticket.response}</p>
            </div>
          )}

          {canWrite && !isFinal && (
            <div className="space-y-2 border-t border-border pt-3">
              <label htmlFor="pqrs-response" className="text-sm font-semibold">Responder al residente</label>
              <Textarea id="pqrs-response" rows={3} value={response} onChange={(e) => setResponse(e.target.value)} placeholder="Se entrega por el mismo chat del residente (Telegram/WhatsApp)." />
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={closeAfter} onChange={(e) => setCloseAfter(e.target.checked)} /> Cerrar al responder
                </label>
                <Button onClick={respond} disabled={busy}>{busy ? "Enviando..." : "Enviar respuesta"}</Button>
              </div>
            </div>
          )}

          {canWrite && ticket.status === "closed" && (
            <Button variant="outline" onClick={() => updateField({ p_status: "in_progress" })} disabled={busy}>Reabrir</Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
