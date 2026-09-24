import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Building2 } from "lucide-react";
import { insforge } from "@/lib/insforgeClient";
import { PROPERTY_TYPE_LABELS } from "@/lib/labels";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { QueryErrorState } from "@/components/QueryErrorState";
import type { Organization } from "@/types/domain";

export function SupportOrganizationsPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");

  const { data: orgs = [], isLoading, isError, refetch } = useQuery({
    queryKey: ["support-organizations"],
    queryFn: async () => {
      const { data, error } = await insforge.database.from("organizations").select("*").order("created_at", { ascending: false }).limit(500);
      if (error) throw error;
      return data as Organization[];
    }
  });

  const filtered = orgs.filter((o) => o.name.toLowerCase().includes(search.trim().toLowerCase()));

  return (
    <div className="space-y-6">
      <PageHeader title="Copropiedades" description="Panel de soporte de ConvivIA: acceso solo a metadatos operativos, nunca al censo ni a mensajes." />
      <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nombre" className="max-w-sm" />

      {isError ? (
        <QueryErrorState onRetry={() => refetch()} message="No se pudieron cargar las copropiedades." />
      ) : isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : filtered.length === 0 ? (
        <EmptyState icon={Building2} title="Sin copropiedades" />
      ) : (
        <Card className="overflow-x-auto">
          <table className="table-base">
            <thead><tr><th>Nombre</th><th>Tipo</th><th>Estado</th><th /></tr></thead>
            <tbody>
              {filtered.map((o) => (
                <tr key={o.id} className="cursor-pointer" onClick={() => navigate(`/soporte/copropiedades/${o.id}`)}>
                  <td className="font-medium">{o.name}</td>
                  <td>{PROPERTY_TYPE_LABELS[o.property_type] ?? o.property_type}</td>
                  <td>
                    {o.status === "active" ? <Badge variant="success">Activa</Badge> : o.status === "suspended" ? <Badge variant="warning">Suspendida</Badge> : <Badge variant="destructive">Cancelada</Badge>}
                  </td>
                  <td className="text-right text-xs text-muted-foreground">Ver →</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
