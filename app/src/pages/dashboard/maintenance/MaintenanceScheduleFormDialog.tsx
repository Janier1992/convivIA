import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { errorMessage, rpc } from "@/lib/rpc";
import { todayIn } from "@/lib/format";
import { useOrgId } from "@/hooks/useOrganization";
import { useAssets } from "@/hooks/useCatalogs";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const NO_ASSET = "__none__";

export function MaintenanceScheduleFormDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const { data: assets = [] } = useAssets();
  const [title, setTitle] = useState("");
  const [assetId, setAssetId] = useState(NO_ASSET);
  const [frequencyMonths, setFrequencyMonths] = useState("1");
  const [nextDueOn, setNextDueOn] = useState(todayIn());
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (title.trim().length < 3) return toast.error("Escribe un título.");
    const months = Number(frequencyMonths);
    if (!Number.isInteger(months) || months < 1 || months > 60) return toast.error("La frecuencia debe ser entre 1 y 60 meses.");
    setSaving(true);
    try {
      await rpc("create_maintenance_schedule", {
        p_organization_id: orgId,
        p_title: title.trim(),
        p_frequency_months: months,
        p_next_due_on: nextDueOn,
        p_asset_id: assetId === NO_ASSET ? null : assetId,
        p_notes: notes.trim() || null
      });
      toast.success("Cronograma creado.");
      await queryClient.invalidateQueries({ queryKey: ["maintenance-schedules", orgId] });
      onOpenChange(false);
      setTitle(""); setAssetId(NO_ASSET); setFrequencyMonths("1"); setNotes("");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Nuevo mantenimiento preventivo</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="sched-title">Título</Label>
            <Input id="sched-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ej. Revisión mensual del ascensor" />
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
          <div className="space-y-1.5">
            <Label htmlFor="sched-freq">Frecuencia (meses)</Label>
            <Input id="sched-freq" type="number" min={1} max={60} value={frequencyMonths} onChange={(e) => setFrequencyMonths(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sched-due">Próxima fecha</Label>
            <Input id="sched-due" type="date" value={nextDueOn} onChange={(e) => setNextDueOn(e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="sched-notes">Notas</Label>
            <Textarea id="sched-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Guardando..." : "Crear cronograma"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
