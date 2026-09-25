import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, AlertTriangle, Compass, Gauge, MessagesSquare } from "lucide-react";
import { rpc } from "@/lib/rpc";
import { formatDate, formatNumber } from "@/lib/format";
import { useOrgId } from "@/hooks/useOrganization";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard } from "@/components/StatCard";
import { QueryErrorState } from "@/components/QueryErrorState";

interface AgentObservability {
  window_days: number;
  totals: { turns: number; replies: number; handoffs: number; fallbacks: number; errors: number };
  escalation_rate: number | null;
  error_rate: number | null;
  groundedness_rate: number | null;
  tool_error_rate: number | null;
  avg_latency_ms: number | null;
  p95_latency_ms: number | null;
  avg_tokens: number | null;
  daily: { date: string; turns: number; handoffs: number; errors: number }[];
  by_channel: { channel: string; turns: number }[];
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
 * Observabilidad del asistente (sección 15 del prompt maestro): sobre
 * ai_traces, sin contenido de mensajes. La "groundedness" es la proxy
 * determinista de veracidad que sí se puede calcular en vivo — cuántas
 * respuestas se apoyaron en al menos una herramienta real. La tasa de
 * alucinación en sí se mide en la suite de evaluación offline
 * (server/tests/agentSecurity.test.ts), no en tráfico real: eso
 * requeriría guardar contenido de mensajes o muestrear con un juez-IA,
 * ninguno de los dos justificado todavía.
 */
export function AgentObservabilityCard() {
  const orgId = useOrgId();
  const [days, setDays] = useState("30");

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["agent-observability", orgId, days],
    enabled: !!orgId,
    queryFn: () => rpc<AgentObservability>("get_agent_observability", { p_organization_id: orgId, p_days: Number(days) })
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle>Calidad y observabilidad</CardTitle>
          <p className="text-sm text-muted-foreground">Qué tan bien está respondiendo el asistente, calculado sobre datos reales, no una opinión.</p>
        </div>
        <Select value={days} onValueChange={setDays}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>{WINDOWS.map((w) => <SelectItem key={w.value} value={w.value}>{w.label}</SelectItem>)}</SelectContent>
        </Select>
      </CardHeader>
      <CardContent className="space-y-4">
        {isError ? (
          <QueryErrorState onRetry={() => refetch()} message="No se pudo cargar la observabilidad del asistente." />
        ) : isLoading || !data ? (
          <Skeleton className="h-48 w-full" />
        ) : data.totals.turns === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Sin conversaciones reales del asistente en este período.</p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard icon={MessagesSquare} label="Turnos del asistente" value={formatNumber(data.totals.turns)} />
              <StatCard
                icon={Compass}
                label="Tasa de escalamiento"
                value={pct(data.escalation_rate)}
                hint={`${formatNumber(data.totals.handoffs)} transferidas a una persona`}
                tone={data.escalation_rate != null && data.escalation_rate > 0.3 ? "warning" : "default"}
              />
              <StatCard
                icon={Gauge}
                label="Respuestas fundamentadas"
                value={pct(data.groundedness_rate)}
                hint="Se apoyaron en al menos una herramienta real"
                tone={data.groundedness_rate != null && data.groundedness_rate < 0.6 ? "warning" : "success"}
              />
              <StatCard
                icon={AlertTriangle}
                label="Tasa de error"
                value={pct(data.error_rate)}
                hint={`${formatNumber(data.totals.errors + data.totals.fallbacks)} fallos o respaldos`}
                tone={data.error_rate != null && data.error_rate > 0.1 ? "destructive" : "default"}
              />
            </div>

            {data.daily.length > 0 && (
              <div>
                <p className="mb-2 text-sm font-semibold">Por día</p>
                <div className="max-h-56 overflow-y-auto rounded-md border border-border">
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
                </div>
              </div>
            )}

            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Activity className="h-3.5 w-3.5" aria-hidden />
              Latencia promedio {formatNumber(data.avg_latency_ms)} ms (p95 {formatNumber(data.p95_latency_ms)} ms) · No incluye conversaciones de vista previa.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
