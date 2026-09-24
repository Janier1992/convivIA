import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { errorMessage, rpc } from "@/lib/rpc";
import { firstDayOfMonth, formatMoney, todayIn } from "@/lib/format";
import { useOrgId } from "@/hooks/useOrganization";
import { usePropertyProfile } from "@/hooks/usePropertyProfile";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface InterestPreviewRow {
  unit_code: string;
  base_amount: number;
  amount: number;
  already_exists: boolean;
}

interface InterestPreview {
  monthly_rate: number;
  new_count: number;
  new_total: number;
  rows: InterestPreviewRow[];
}

/** Intereses de mora: tasa mensual configurada sobre el saldo vencido a la fecha de corte. */
export function GenerateInterestDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const { data: profile } = usePropertyProfile();
  const today = todayIn();
  const [period, setPeriod] = useState(firstDayOfMonth(today));
  const [cutoff, setCutoff] = useState(today);
  const [dueDate, setDueDate] = useState(today);
  const [preview, setPreview] = useState<InterestPreview | null>(null);
  const [busy, setBusy] = useState(false);

  const rate = profile?.late_interest_monthly_rate ?? 0;

  async function runPreview() {
    setBusy(true);
    setPreview(null);
    try {
      setPreview(await rpc<InterestPreview>("preview_interest_charges", { p_organization_id: orgId, p_period: period, p_cutoff: cutoff }));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    setBusy(true);
    try {
      const result = await rpc<{ created: number; total_amount: number }>("generate_interest_charges", {
        p_organization_id: orgId,
        p_period: period,
        p_cutoff: cutoff,
        p_due_date: dueDate
      });
      toast.success(result.created > 0 ? `${result.created} cargos de interés por ${formatMoney(result.total_amount)}.` : "No había saldos vencidos para liquidar intereses.");
      await queryClient.invalidateQueries();
      onOpenChange(false);
      setPreview(null);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Liquidar intereses de mora</DialogTitle>
          <DialogDescription>
            Tasa configurada: {rate}% mensual sobre el saldo vencido a la fecha de corte (nunca interés sobre interés).
            {rate === 0 && " Configura la tasa en Configuración → Cartera para poder liquidar."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="int-period">Periodo</Label>
            <Input id="int-period" type="month" value={period.slice(0, 7)} onChange={(e) => setPeriod(firstDayOfMonth(`${e.target.value}-01`))} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="int-cutoff">Fecha de corte</Label>
            <Input id="int-cutoff" type="date" value={cutoff} onChange={(e) => setCutoff(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="int-due">Vencimiento</Label>
            <Input id="int-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
        </div>
        <Button variant="outline" onClick={runPreview} disabled={busy || rate === 0} className="w-fit">
          {busy && !preview ? "Calculando..." : "Ver vista previa"}
        </Button>
        {preview && (
          <div className="space-y-2 rounded-md border border-border p-3">
            <p className="text-sm"><span className="font-bold">{preview.new_count}</span> unidades con interés · <span className="font-bold">{formatMoney(preview.new_total)}</span> total</p>
            <div className="max-h-48 overflow-y-auto rounded border border-border">
              <table className="table-base">
                <thead><tr><th>Unidad</th><th className="text-right">Base vencida</th><th className="text-right">Interés</th></tr></thead>
                <tbody>
                  {preview.rows.filter((r) => !r.already_exists).map((row, i) => (
                    <tr key={i}><td>{row.unit_code}</td><td className="text-right tabular-nums">{formatMoney(row.base_amount)}</td><td className="text-right tabular-nums">{formatMoney(row.amount)}</td></tr>
                  ))}
                </tbody>
              </table>
              {preview.new_count === 0 && <p className="p-3 text-sm text-muted-foreground">No hay saldos vencidos que generen interés.</p>}
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={confirm} disabled={busy || !preview || preview.new_count === 0}>
            {busy && preview ? "Generando..." : "Generar intereses"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
