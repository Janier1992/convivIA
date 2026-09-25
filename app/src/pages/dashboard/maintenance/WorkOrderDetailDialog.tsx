import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { insforge } from "@/lib/insforgeClient";
import { errorMessage, rpc } from "@/lib/rpc";
import { formatDateTime, formatMoney } from "@/lib/format";
import { WORK_ORDER_EVENT_LABELS, WORK_ORDER_PRIORITY, WORK_ORDER_STATUS } from "@/lib/labels";
import { useOrganization, useOrgId } from "@/hooks/useOrganization";
import { useVendors } from "@/hooks/useCatalogs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { TeamMember, WorkOrder, WorkOrderEvent } from "@/types/domain";

const NO_VENDOR = "__none__";

/**
 * Recibe solo el id (no la fila): la lista de "Órdenes" y este diálogo
 * consultan por separado, así que una fila cliqueada queda "congelada" en
 * el momento del click. Cada acción del flujo cambia el estado y decide
 * qué formulario mostrar según ese estado, así que el diálogo necesita
 * leer siempre el dato fresco del servidor, no la fila con la que se abrió.
 */
export function WorkOrderDetailDialog({ workOrderId, onOpenChange }: { workOrderId: string | null; onOpenChange: (open: boolean) => void }) {
  const orgId = useOrgId();
  const { can } = useOrganization();
  const canWrite = can("maintenance.write");
  const canApprove = can("maintenance.approve");
  const queryClient = useQueryClient();
  const { data: vendors = [] } = useVendors();
  const { data: team = [] } = useQuery({
    queryKey: ["team-members", orgId],
    enabled: !!orgId,
    queryFn: () => rpc<TeamMember[]>("get_team_members", { p_organization_id: orgId })
  });

  const [note, setNote] = useState("");
  const [cost, setCost] = useState("");
  const [vendorId, setVendorId] = useState(NO_VENDOR);
  const [assignedTo, setAssignedTo] = useState(NO_VENDOR);
  const [showCancel, setShowCancel] = useState(false);
  const [busy, setBusy] = useState(false);

  const { data: workOrder } = useQuery({
    queryKey: ["work-order", workOrderId],
    enabled: !!workOrderId,
    queryFn: async () => {
      const { data, error } = await insforge.database
        .from("work_orders")
        .select("*, assets(name), vendors(name), pqrs_tickets(radicado)")
        .eq("id", workOrderId!)
        .single();
      if (error) throw error;
      return data as unknown as WorkOrder;
    }
  });

  const { data: events = [] } = useQuery({
    queryKey: ["work-order-events", workOrderId],
    enabled: !!workOrderId,
    queryFn: async () => {
      const { data, error } = await insforge.database
        .from("work_order_events")
        .select("*")
        .eq("work_order_id", workOrderId!)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as WorkOrderEvent[];
    }
  });

  if (!workOrderId || !workOrder) return null;

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["work-orders"] });
    await queryClient.invalidateQueries({ queryKey: ["work-order", workOrderId] });
    await queryClient.invalidateQueries({ queryKey: ["work-order-events", workOrderId] });
    setNote("");
    setCost("");
    setVendorId(NO_VENDOR);
    setAssignedTo(NO_VENDOR);
    setShowCancel(false);
  }

  async function run(action: () => Promise<unknown>, successMessage: string) {
    setBusy(true);
    try {
      await action();
      toast.success(successMessage);
      await refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const isOpen = workOrder.status !== "closed" && workOrder.status !== "cancelled";

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {workOrder.code}
            <Badge variant={WORK_ORDER_STATUS[workOrder.status].variant}>{WORK_ORDER_STATUS[workOrder.status].label}</Badge>
            <Badge variant={WORK_ORDER_PRIORITY[workOrder.priority].variant}>{WORK_ORDER_PRIORITY[workOrder.priority].label}</Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-md border border-border p-3 text-sm">
            <p className="font-medium">{workOrder.title}</p>
            <p className="mt-1 whitespace-pre-line text-muted-foreground">{workOrder.description}</p>
            <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {workOrder.assets?.name && <span>Activo: {workOrder.assets.name}</span>}
              {workOrder.pqrs_tickets?.radicado && <span>PQRS: {workOrder.pqrs_tickets.radicado}</span>}
              {workOrder.vendors?.name && <span>Proveedor: {workOrder.vendors.name}</span>}
              {workOrder.cost_estimate != null && <span>Estimado: {formatMoney(workOrder.cost_estimate)}</span>}
              {workOrder.cost_final != null && <span>Costo final: {formatMoney(workOrder.cost_final)}</span>}
            </p>
          </div>

          {canWrite && workOrder.status === "reported" && (
            <div className="space-y-2 border-t border-border pt-3">
              <p className="text-sm font-semibold">Diagnóstico</p>
              <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="¿Qué encontraste? ¿Qué se necesita reparar?" />
              <Input type="number" min={0} value={cost} onChange={(e) => setCost(e.target.value)} placeholder="Costo estimado (opcional)" />
              <Button
                disabled={busy}
                onClick={() =>
                  run(
                    () => rpc("diagnose_work_order", { p_work_order_id: workOrder.id, p_note: note.trim(), p_cost_estimate: cost ? Number(cost) : null }),
                    "Diagnóstico registrado."
                  )
                }
              >
                Registrar diagnóstico
              </Button>
            </div>
          )}

          {canApprove && workOrder.status === "diagnosed" && (
            <div className="space-y-2 border-t border-border pt-3">
              <p className="text-sm font-semibold">Aprobar gasto</p>
              <Input type="number" min={0} value={cost} onChange={(e) => setCost(e.target.value)} placeholder="Ajustar costo estimado (opcional)" />
              <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Motivo si se rechaza" />
              <div className="flex gap-2">
                <Button
                  disabled={busy}
                  onClick={() =>
                    run(
                      () => rpc("approve_work_order", { p_work_order_id: workOrder.id, p_approved: true, p_cost_estimate: cost ? Number(cost) : null }),
                      "Orden aprobada."
                    )
                  }
                >
                  Aprobar
                </Button>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => run(() => rpc("approve_work_order", { p_work_order_id: workOrder.id, p_approved: false, p_note: note.trim() }), "Orden rechazada.")}
                >
                  Rechazar
                </Button>
              </div>
            </div>
          )}
          {!canApprove && workOrder.status === "diagnosed" && (
            <p className="border-t border-border pt-3 text-xs text-muted-foreground">Esperando aprobación del gasto (owner, admin o consejo).</p>
          )}

          {canWrite && workOrder.status === "approved" && (
            <div className="space-y-2 border-t border-border pt-3">
              <p className="text-sm font-semibold">Asignar</p>
              <div className="grid gap-2 sm:grid-cols-2">
                <Select value={vendorId} onValueChange={setVendorId}>
                  <SelectTrigger><SelectValue placeholder="Proveedor externo" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_VENDOR}>Sin proveedor externo</SelectItem>
                    {vendors.filter((v) => v.is_active).map((v) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={assignedTo} onValueChange={setAssignedTo}>
                  <SelectTrigger><SelectValue placeholder="Responsable interno" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_VENDOR}>Sin responsable interno</SelectItem>
                    {team.map((m) => <SelectItem key={m.user_id} value={m.user_id}>{m.full_name ?? m.email}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <Button
                disabled={busy}
                onClick={() =>
                  run(
                    () =>
                      rpc("assign_work_order", {
                        p_work_order_id: workOrder.id,
                        p_vendor_id: vendorId === NO_VENDOR ? null : vendorId,
                        p_assigned_to: assignedTo === NO_VENDOR ? null : assignedTo
                      }),
                    "Orden asignada."
                  )
                }
              >
                Asignar
              </Button>
            </div>
          )}

          {canWrite && workOrder.status === "assigned" && (
            <div className="border-t border-border pt-3">
              <Button disabled={busy} onClick={() => run(() => rpc("start_work_order", { p_work_order_id: workOrder.id }), "Ejecución iniciada.")}>
                Iniciar ejecución
              </Button>
            </div>
          )}

          {canWrite && workOrder.status === "in_progress" && (
            <div className="space-y-2 border-t border-border pt-3">
              <p className="text-sm font-semibold">Evidencia de lo realizado</p>
              <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="¿Qué se hizo? Ej. se cambió el rodamiento y se probó 10 veces." />
              <Input type="number" min={0} value={cost} onChange={(e) => setCost(e.target.value)} placeholder="Costo final (opcional)" />
              <Button
                disabled={busy}
                onClick={() =>
                  run(
                    () => rpc("add_work_order_evidence", { p_work_order_id: workOrder.id, p_note: note.trim(), p_cost_final: cost ? Number(cost) : null }),
                    "Evidencia registrada."
                  )
                }
              >
                Registrar evidencia
              </Button>
            </div>
          )}

          {canApprove && workOrder.status === "pending_validation" && (
            <div className="space-y-2 border-t border-border pt-3">
              <p className="text-sm font-semibold">Validar cierre</p>
              <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Qué falta, si no se valida" />
              <div className="flex gap-2">
                <Button disabled={busy} onClick={() => run(() => rpc("close_work_order", { p_work_order_id: workOrder.id, p_validated: true }), "Orden cerrada.")}>
                  Validar y cerrar
                </Button>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => run(() => rpc("close_work_order", { p_work_order_id: workOrder.id, p_validated: false, p_note: note.trim() }), "Devuelta a ejecución.")}
                >
                  Falta algo, reabrir
                </Button>
              </div>
            </div>
          )}
          {!canApprove && workOrder.status === "pending_validation" && (
            <p className="border-t border-border pt-3 text-xs text-muted-foreground">Esperando validación final (owner, admin o consejo).</p>
          )}

          <div className="space-y-2">
            <p className="text-sm font-semibold">Historial</p>
            <div className="max-h-48 space-y-2 overflow-y-auto rounded-md border border-border p-2 text-xs">
              {events.map((e) => (
                <div key={e.id} className="border-b border-border/60 pb-1.5 last:border-0">
                  <p>
                    <span className="font-medium">{WORK_ORDER_EVENT_LABELS[e.event_type] ?? e.event_type}</span> · {formatDateTime(e.created_at)}
                    {e.cost != null && <span> · {formatMoney(e.cost)}</span>}
                  </p>
                  {e.body && <p className="text-muted-foreground">{e.body}</p>}
                </div>
              ))}
              {events.length === 0 && <p className="text-muted-foreground">Sin eventos.</p>}
            </div>
          </div>

          {canWrite && isOpen && (
            <div className="border-t border-border pt-3">
              {showCancel ? (
                <div className="space-y-2">
                  <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Motivo de la cancelación" />
                  <div className="flex gap-2">
                    <Button
                      variant="destructive"
                      disabled={busy}
                      onClick={() => run(() => rpc("cancel_work_order", { p_work_order_id: workOrder.id, p_reason: note.trim() }), "Orden cancelada.")}
                    >
                      Confirmar cancelación
                    </Button>
                    <Button variant="outline" onClick={() => setShowCancel(false)}>Volver</Button>
                  </div>
                </div>
              ) : (
                <Button variant="ghost" className="text-destructive" onClick={() => setShowCancel(true)}>
                  Cancelar orden
                </Button>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
