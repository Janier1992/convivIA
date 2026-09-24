import { useState } from "react";
import { Plus, Trees } from "lucide-react";
import { formatMoney } from "@/lib/format";
import { useOrganization } from "@/hooks/useOrganization";
import { useCommonAreas } from "@/hooks/useCatalogs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { QueryErrorState } from "@/components/QueryErrorState";
import type { CommonArea } from "@/types/domain";
import { AreaFormDialog } from "./AreaFormDialog";

export function CommonAreasPage() {
  const { can } = useOrganization();
  const canWrite = can("reservations.write");
  const { data: areas = [], isLoading, isError, refetch } = useCommonAreas();
  const [selected, setSelected] = useState<CommonArea | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Zonas comunes"
        description="Horarios, aforo, tarifas y reglas de reserva de cada zona común."
        actions={canWrite && <Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" aria-hidden /> Nueva zona</Button>}
      />

      {isError ? (
        <QueryErrorState onRetry={() => refetch()} message="No se pudieron cargar las zonas comunes." />
      ) : isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : areas.length === 0 ? (
        <EmptyState icon={Trees} title="Aún no hay zonas comunes" description="Configura el salón social, la piscina, el gimnasio o cualquier espacio reservable." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {areas.map((area) => (
            <Card key={area.id} className="cursor-pointer transition-shadow hover:card-elevated" onClick={() => setSelected(area)}>
              <CardHeader className="flex-row items-start justify-between space-y-0">
                <CardTitle className="text-base">{area.name}</CardTitle>
                {!area.is_active && <Badge variant="muted">Inactiva</Badge>}
              </CardHeader>
              <CardContent className="space-y-1.5 text-sm text-muted-foreground">
                <p>{area.booking_mode === "exclusive" ? "Uso exclusivo" : `Compartida · aforo ${area.capacity}`}</p>
                <p>{Number(area.fee_amount) > 0 ? `Tarifa ${formatMoney(area.fee_amount)}` : "Sin costo"}</p>
                {area.requires_approval && <Badge variant="warning">Requiere aprobación</Badge>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <AreaFormDialog open={creating} onOpenChange={setCreating} area={null} canWrite={canWrite} />
      <AreaFormDialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)} area={selected} canWrite={canWrite} />
    </div>
  );
}
