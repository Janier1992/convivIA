import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Briefcase, ClipboardList, Layers, Wallet, Wrench } from "lucide-react";
import { rpc } from "@/lib/rpc";
import { formatMoney, formatNumber } from "@/lib/format";
import { ROLE_LABELS } from "@/lib/labels";
import { useOrganization } from "@/hooks/useOrganization";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/PageHeader";
import { StatCard } from "@/components/StatCard";
import { QueryErrorState } from "@/components/QueryErrorState";
import type { PortfolioOrgSummary } from "@/types/domain";

/**
 * Vista consolidada para quien administra varias copropiedades a la vez
 * (empresa administradora): agrega cartera vencida, PQRS y mantenimiento
 * de todas sus copropiedades en una sola pantalla, sin duplicar la lógica
 * de cada módulo (get_portfolio_overview reutiliza ledger_open_items).
 * Cada cifra puede venir null si el rol de esa copropiedad puntual no
 * tiene el permiso de lectura correspondiente.
 */
export function PortfolioPage() {
  const navigate = useNavigate();
  const { setCurrentOrganizationId } = useOrganization();

  const { data: rows = [], isLoading, isError, refetch } = useQuery({
    queryKey: ["portfolio-overview"],
    queryFn: () => rpc<PortfolioOrgSummary[]>("get_portfolio_overview")
  });

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, r) => ({
          overdue: acc.overdue + (r.overdue_total ?? 0),
          pqrsOpen: acc.pqrsOpen + (r.pqrs_open ?? 0),
          workOrdersOpen: acc.workOrdersOpen + (r.work_orders_open ?? 0)
        }),
        { overdue: 0, pqrsOpen: 0, workOrdersOpen: 0 }
      ),
    [rows]
  );

  function openOrganization(orgId: string) {
    setCurrentOrganizationId(orgId);
    navigate("/dashboard");
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Portafolio"
        description="Cartera, PQRS y mantenimiento de todas las copropiedades que administras, en una sola pantalla."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={Layers} label="Copropiedades" value={formatNumber(rows.length)} loading={isLoading} />
        <StatCard icon={Wallet} label="Cartera vencida (total)" value={formatMoney(totals.overdue)} tone="warning" loading={isLoading} />
        <StatCard icon={ClipboardList} label="PQRS abiertas (total)" value={formatNumber(totals.pqrsOpen)} tone="accent" loading={isLoading} />
        <StatCard icon={Wrench} label="Mantenimiento abierto (total)" value={formatNumber(totals.workOrdersOpen)} loading={isLoading} />
      </div>

      {isError ? (
        <QueryErrorState onRetry={() => refetch()} message="No se pudo cargar el portafolio." />
      ) : isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <Card className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>Copropiedad</th>
                <th>Tu rol</th>
                <th>Unidades</th>
                <th>Cartera vencida</th>
                <th>PQRS abiertas</th>
                <th>Mantenimiento abierto</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.organization_id} className="cursor-pointer" onClick={() => openOrganization(r.organization_id)}>
                  <td className="font-medium">{r.organization_name}</td>
                  <td><Badge variant="muted">{ROLE_LABELS[r.role]}</Badge></td>
                  <td>{formatNumber(r.units_total)}</td>
                  <td className={r.overdue_total && r.overdue_total > 0 ? "font-medium text-destructive" : ""}>
                    {r.overdue_total == null ? "—" : formatMoney(r.overdue_total)}
                  </td>
                  <td>{r.pqrs_open == null ? "—" : formatNumber(r.pqrs_open)}</td>
                  <td>{r.work_orders_open == null ? "—" : formatNumber(r.work_orders_open)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Briefcase className="h-3.5 w-3.5" aria-hidden />
        Toca una copropiedad para entrar a su panel completo.
      </p>
    </div>
  );
}
