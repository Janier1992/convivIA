import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { History } from "lucide-react";
import { insforge } from "@/lib/insforgeClient";
import { formatDateTime } from "@/lib/format";
import { useOrgId } from "@/hooks/useOrganization";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { QueryErrorState } from "@/components/QueryErrorState";
import type { AuditEvent } from "@/types/domain";

const ALL = "__all__";
const ENTITY_TYPES = [
  "units", "persons", "unit_persons", "charge_concepts", "payments", "pqrs_tickets", "common_areas",
  "area_reservations", "announcements", "documents", "agents", "agent_rules", "integrations", "organization_members"
];

const ACTION_LABELS: Record<AuditEvent["action"], string> = { insert: "Creado", update: "Modificado", delete: "Eliminado" };
const ACTOR_LABELS: Record<AuditEvent["actor_kind"], string> = { staff: "Equipo", agent: "Asistente IA", system: "Sistema", resident: "Residente" };

export function AuditPage() {
  const orgId = useOrgId();
  const [entityType, setEntityType] = useState(ALL);
  const [search, setSearch] = useState("");

  const { data: events = [], isLoading, isError, refetch } = useQuery({
    queryKey: ["audit-events", orgId, entityType],
    enabled: !!orgId,
    queryFn: async () => {
      let query = insforge.database.from("audit_events").select("*").eq("organization_id", orgId).order("created_at", { ascending: false }).limit(300);
      if (entityType !== ALL) query = query.eq("entity_type", entityType);
      const { data, error } = await query;
      if (error) throw error;
      return data as AuditEvent[];
    }
  });

  const filtered = search.trim()
    ? events.filter((e) => JSON.stringify(e).toLowerCase().includes(search.trim().toLowerCase()))
    : events;

  return (
    <div className="space-y-6">
      <PageHeader title="Auditoría" description="Quién cambió qué, cuándo y con qué valores antes y después. No depende de texto generado por IA." />

      <div className="flex flex-col gap-2 sm:flex-row">
        <Select value={entityType} onValueChange={setEntityType}>
          <SelectTrigger className="sm:w-56" aria-label="Filtrar por tabla"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todas las tablas</SelectItem>
            {ENTITY_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar en los valores" className="sm:max-w-xs" aria-label="Buscar" />
      </div>

      {isError ? (
        <QueryErrorState onRetry={() => refetch()} message="No se pudo cargar la auditoría." />
      ) : isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : filtered.length === 0 ? (
        <EmptyState icon={History} title="Sin eventos en este filtro" />
      ) : (
        <Card className="overflow-x-auto">
          <table className="table-base">
            <thead><tr><th>Fecha</th><th>Quién</th><th>Acción</th><th>Tabla</th><th>Cambios</th></tr></thead>
            <tbody>
              {filtered.map((e) => (
                <tr key={e.id}>
                  <td className="whitespace-nowrap">{formatDateTime(e.created_at)}</td>
                  <td><Badge variant={e.actor_kind === "resident" ? "muted" : e.actor_kind === "agent" ? "accent" : "default"}>{ACTOR_LABELS[e.actor_kind]}</Badge></td>
                  <td>{ACTION_LABELS[e.action]}</td>
                  <td>{e.entity_type}</td>
                  <td className="max-w-md">
                    {e.changed_fields && e.changed_fields.length > 0 ? (
                      <ul className="space-y-0.5 text-xs">
                        {e.changed_fields.map((field) => (
                          <li key={field}>
                            <span className="font-medium">{field}:</span> {JSON.stringify(e.before?.[field])} → {JSON.stringify(e.after?.[field])}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
