import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Ban } from "lucide-react";
import { insforge } from "@/lib/insforgeClient";
import { errorMessage, rpc } from "@/lib/rpc";
import { formatDate, formatMoney } from "@/lib/format";
import { PAYMENT_METHOD_LABELS } from "@/lib/labels";
import { useOrganization } from "@/hooks/useOrganization";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { DataSource } from "@/components/DataSource";
import type { Charge, PaymentMethod, UnitStatement } from "@/types/domain";

function Figure({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-md border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-lg font-bold tabular-nums ${tone ?? ""}`}>{value}</p>
    </div>
  );
}

/** Estado de cuenta oficial de una unidad (FIFO calculado en la base de datos) y su libro de cargos. */
export function UnitStatementDialog({ unitId, onOpenChange }: { unitId: string | null; onOpenChange: (open: boolean) => void }) {
  const { currentOrganizationId: orgId, can } = useOrganization();
  const queryClient = useQueryClient();
  const [voiding, setVoiding] = useState<Charge | null>(null);

  const { data: statement, isLoading } = useQuery({
    queryKey: ["unit-statement", unitId],
    enabled: !!unitId,
    queryFn: () => rpc<UnitStatement>("get_unit_statement", { p_unit_id: unitId })
  });

  const { data: charges = [] } = useQuery({
    queryKey: ["unit-charges", unitId],
    enabled: !!unitId,
    queryFn: async () => {
      const { data, error } = await insforge.database
        .from("charges")
        .select("id, unit_id, concept_id, period, description, amount, due_date, status, void_reason, source, created_at, charge_concepts(name)")
        .eq("unit_id", unitId)
        .order("due_date", { ascending: false })
        .limit(60);
      if (error) throw error;
      return data as unknown as Charge[];
    }
  });

  async function voidCharge(reason: string) {
    if (!voiding) return;
    try {
      await rpc("void_charge", { p_charge_id: voiding.id, p_reason: reason });
      toast.success("Cargo anulado. Queda registrado con su motivo.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["unit-statement", unitId] }),
        queryClient.invalidateQueries({ queryKey: ["unit-charges", unitId] }),
        queryClient.invalidateQueries({ queryKey: ["portfolio", orgId] })
      ]);
    } catch (err) {
      toast.error(errorMessage(err));
      throw err;
    }
  }

  return (
    <Dialog open={!!unitId} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Estado de cuenta {statement ? `· ${statement.unit.code}` : ""}</DialogTitle>
        </DialogHeader>
        {isLoading || !statement ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Figure label={Number(statement.balance) < 0 ? "Saldo a favor" : "Saldo total"} value={formatMoney(Math.abs(Number(statement.balance)))} />
              <Figure label="Vencido" value={formatMoney(statement.overdue_amount)} tone={Number(statement.overdue_amount) > 0 ? "text-destructive" : ""} />
              <Figure label="Por vencer" value={formatMoney(statement.current_amount)} />
              <Figure label="Pagos en revisión" value={String(statement.pending_reports)} />
            </div>
            <DataSource source="libro de la unidad (pagos aplicados a los cargos más antiguos)" asOf={statement.as_of} />

            <section className="space-y-2">
              <h3 className="text-sm font-semibold">Cargos</h3>
              <div className="max-h-72 overflow-y-auto rounded-md border border-border">
                <table className="table-base">
                  <thead><tr><th>Concepto</th><th>Vence</th><th className="text-right">Valor</th><th>Estado</th><th /></tr></thead>
                  <tbody>
                    {charges.map((charge) => {
                      const open = statement.open_items.find((i) => i.charge_id === charge.id);
                      return (
                        <tr key={charge.id} className={charge.status === "voided" ? "opacity-60" : undefined}>
                          <td>
                            <p className="font-medium">{charge.description ?? charge.charge_concepts?.name}</p>
                            {charge.void_reason && <p className="text-xs text-muted-foreground">Anulado: {charge.void_reason}</p>}
                          </td>
                          <td>{formatDate(charge.due_date)}</td>
                          <td className="text-right tabular-nums">{formatMoney(charge.amount)}</td>
                          <td>
                            {charge.status === "voided" ? <Badge variant="muted">Anulado</Badge>
                              : open ? <Badge variant={open.days_overdue > 0 ? "destructive" : "warning"}>Debe {formatMoney(open.unpaid)}</Badge>
                              : <Badge variant="success">Pagado</Badge>}
                          </td>
                          <td>
                            {can("finance.write") && charge.status === "active" && (
                              <Button variant="ghost" size="icon" onClick={() => setVoiding(charge)} aria-label="Anular cargo"><Ban className="h-4 w-4" /></Button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {charges.length === 0 && <p className="p-4 text-sm text-muted-foreground">La unidad no tiene cargos.</p>}
              </div>
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold">Últimos pagos confirmados</h3>
              {statement.recent_payments.length === 0 && <p className="text-sm text-muted-foreground">Sin pagos registrados.</p>}
              {statement.recent_payments.map((p) => (
                <div key={p.id} className="flex justify-between rounded-md border border-border px-3 py-2 text-sm">
                  <span>{formatDate(p.paid_on)} · {p.method ? PAYMENT_METHOD_LABELS[p.method as PaymentMethod] : "—"}{p.reference ? ` · ref. ${p.reference}` : ""}</span>
                  <span className="font-semibold tabular-nums">{formatMoney(p.amount)}</span>
                </div>
              ))}
            </section>
          </div>
        )}
        <ConfirmDialog
          open={!!voiding}
          onOpenChange={(open) => !open && setVoiding(null)}
          title="Anular cargo"
          description={voiding ? `${voiding.description ?? voiding.charge_concepts?.name} por ${formatMoney(voiding.amount)}. Los cargos no se borran: quedan anulados con su motivo.` : undefined}
          confirmLabel="Anular"
          destructive
          reasonLabel="Motivo de la anulación"
          onConfirm={voidCharge}
        />
      </DialogContent>
    </Dialog>
  );
}
