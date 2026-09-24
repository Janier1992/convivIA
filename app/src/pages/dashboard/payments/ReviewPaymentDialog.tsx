import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, XCircle } from "lucide-react";
import { errorMessage, rpc } from "@/lib/rpc";
import { formatDate, formatMoney, todayIn } from "@/lib/format";
import { PAYMENT_METHOD_LABELS } from "@/lib/labels";
import { useUnits } from "@/hooks/useCatalogs";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FileLink } from "@/components/FileLink";
import type { Payment, PaymentMethod } from "@/types/domain";

/**
 * Un pago reportado por el residente desde el chat: el equipo lo verifica
 * contra el soporte adjunto antes de confirmarlo. La IA nunca hace esto.
 */
export function ReviewPaymentDialog({ payment, onOpenChange }: { payment: Payment | null; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const { data: units = [] } = useUnits();
  const [unitId, setUnitId] = useState(payment?.unit_id ?? "");
  const [amount, setAmount] = useState(payment?.amount != null ? String(payment.amount) : "");
  const [paidOn, setPaidOn] = useState(payment?.paid_on ?? todayIn());
  const [method, setMethod] = useState<PaymentMethod>(payment?.method ?? "bank_transfer");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  if (!payment) return null;

  async function decide(approve: boolean) {
    if (approve) {
      if (!unitId) return toast.error("Selecciona la unidad.");
      const value = Number(amount);
      if (!Number.isFinite(value) || value <= 0) return toast.error("El valor debe ser mayor que cero.");
    } else if (note.trim().length < 5) {
      return toast.error("Indica el motivo del rechazo.");
    }
    setBusy(true);
    try {
      await rpc("review_payment", {
        p_payment_id: payment!.id,
        p_approve: approve,
        p_unit_id: approve ? unitId : null,
        p_amount: approve ? Number(amount) : null,
        p_paid_on: approve ? paidOn : null,
        p_method: approve ? method : null,
        p_note: note.trim() || null
      });
      toast.success(approve ? "Pago confirmado y aplicado a la cuenta." : "Pago rechazado. Se avisó al residente.");
      await queryClient.invalidateQueries();
      onOpenChange(false);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Revisar pago reportado</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-md border border-border p-3 text-sm">
            <div>
              <p className="font-medium">{payment.persons?.full_name ?? "Reportado por chat"}</p>
              <p className="text-muted-foreground">
                {payment.units?.code ?? "Sin unidad indicada"} · {payment.amount ? formatMoney(payment.amount) : "sin valor"} · {payment.paid_on ? formatDate(payment.paid_on) : "sin fecha"}
              </p>
              {payment.reported_note && <p className="mt-1 text-xs text-muted-foreground">Nota del residente: {payment.reported_note}</p>}
            </div>
            {payment.receipt_storage_key && <FileLink kind="payment_receipt" id={payment.id} label="Ver soporte" />}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Unidad (confirma o corrige)</Label>
              <Select value={unitId} onValueChange={setUnitId}>
                <SelectTrigger><SelectValue placeholder="Selecciona la unidad" /></SelectTrigger>
                <SelectContent>{units.filter((u) => u.is_active).map((u) => <SelectItem key={u.id} value={u.id}>{u.code}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rev-amount">Valor</Label>
              <Input id="rev-amount" type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rev-date">Fecha de pago</Label>
              <Input id="rev-date" type="date" value={paidOn} max={todayIn()} onChange={(e) => setPaidOn(e.target.value)} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Medio de pago</Label>
              <Select value={method} onValueChange={(v) => setMethod(v as PaymentMethod)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(PAYMENT_METHOD_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="rev-note">Nota (obligatoria si rechazas)</Label>
              <Textarea id="rev-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ej. El soporte no corresponde al valor reportado" />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="destructive" onClick={() => decide(false)} disabled={busy}><XCircle className="h-4 w-4" aria-hidden /> Rechazar</Button>
          <Button onClick={() => decide(true)} disabled={busy}><CheckCircle2 className="h-4 w-4" aria-hidden /> Confirmar pago</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
