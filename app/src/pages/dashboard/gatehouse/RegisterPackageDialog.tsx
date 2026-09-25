import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { errorMessage, rpc } from "@/lib/rpc";
import { useOrgId } from "@/hooks/useOrganization";
import { useUnits } from "@/hooks/useCatalogs";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

/** Registro de un paquete o domicilio recibido en portería. Avisa por chat al contacto principal de la unidad si tiene canal conectado. */
export function RegisterPackageDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const { data: units = [] } = useUnits();

  const [unitId, setUnitId] = useState("");
  const [courier, setCourier] = useState("");
  const [description, setDescription] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setUnitId("");
    setCourier("");
    setDescription("");
    setNotes("");
  }, [open]);

  async function save() {
    if (!unitId) return toast.error("Selecciona la unidad destino.");
    setSaving(true);
    try {
      const result = await rpc<{ notified: boolean }>("register_package", {
        p_organization_id: orgId,
        p_unit_id: unitId,
        p_courier: courier.trim() || null,
        p_description: description.trim() || null,
        p_notes: notes.trim() || null
      });
      toast.success(result.notified ? "Paquete registrado. Se avisó al residente por chat." : "Paquete registrado.");
      await queryClient.invalidateQueries({ queryKey: ["packages-pending", orgId] });
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
        <DialogHeader><DialogTitle>Registrar paquete</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div className="space-y-1.5">
            <Label>Unidad destino</Label>
            <Select value={unitId} onValueChange={setUnitId}>
              <SelectTrigger><SelectValue placeholder="Selecciona una unidad" /></SelectTrigger>
              <SelectContent>{units.filter((u) => u.is_active).map((u) => <SelectItem key={u.id} value={u.id}>{u.code}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="package-courier">Transportadora (opcional)</Label>
            <Input id="package-courier" value={courier} onChange={(e) => setCourier(e.target.value)} placeholder="Servientrega, Rappi, Amazon..." />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="package-description">Descripción (opcional)</Label>
            <Input id="package-description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Caja mediana, sobre, comida..." />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="package-notes">Notas</Label>
            <Textarea id="package-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Registrando..." : "Registrar paquete"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
