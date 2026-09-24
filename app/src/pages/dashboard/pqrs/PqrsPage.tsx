import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ClipboardList, Plus } from "lucide-react";
import { insforge } from "@/lib/insforgeClient";
import { formatRelative } from "@/lib/format";
import { PQRS_PRIORITY, PQRS_STATUS } from "@/lib/labels";
import { useOrganization, useOrgId } from "@/hooks/useOrganization";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { QueryErrorState } from "@/components/QueryErrorState";
import type { PqrsTicket } from "@/types/domain";
import { CreatePqrsDialog } from "./CreatePqrsDialog";
import { PqrsDetailDialog } from "./PqrsDetailDialog";

const OPEN = "__open__";
const ALL = "__all__";
const STATUS_FILTERS = [
  { value: OPEN, label: "Abiertas" },
  { value: ALL, label: "Todas" },
  { value: "answered", label: "Respondidas" },
  { value: "closed", label: "Cerradas" }
];

export function PqrsPage() {
  const orgId = useOrgId();
  const { can } = useOrganization();
  const [statusFilter, setStatusFilter] = useState(OPEN);
  const [createOpen, setCreateOpen] = useState(false);
  const [selected, setSelected] = useState<PqrsTicket | null>(null);

  const { data: tickets = [], isLoading, isError, refetch } = useQuery({
    queryKey: ["pqrs", orgId, statusFilter],
    enabled: !!orgId,
    queryFn: async () => {
      let query = insforge.database
        .from("pqrs_tickets")
        .select("*, pqrs_categories(name), units(code)")
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false })
        .limit(300);
      if (statusFilter === OPEN) query = query.not("status", "in", "(answered,closed)");
      else if (statusFilter !== ALL) query = query.eq("status", statusFilter);
      const { data, error } = await query;
      if (error) throw error;
      return data as unknown as PqrsTicket[];
    }
  });

  const sorted = useMemo(
    () => [...tickets].sort((a, b) => new Date(a.due_at ?? a.created_at).getTime() - new Date(b.due_at ?? b.created_at).getTime()),
    [tickets]
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="PQRS"
        description="Peticiones, quejas, reclamos, sugerencias y felicitaciones, con radicado, SLA e historial."
        actions={can("pqrs.write") && <Button onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" aria-hidden /> Radicar</Button>}
      />

      <Select value={statusFilter} onValueChange={setStatusFilter}>
        <SelectTrigger className="w-56" aria-label="Filtrar por estado"><SelectValue /></SelectTrigger>
        <SelectContent>{STATUS_FILTERS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}</SelectContent>
      </Select>

      {isError ? (
        <QueryErrorState onRetry={() => refetch()} message="No se pudieron cargar las PQRS." />
      ) : isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : sorted.length === 0 ? (
        <EmptyState icon={ClipboardList} title="No hay PQRS en este filtro" />
      ) : (
        <Card className="overflow-x-auto">
          <table className="table-base">
            <thead><tr><th>Radicado</th><th>Asunto</th><th>Unidad</th><th>Prioridad</th><th>Estado</th><th>Vence</th></tr></thead>
            <tbody>
              {sorted.map((t) => {
                const overdue = t.due_at && new Date(t.due_at) < new Date() && t.status !== "answered" && t.status !== "closed";
                return (
                  <tr key={t.id} className="cursor-pointer" onClick={() => setSelected(t)}>
                    <td className="font-medium">{t.radicado}</td>
                    <td className="max-w-xs truncate">{t.subject}</td>
                    <td>{t.units?.code ?? "—"}</td>
                    <td><Badge variant={PQRS_PRIORITY[t.priority].variant}>{PQRS_PRIORITY[t.priority].label}</Badge></td>
                    <td><Badge variant={PQRS_STATUS[t.status].variant}>{PQRS_STATUS[t.status].label}</Badge></td>
                    <td className={overdue ? "font-medium text-destructive" : ""}>
                      {overdue && <AlertTriangle className="mr-1 inline h-3.5 w-3.5" aria-hidden />}
                      {t.due_at ? formatRelative(t.due_at) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      <CreatePqrsDialog open={createOpen} onOpenChange={setCreateOpen} />
      <PqrsDetailDialog ticket={selected} onOpenChange={(open) => !open && setSelected(null)} />
    </div>
  );
}
