import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { errorMessage, rpc } from "@/lib/rpc";
import { GATE_NOTE_CATEGORY_LABELS } from "@/lib/labels";
import { useOrgId } from "@/hooks/useOrganization";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { GateNoteCategory } from "@/types/domain";

const CATEGORIES: GateNoteCategory[] = ["general", "security", "maintenance", "incident"];

/** Novedad de portería sin ligar a una unidad: rondas, fallas de equipos, incidentes, cambios de turno. */
export function AddGateNoteDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const [category, setCategory] = useState<GateNoteCategory>("general");
  const [note, setNote] = useState("");
  const [shift, setShift] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCategory("general");
    setNote("");
    setShift("");
  }, [open]);

  async function save() {
    if (note.trim().length < 3) return toast.error("Escribe la novedad.");
    setSaving(true);
    try {
      await rpc("add_gate_note", { p_organization_id: orgId, p_note: note.trim(), p_category: category, p_shift: shift.trim() || null });
      toast.success("Novedad registrada.");
      await queryClient.invalidateQueries({ queryKey: ["gate-notes", orgId] });
      onOpenChange(false);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Agregar novedad</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div className="space-y-1.5">
            <Label>Categoría</Label>
            <Select value={category} onValueChange={(v) => setCategory(v as GateNoteCategory)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{GATE_NOTE_CATEGORY_LABELS[c]}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="gate-note-shift">Turno (opcional)</Label>
            <Input id="gate-note-shift" value={shift} onChange={(e) => setShift(e.target.value)} placeholder="Diurno, nocturno..." />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="gate-note-text">Novedad</Label>
            <Textarea id="gate-note-text" value={note} onChange={(e) => setNote(e.target.value)} rows={4} autoFocus />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Guardando..." : "Guardar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
