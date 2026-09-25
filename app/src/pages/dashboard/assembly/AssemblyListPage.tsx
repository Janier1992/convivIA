import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Gavel } from "lucide-react";
import { insforge } from "@/lib/insforgeClient";
import { formatDateTime } from "@/lib/format";
import { ASSEMBLY_STATUS, ASSEMBLY_TYPE_LABELS } from "@/lib/labels";
import { useOrganization, useOrgId } from "@/hooks/useOrganization";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { QueryErrorState } from "@/components/QueryErrorState";
import type { Assembly } from "@/types/domain";
import { CreateAssemblyDialog } from "./CreateAssemblyDialog";

export function AssemblyListPage() {
  const orgId = useOrgId();
  const { can } = useOrganization();
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["assemblies", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await insforge.database
        .from("assemblies")
        .select("*")
        .eq("organization_id", orgId)
        .order("scheduled_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data as Assembly[];
    }
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Asamblea y gobierno"
        description="Convocatoria, orden del día, poderes, quórum, votación y acta. El quórum siempre se calcula sobre coeficientes reales."
        actions={can("assembly.write") && <Button onClick={() => setCreateOpen(true)}>Convocar asamblea</Button>}
      />

      {isError ? (
        <QueryErrorState onRetry={() => refetch()} message="No se pudieron cargar las asambleas." />
      ) : isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : data!.length === 0 ? (
        <EmptyState
          icon={Gavel}
          title="Todavía no hay ninguna asamblea registrada"
          description="Convoca la próxima asamblea ordinaria o extraordinaria para empezar a llevar el orden del día, los poderes y el quórum aquí."
        />
      ) : (
        <Card className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>Asamblea</th><th>Tipo</th><th>Fecha</th><th>Lugar</th><th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {data!.map((a) => (
                <tr key={a.id} className="cursor-pointer" onClick={() => navigate(`/dashboard/assembly/${a.id}`)}>
                  <td className="font-medium">{a.title}</td>
                  <td>{ASSEMBLY_TYPE_LABELS[a.assembly_type]}</td>
                  <td>{formatDateTime(a.scheduled_at)}</td>
                  <td>{a.location ?? "—"}</td>
                  <td><Badge variant={ASSEMBLY_STATUS[a.status].variant}>{ASSEMBLY_STATUS[a.status].label}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <CreateAssemblyDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={(id) => navigate(`/dashboard/assembly/${id}`)} />
    </div>
  );
}
