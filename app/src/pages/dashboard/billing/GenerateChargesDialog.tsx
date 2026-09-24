import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { errorMessage, rpc } from "@/lib/rpc";
import { addMonths, dayOfMonth, firstDayOfMonth, formatMoney, monthLabel, todayIn } from "@/lib/format";
import { useOrgId } from "@/hooks/useOrganization";
import { usePropertyProfile } from "@/hooks/usePropertyProfile";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface PreviewRow {
  unit_code: string;
  concept: string;
  amount: number;
  already_exists: boolean;
}

interface MonthlyPreview {
  new_count: number;
  existing_count: number;
  new_total: number;
  coefficient_sum: number;
  active_units: number;
  rows: PreviewRow[];
}

/** Liquidación mensual: vista previa determinista antes de generar, e idempotente (no duplica). */
export function GenerateChargesDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const { data: profile } = usePropertyProfile();
  const [period, setPeriod] = useState(firstDayOfMonth(todayIn()));
  const [dueDate, setDueDate] = useState(dayOfMonth(addMonths(firstDayOfMonth(todayIn()), 0), profile?.due_day ?? 10));
  const [preview, setPreview] = useState<MonthlyPreview | null>(null);
  const [busy, setBusy] = useState(false);

  async function runPreview() {
    setBusy(true);
    setPreview(null);
    try {
      setPreview(await rpc<MonthlyPreview>("preview_monthly_charges", { p_organization_id: orgId, p_period: period }));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    setBusy(true);
    try {
      const result = await rpc<{ created: number; total_amount: number }>("generate_monthly_charges", {
        p_organization_id: orgId,
        p_period: period,
        p_due_date: dueDate
      });
      if (result.created === 0) {
        toast.info("No había nada nuevo por liquidar (ya se había generado antes).");
      } else {
        toast.success(`${result.created} cargos generados por ${formatMoney(result.total_amount)}.`);
      }
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
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Liquidar cuotas del mes</DialogTitle>
          <DialogDescription>
            Genera la cuota de administración (y demás conceptos fijos o por coeficiente) para todas las unidades activas.
            No duplica: si ya se generó ese periodo, lo omite.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="period">Periodo</Label>
            <Input id="period" type="month" value={period.slice(0, 7)} onChange={(e) => setPeriod(firstDayOfMonth(`${e.target.value}-01`))} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="due">Fecha de vencimiento</Label>
            <Input id="due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} min={period} />
          </div>
        </div>
        <Button variant="outline" onClick={runPreview} disabled={busy} className="w-fit">
          {busy && !preview ? "Calculando..." : "Ver vista previa"}
        </Button>

        {preview && (
          <div className="space-y-3 rounded-md border border-border p-3">
            <p className="text-sm font-semibold">{monthLabel(period)}</p>
            {preview.coefficient_sum > 0 && Math.abs(preview.coefficient_sum - 100) > 0.5 && (
              <p className="text-xs text-warning">
                Aviso: los coeficientes de las unidades activas suman {preview.coefficient_sum.toFixed(2)}%, no 100%. Revísalos en Unidades.
              </p>
            )}
            <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
              <p><span className="font-bold">{preview.new_count}</span> cargos nuevos</p>
              <p><span className="font-bold">{preview.existing_count}</span> ya existían</p>
              <p><span className="font-bold">{formatMoney(preview.new_total)}</span> a liquidar</p>
            </div>
            <div className="max-h-48 overflow-y-auto rounded border border-border">
              <table className="table-base">
                <thead><tr><th>Unidad</th><th>Concepto</th><th className="text-right">Valor</th></tr></thead>
                <tbody>
                  {preview.rows.filter((r) => !r.already_exists).slice(0, 200).map((row, i) => (
                    <tr key={i}><td>{row.unit_code}</td><td>{row.concept}</td><td className="text-right tabular-nums">{formatMoney(row.amount)}</td></tr>
                  ))}
                </tbody>
              </table>
              {preview.new_count === 0 && <p className="p-3 text-sm text-muted-foreground">Nada nuevo por liquidar en este periodo.</p>}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={confirm} disabled={busy || !preview || preview.new_count === 0}>
            {busy && preview ? "Generando..." : `Generar ${preview?.new_count ?? ""} cargos`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
