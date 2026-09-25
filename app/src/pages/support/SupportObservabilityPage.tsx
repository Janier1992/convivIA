import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Building2, Compass, Gauge, MessagesSquare } from "lucide-react";
import { rpc } from "@/lib/rpc";
import { formatDate, formatNumber } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard } from "@/components/StatCard";
import { PageHeader } from "@/components/PageHeader";
import { QueryErrorState } from "@/components/QueryErrorState";

interface PlatformObservability {
  window_days: number;
  totals: { turns: number; organizations: number; replies: number; handoffs: number; fallbacks: number; errors: number };
  escalation_rate: number | null;
  error_rate: number | null;
  groundedness_rate: number | null;
  avg_latency_ms: number | null;
  daily: { date: string; turns: number; handoffs: number; errors: number }[];
  by_model: { model: string; turns: number; escalation_rate: number | null; error_rate: number | null }[];
  top_organizations: { organization_id: string; organization_name: string; turns: number; escalation_rate: number | null; error_rate: number | null }[];
}

function pct(value: number | null): string {
  return value == null ? "—" : `${Math.round(value * 1000) / 10}%`;
}

const WINDOWS = [
  { value: "7", label: "Últimos 7 días" },
  { value: "30", label: "Últimos 30 días" },
  { value: "90", label: "Últimos 90 días" }
];

/**
 * Red de seguridad de plataforma (sección 15 del prompt maestro): si un
 * cambio de modelo o de prompt degrada la calidad, esto lo muestra
 * agregado en todo el fleet, no copropiedad por copropiedad. El desglose
 * por modelo es la señal más directa de un cambio de proveedor.
 */
export function SupportObservabilityPage() {
  const [days, setDays] = useState("30");

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["platform-agent-observability", days],
    queryFn: () => rpc<PlatformObservability>("get_platform_agent_observability", { p_days: Number(days) })
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Observabilidad del asistente"
        description="Calidad del asistente de IA en todas las copropiedades: la red de seguridad si un cambio de modelo o de prompt degrada algo."
        actions={
          <Select value={days} onValueChange={setDays}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>{WINDOWS.map((w) => <SelectItem key={w.value} value={w.value}>{w.label}</SelectItem>)}</SelectContent>
          </Select>
        }
      />

      {isError ? (
        <QueryErrorState onRetry={() => refetch()} message="No se pudo cargar la observabilidad de plataforma." />
      ) : isLoading || !data ? (
        <Skeleton className="h-96 w-full" />
      ) : data.totals.turns === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Sin turnos del asistente en este período.</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <StatCard icon={MessagesSquare} label="Turnos totales" value={formatNumber(data.totals.turns)} />
            <StatCard icon={Building2} label="Copropiedades activas" value={formatNumber(data.totals.organizations)} />
            <StatCard
              icon={Compass}
              label="Escalamiento"
              value={pct(data.escalation_rate)}
              tone={data.escalation_rate != null && data.escalation_rate > 0.3 ? "warning" : "default"}
            />
            <StatCard
              icon={Gauge}
              label="Fundamentadas"
              value={pct(data.groundedness_rate)}
              tone={data.groundedness_rate != null && data.groundedness_rate < 0.6 ? "warning" : "success"}
            />
            <StatCard
              icon={AlertTriangle}
              label="Errores"
              value={pct(data.error_rate)}
              tone={data.error_rate != null && data.error_rate > 0.1 ? "destructive" : "default"}
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card className="overflow-x-auto p-4">
              <p className="mb-3 text-sm font-semibold">Por modelo (detecta un cambio de proveedor)</p>
              <table className="table-base">
                <thead><tr><th>Modelo</th><th>Turnos</th><th>Escalamiento</th><th>Error</th></tr></thead>
                <tbody>
                  {data.by_model.map((m) => (
                    <tr key={m.model}>
                      <td className="font-medium">{m.model}</td>
                      <td>{formatNumber(m.turns)}</td>
                      <td>{pct(m.escalation_rate)}</td>
                      <td className={m.error_rate != null && m.error_rate > 0.1 ? "text-destructive" : ""}>{pct(m.error_rate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            <Card className="overflow-x-auto p-4">
              <p className="mb-3 text-sm font-semibold">Copropiedades con más actividad</p>
              <table className="table-base">
                <thead><tr><th>Copropiedad</th><th>Turnos</th><th>Escalamiento</th><th>Error</th></tr></thead>
                <tbody>
                  {data.top_organizations.map((o) => (
                    <tr key={o.organization_id}>
                      <td className="font-medium">{o.organization_name}</td>
                      <td>{formatNumber(o.turns)}</td>
                      <td>{pct(o.escalation_rate)}</td>
                      <td className={o.error_rate != null && o.error_rate > 0.1 ? "text-destructive" : ""}>{pct(o.error_rate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>

          <Card className="overflow-x-auto p-4">
            <p className="mb-3 text-sm font-semibold">Por día</p>
            <table className="table-base">
              <thead><tr><th>Fecha</th><th>Turnos</th><th>Escalados</th><th>Errores</th></tr></thead>
              <tbody>
                {[...data.daily].reverse().map((d) => (
                  <tr key={d.date}>
                    <td>{formatDate(d.date)}</td>
                    <td>{formatNumber(d.turns)}</td>
                    <td>{formatNumber(d.handoffs)}</td>
                    <td className={d.errors > 0 ? "text-destructive" : ""}>{formatNumber(d.errors)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}
