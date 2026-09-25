import { useEffect, useState } from "react";
import { toast } from "sonner";
import { errorMessage, rpc } from "@/lib/rpc";
import { useOrgId } from "@/hooks/useOrganization";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Assembly, AssemblyType } from "@/types/domain";

export function CreateAssemblyDialog({
  open,
  onOpenChange,
  onCreated
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (id: string) => void;
}) {
  const orgId = useOrgId();
  const [title, setTitle] = useState("");
  const [type, setType] = useState<AssemblyType>("ordinaria");
  const [scheduledAt, setScheduledAt] = useState("");
  const [location, setLocation] = useState("");
  const [firstCallQuorum, setFirstCallQuorum] = useState("51");
  const [secondCallQuorum, setSecondCallQuorum] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle("");
    setType("ordinaria");
    setScheduledAt("");
    setLocation("");
    setFirstCallQuorum("51");
    setSecondCallQuorum("");
  }, [open]);

  async function save() {
    if (title.trim().length < 2) return toast.error("Escribe el título de la asamblea.");
    if (!scheduledAt) return toast.error("Elige la fecha y hora de la convocatoria.");
    setSaving(true);
    try {
      const created = await rpc<Assembly>("create_assembly", {
        p_organization_id: orgId,
        p_title: title.trim(),
        p_scheduled_at: new Date(scheduledAt).toISOString(),
        p_assembly_type: type,
        p_location: location.trim() || null,
        p_first_call_quorum_pct: Number(firstCallQuorum) || 51,
        p_second_call_quorum_pct: secondCallQuorum ? Number(secondCallQuorum) : null
      });
      toast.success("Asamblea convocada.");
      onOpenChange(false);
      onCreated(created.id);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader><DialogTitle>Convocar asamblea</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="assembly-title">Título</Label>
            <Input id="assembly-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Asamblea ordinaria 2027" autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label>Tipo</Label>
            <Select value={type} onValueChange={(v) => setType(v as AssemblyType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ordinaria">Ordinaria</SelectItem>
                <SelectItem value="extraordinaria">Extraordinaria</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="assembly-date">Fecha y hora</Label>
            <Input id="assembly-date" type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="assembly-location">Lugar (opcional)</Label>
            <Input id="assembly-location" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Salón comunal, o enlace de videollamada" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="assembly-first-quorum">Quórum primera convocatoria (%)</Label>
            <Input id="assembly-first-quorum" type="number" min="1" max="100" value={firstCallQuorum} onChange={(e) => setFirstCallQuorum(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="assembly-second-quorum">Quórum segunda convocatoria (opcional)</Label>
            <Input
              id="assembly-second-quorum"
              type="number"
              min="1"
              max="100"
              value={secondCallQuorum}
              onChange={(e) => setSecondCallQuorum(e.target.value)}
              placeholder="Según el reglamento"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Convocando..." : "Convocar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
