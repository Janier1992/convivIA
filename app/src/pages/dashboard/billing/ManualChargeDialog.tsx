import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { errorMessage, rpc } from "@/lib/rpc";
import { todayIn } from "@/lib/format";
import { useOrgId } from "@/hooks/useOrganization";
import { useUnits } from "@/hooks/useCatalogs";
import { insforge } from "@/lib/insforgeClient";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { ChargeConcept } from "@/types/domain";

/** Cargo manual (extraordinaria, multa, u otro concepto no del sistema) a una unidad puntual. */
export function ManualChargeDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const { data: units = [] } = useUnits();
  const { data: concepts = [] } = useQuery({
    queryKey: ["charge-concepts", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await insforge.database
        .from("charge_concepts")
        .select("*")
        .eq("organization_id", orgId)
        .eq("is_active", true)
        .eq("is_system", false)
        .order("name", { ascending: true });
      if (error) throw error;
      return data as ChargeConcept[];
    }
  });
  const [unitId, setUnitId] = useState("");
  const [conceptId, setConceptId] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState(todayIn());
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    const value = Number(amount);
    if (!unitId) return toast.error("Selecciona la unidad.");
    if (!conceptId) return toast.error("Selecciona el concepto.");
    if (!Number.isFinite(value) || value <= 0) return toast.error("El valor debe ser mayor que cero.");
    setSaving(true);
    try {
      await rpc("create_manual_charge", {
        p_organization_id: orgId,
        p_unit_id: unitId,
        p_concept_id: conceptId,
        p_amount: value,
        p_due_date: dueDate,
        p_description: description.trim() || null
      });
      toast.success("Cargo creado.");
      await queryClient.invalidateQueries();
      onOpenChange(false);
      setUnitId(""); setConceptId(""); setAmount(""); setDescription("");
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
          <DialogTitle>Cargo manual</DialogTitle>
          <DialogDescription>Cuota extraordinaria, multa u otro concepto que no se liquida automáticamente.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Unidad</Label>
            <Select value={unitId} onValueChange={setUnitId}>
              <SelectTrigger><SelectValue placeholder="Selecciona la unidad" /></SelectTrigger>
              <SelectContent>{units.filter((u) => u.is_active).map((u) => <SelectItem key={u.id} value={u.id}>{u.code}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Concepto</Label>
            <Select value={conceptId} onValueChange={setConceptId}>
              <SelectTrigger><SelectValue placeholder="Selecciona el concepto" /></SelectTrigger>
              <SelectContent>{concepts.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
            </Select>
            {concepts.length === 0 && <p className="text-xs text-warning">Crea un concepto en Configuración → Cartera antes de registrar el cargo.</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mc-amount">Valor</Label>
            <Input id="mc-amount" type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mc-due">Fecha de vencimiento</Label>
            <Input id="mc-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="mc-desc">Descripción (opcional)</Label>
            <Textarea id="mc-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ej. Multa por ruido, sesión del 3 de octubre" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Guardando..." : "Crear cargo"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
