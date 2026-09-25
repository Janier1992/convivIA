import { useEffect, useState } from "react";
import { toast } from "sonner";
import { errorMessage, rpc } from "@/lib/rpc";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

export function AddAgendaItemDialog({
  open,
  onOpenChange,
  assemblyId,
  onSaved
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assemblyId: string;
  onSaved: () => Promise<void> | void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [requiresVote, setRequiresVote] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle("");
    setDescription("");
    setRequiresVote(true);
  }, [open]);

  async function save() {
    if (title.trim().length < 2) return toast.error("Escribe el título del punto.");
    setSaving(true);
    try {
      await rpc("add_agenda_item", {
        p_assembly_id: assemblyId,
        p_title: title.trim(),
        p_description: description.trim() || null,
        p_requires_vote: requiresVote
      });
      toast.success("Punto agregado al orden del día.");
      onOpenChange(false);
      await onSaved();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Agregar punto al orden del día</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="agenda-title">Título</Label>
            <Input id="agenda-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Aprobar presupuesto 2027" autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="agenda-description">Descripción (opcional)</Label>
            <Textarea id="agenda-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div>
              <p className="text-sm font-medium">Requiere votación</p>
              <p className="text-xs text-muted-foreground">Si no, es solo un punto informativo (ej. informe de gestión).</p>
            </div>
            <Switch checked={requiresVote} onCheckedChange={setRequiresVote} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Guardando..." : "Agregar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
