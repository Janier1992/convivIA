import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarClock, Download, FileText, Percent, Plus, Wallet } from "lucide-react";
import { rpc } from "@/lib/rpc";
import { downloadCsv } from "@/lib/csv";
import { formatMoney, formatNumber } from "@/lib/format";
import { useOrganization, useOrgId } from "@/hooks/useOrganization";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/PageHeader";
import { StatCard } from "@/components/StatCard";
import { EmptyState } from "@/components/EmptyState";
import { QueryErrorState } from "@/components/QueryErrorState";
import type { PortfolioRow } from "@/types/domain";
import { AgingChart } from "./AgingChart";
import { UnitStatementDialog } from "./UnitStatementDialog";
import { GenerateChargesDialog } from "./GenerateChargesDialog";
import { GenerateInterestDialog } from "./GenerateInterestDialog";
import { ManualChargeDialog } from "./ManualChargeDialog";

export function BillingPage() {
  const orgId = useOrgId();
  const { can } = useOrganization();
  const canWrite = can("finance.write");
  const [search, setSearch] = useState("");
  const [selectedUnit, setSelectedUnit] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"generate" | "interest" | "manual" | null>(null);

  const { data: portfolio = [], isLoading, isError, refetch } = useQuery({
    queryKey: ["portfolio", orgId],
    enabled: !!orgId,
    queryFn: () => rpc<PortfolioRow[]>("get_portfolio", { p_organization_id: orgId })
  });

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return portfolio;
    return portfolio.filter((r) => r.unit_code.toLowerCase().includes(term) || r.owner_names?.toLowerCase().includes(term));
  }, [portfolio, search]);

  const totals = portfolio.reduce(
    (acc, r) => ({ balance: acc.balance + Number(r.balance), overdue: acc.overdue + Number(r.overdue_amount) }),
    { balance: 0, overdue: 0 }
  );
  const inMora = portfolio.filter((r) => Number(r.overdue_amount) > 0).length;

  function exportCsv() {
    downloadCsv(
      `cartera-${orgId}.csv`,
      ["Unidad", "Torre", "Propietario(s)", "Saldo total", "Vencido", "Por vencer", "1-30", "31-60", "61-90", "+90"],
      filtered.map((r) => [r.unit_code, r.tower_name ?? "", r.owner_names ?? "", r.balance, r.overdue_amount, r.not_due, r.d1_30, r.d31_60, r.d61_90, r.d90_plus])
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cartera"
        description="Estado de cuenta de cada unidad, calculado en la base de datos (FIFO). Ninguna cifra sale del panel ni de la IA."
        actions={
          canWrite && (
            <>
              <Button variant="outline" onClick={() => setDialog("manual")}><Plus className="h-4 w-4" aria-hidden /> Cargo manual</Button>
              <Button variant="outline" onClick={() => setDialog("interest")}><Percent className="h-4 w-4" aria-hidden /> Intereses de mora</Button>
              <Button onClick={() => setDialog("generate")}><CalendarClock className="h-4 w-4" aria-hidden /> Liquidar cuotas</Button>
            </>
          )
        }
      />

      {isError ? (
        <QueryErrorState onRetry={() => refetch()} message="No se pudo cargar la cartera." />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard icon={Wallet} label="Cartera total" value={formatMoney(totals.balance)} loading={isLoading} />
            <StatCard icon={Wallet} tone="warning" label="Cartera vencida" value={formatMoney(totals.overdue)} hint={`${inMora} unidades en mora`} loading={isLoading} />
            <StatCard icon={FileText} label="Unidades" value={formatNumber(portfolio.length)} loading={isLoading} />
          </div>

          <Card>
            <CardHeader><CardTitle>Cartera por edades</CardTitle></CardHeader>
            <CardContent>{isLoading ? <Skeleton className="h-40 w-full" /> : <AgingChart rows={portfolio} />}</CardContent>
          </Card>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por unidad o propietario" className="sm:max-w-xs" aria-label="Buscar en la cartera" />
            <Button variant="outline" size="sm" onClick={exportCsv}><Download className="h-4 w-4" aria-hidden /> Exportar CSV</Button>
          </div>

          {isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : portfolio.length === 0 ? (
            <EmptyState icon={Wallet} title="Aún no hay cartera" description="Liquida las cuotas del mes o registra un cargo manual para empezar." />
          ) : (
            <Card className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr><th>Unidad</th><th>Propietario(s)</th><th className="text-right">Saldo</th><th className="text-right">Vencido</th><th>Estado</th></tr>
                </thead>
                <tbody>
                  {filtered.map((row) => (
                    <tr key={row.unit_id} className="cursor-pointer" onClick={() => setSelectedUnit(row.unit_id)}>
                      <td className="font-medium">{row.unit_code}{row.tower_name ? <span className="text-muted-foreground"> · {row.tower_name}</span> : ""}</td>
                      <td>{row.owner_names ?? "—"}</td>
                      <td className={`text-right tabular-nums ${Number(row.balance) < 0 ? "text-success" : ""}`}>{formatMoney(row.balance)}</td>
                      <td className="text-right tabular-nums">{Number(row.overdue_amount) > 0 ? formatMoney(row.overdue_amount) : "—"}</td>
                      <td>
                        {Number(row.balance) <= 0 ? <Badge variant="success">Al día</Badge>
                          : Number(row.overdue_amount) === 0 ? <Badge variant="default">Por vencer</Badge>
                          : row.d90_plus > 0 ? <Badge variant="destructive">+90 días</Badge>
                          : <Badge variant="warning">En mora</Badge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filtered.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">Ninguna unidad coincide con la búsqueda.</p>}
            </Card>
          )}
        </>
      )}

      <UnitStatementDialog unitId={selectedUnit} onOpenChange={(open) => !open && setSelectedUnit(null)} />
      <GenerateChargesDialog open={dialog === "generate"} onOpenChange={(open) => !open && setDialog(null)} />
      <GenerateInterestDialog open={dialog === "interest"} onOpenChange={(open) => !open && setDialog(null)} />
      <ManualChargeDialog open={dialog === "manual"} onOpenChange={(open) => !open && setDialog(null)} />
    </div>
  );
}
