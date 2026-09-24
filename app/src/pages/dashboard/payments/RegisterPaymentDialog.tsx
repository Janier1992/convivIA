import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { errorMessage, rpc } from "@/lib/rpc";
import { PAYMENT_METHOD_LABELS } from "@/lib/labels";
import { todayIn } from "@/lib/format";
import { useOrgId } from "@/hooks/useOrganization";
import { useUnits } from "@/hooks/useCatalogs";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { PaymentMethod } from "@/types/domain";

const METHODS: PaymentMethod[] = ["bank_transfer", "pse", "cash", "nequi", "daviplata", "card", "consignment", "other"];

/** Pago que el equipo registra directamente (ya confirmado: llegó por otro canal, ej. consignación en el banco). */
export function RegisterPaymentDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const { data: units = [] } = useUnits();
  const [unitId, setUnitId] = useState("");
  const [amount, setAmount] = useState("");
  const [paidOn, setPaidOn] = useState(todayIn());
  const [method, setMethod] = useState<PaymentMethod>("bank_transfer");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    const value = Number(amount);
    if (!unitId) return toast.error("Selecciona la unidad.");
    if (!Number.isFinite(value) || value <= 0) return toast.error("El valor debe ser mayor que cero.");
    setSaving(true);
    try {
      await rpc("register_payment", {
        p_organization_id: orgId,
        p_unit_id: unitId,
        p_amount: value,
        p_paid_on: paidOn,
        p_method: method,
        p_reference: reference.trim() || null,
        p_note: note.trim() || null
      });
      toast.success("Pago registrado y aplicado a la cuenta de la unidad.");
      await queryClient.invalidateQueries();
      onOpenChange(false);
      setUnitId(""); setAmount(""); setReference(""); setNote("");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Registrar pago</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Unidad</Label>
            <Select value={unitId} onValueChange={setUnitId}>
              <SelectTrigger><SelectValue placeholder="Selecciona la unidad" /></SelectTrigger>
              <SelectContent>{units.filter((u) => u.is_active).map((u) => <SelectItem key={u.id} value={u.id}>{u.code}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pay-amount">Valor</Label>
            <Input id="pay-amount" type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pay-date">Fecha de pago</Label>
            <Input id="pay-date" type="date" value={paidOn} max={todayIn()} onChange={(e) => setPaidOn(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Medio de pago</Label>
            <Select value={method} onValueChange={(v) => setMethod(v as PaymentMethod)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{METHODS.map((m) => <SelectItem key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pay-ref">Referencia (opcional)</Label>
            <Input id="pay-ref" value={reference} onChange={(e) => setReference(e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="pay-note">Nota (opcional)</Label>
            <Textarea id="pay-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Guardando..." : "Registrar pago"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
