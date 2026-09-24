import { AlertTriangle, CalendarCheck, ClipboardList, Headset, MessageCircle, Receipt, TrendingUp, Wallet } from "lucide-react";
import { useOrganization } from "@/hooks/useOrganization";
import { usePropertyProfile } from "@/hooks/usePropertyProfile";
import { useAdminDashboard } from "@/hooks/useAdminDashboard";
import { formatMoney, formatNumber } from "@/lib/format";
import { PageHeader } from "@/components/PageHeader";
import { StatCard } from "@/components/StatCard";
import { DataSource } from "@/components/DataSource";
import { QueryErrorState } from "@/components/QueryErrorState";
import { SetupChecklist } from "./home/SetupChecklist";
import { DailyBriefCard } from "./home/DailyBriefCard";
import { RecentPqrsCard } from "./home/RecentPqrsCard";

function variation(current: number, previous: number): string | undefined {
  if (!previous) return undefined;
  const pct = ((current - previous) / previous) * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(0)}% frente al mes anterior (${formatMoney(previous)})`;
}

export function DashboardHome() {
  const { can } = useOrganization();
  const { data: profile } = usePropertyProfile();
  const { data, isLoading, isError, refetch } = useAdminDashboard();
  const finance = data?.finance;
  const today = new Date().toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long" });

  return (
    <div className="space-y-6">
      <PageHeader title={profile?.display_name ?? "Inicio"} description={`Resumen de hoy, ${today}.`} />

      {can("settings.manage") && <SetupChecklist />}

      {isError ? (
        <QueryErrorState onRetry={() => refetch()} message="No se pudieron cargar las cifras del tablero." />
      ) : (
        <>
          {can("finance.read") && (
            <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Cartera y recaudo">
              <StatCard
                icon={TrendingUp}
                tone="success"
                label="Recaudo del mes"
                value={formatMoney(finance?.collected_this_month)}
                hint={finance ? variation(finance.collected_this_month, finance.collected_prev_month) : undefined}
                loading={isLoading}
                to="/dashboard/payments"
              />
              <StatCard
                icon={Wallet}
                tone="warning"
                label="Cartera vencida"
                value={formatMoney(finance?.overdue_total)}
                hint={finance ? `${finance.units_overdue} unidades en mora · ${finance.units_overdue_90} con más de 90 días` : undefined}
                loading={isLoading}
                to="/dashboard/billing"
              />
              <StatCard
                icon={Receipt}
                label="Pagos por revisar"
                value={formatNumber(finance?.payments_pending_review ?? 0)}
                hint="Reportados por residentes desde el chat"
                tone={(finance?.payments_pending_review ?? 0) > 0 ? "warning" : "default"}
                loading={isLoading}
                to="/dashboard/payments"
              />
              <StatCard
                icon={Wallet}
                label="Facturado este mes"
                value={formatMoney(finance?.billed_this_month)}
                hint={`Cartera total ${formatMoney(finance?.portfolio_total)}`}
                loading={isLoading}
                to="/dashboard/billing"
              />
            </section>
          )}

          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Operación">
            <StatCard
              icon={ClipboardList}
              label="PQRS abiertas"
              value={formatNumber(data?.pqrs.open)}
              hint={data ? `${data.pqrs.overdue} vencidas · ${data.pqrs.due_soon} vencen en 24 h` : undefined}
              tone={(data?.pqrs.overdue ?? 0) > 0 ? "destructive" : "default"}
              loading={isLoading}
              to={can("pqrs.read") ? "/dashboard/pqrs" : undefined}
            />
            <StatCard
              icon={CalendarCheck}
              label="Reservas de hoy"
              value={formatNumber(data?.reservations.today)}
              hint={data ? `${data.reservations.pending_approval} por aprobar` : undefined}
              tone="accent"
              loading={isLoading}
              to={can("reservations.read") ? "/dashboard/reservations" : undefined}
            />
            <StatCard
              icon={Headset}
              label="Conversaciones con el equipo"
              value={formatNumber(data?.conversations.handoff)}
              hint="El asistente está en pausa en ellas"
              tone={(data?.conversations.handoff ?? 0) > 0 ? "warning" : "default"}
              loading={isLoading}
              to={can("inbox.read") ? "/dashboard/inbox" : undefined}
            />
            <StatCard
              icon={MessageCircle}
              label="Residentes con canal vinculado"
              value={formatNumber(data?.conversations.verified_residents)}
              hint={data ? `${data.conversations.active_7d} conversaciones activas en 7 días` : undefined}
              loading={isLoading}
            />
          </section>

          {data && <DataSource source="tablero de ConvivIA (cifras calculadas en la base de datos)" asOf={data.as_of} />}
        </>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <DailyBriefCard />
        {can("pqrs.read") ? <RecentPqrsCard /> : null}
      </div>

      {data && data.units_total === 0 && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <AlertTriangle className="h-4 w-4" aria-hidden /> Aún no hay unidades registradas: las cifras estarán en cero hasta importar el censo.
        </p>
      )}
    </div>
  );
}
