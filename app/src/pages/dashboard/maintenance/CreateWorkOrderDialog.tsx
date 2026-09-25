import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { errorMessage, rpc } from "@/lib/rpc";
import { WORK_ORDER_PRIORITY } from "@/lib/labels";
import { useOrgId } from "@/hooks/useOrganization";
import { useAssets } from "@/hooks/useCatalogs";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { WorkOrderPriority } from "@/types/domain";

const PRIORITIES = Object.keys(WORK_ORDER_PRIORITY) as WorkOrderPriority[];
const NO_ASSET = "__none__";

/**
 * Reporta un daño directo, o desde una PQRS ya radicada (pqrsTicketId +
 * prefill) para no duplicar la entrada — solo agrega el seguimiento
 * estructurado que la PQRS no tiene.
 */
export function CreateWorkOrderDialog({
  open,
  onOpenChange,
  pqrsTicketId = null,
  prefillTitle = "",
  prefillDescription = ""
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pqrsTicketId?: string | null;
  prefillTitle?: string;
  prefillDescription?: string;
}) {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const { data: assets = [] } = useAssets();
  const [title, setTitle] = useState(prefillTitle);
  const [description, setDescription] = useState(prefillDescription);
  const [priority, setPriority] = useState<WorkOrderPriority>("normal");
  const [assetId, setAssetId] = useState(NO_ASSET);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(prefillTitle);
    setDescription(prefillDescription);
    setPriority("normal");
    setAssetId(NO_ASSET);
  }, [open, prefillTitle, prefillDescription]);

  async function save() {
    if (title.trim().length < 3) return toast.error("Escribe un título.");
    if (description.trim().length < 3) return toast.error("Describe el problema.");
    setSaving(true);
    try {
      const wo = await rpc<{ code: string }>("create_work_order", {
        p_organization_id: orgId,
        p_title: title.trim(),
        p_description: description.trim(),
        p_priority: priority,
        p_asset_id: assetId === NO_ASSET ? null : assetId,
        p_pqrs_ticket_id: pqrsTicketId,
        p_actor_kind: "staff"
      });
      toast.success(`Orden de trabajo ${wo.code} creada.`);
      await queryClient.invalidateQueries({ queryKey: ["work-orders", orgId] });
      onOpenChange(false);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reportar mantenimiento</DialogTitle>
          {pqrsTicketId && <DialogDescription>Queda enlazada a la PQRS: no se duplica el reporte, solo se agrega el seguimiento.</DialogDescription>}
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="wo-title">Título</Label>
            <Input id="wo-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ej. Ascensor hace ruido" />
          </div>
          <div className="space-y-1.5">
            <Label>Prioridad</Label>
            <Select value={priority} onValueChange={(v) => setPriority(v as WorkOrderPriority)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{PRIORITIES.map((p) => <SelectItem key={p} value={p}>{WORK_ORDER_PRIORITY[p].label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Activo (opcional)</Label>
            <Select value={assetId} onValueChange={setAssetId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_ASSET}>Sin activo específico</SelectItem>
                {assets.filter((a) => a.status === "active").map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="wo-desc">Descripción</Label>
            <Textarea id="wo-desc" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Reportando..." : "Reportar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
