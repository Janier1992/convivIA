import { useState } from "react";
import { toast } from "sonner";
import { Wrench } from "lucide-react";
import { functionsClient } from "@/lib/functionsClient";
import { useOrgId } from "@/hooks/useOrganization";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataSource } from "@/components/DataSource";

interface Brief {
  text: string;
  as_of: string;
  facts: {
    cronogramas_vencidos: unknown[];
    cronogramas_proximos: unknown[];
    ordenes_esperando_aprobacion: unknown[];
    ordenes_esperando_validacion: unknown[];
    ordenes_urgentes_abiertas: unknown[];
  };
}

/** "Mantenimientos pendientes/vencidos" (sección 10 del prompt maestro), sobre datos de P2 (mantenimiento). */
export function MaintenancePriorityBriefCard() {
  const orgId = useOrgId();
  const [brief, setBrief] = useState<Brief | null>(null);
  const [loading, setLoading] = useState(false);

  async function generate() {
    setLoading(true);
    try {
      setBrief(await functionsClient.post<Brief>("ai-assist", { action: "maintenance_priority_brief", organization_id: orgId }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "El asistente de IA no está disponible.");
    } finally {
      setLoading(false);
    }
  }

  const total = brief
    ? Object.values(brief.facts).reduce((sum, arr) => sum + arr.length, 0)
    : 0;

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2">
            <Wrench className="h-4 w-4 text-accent" aria-hidden /> Mantenimiento a priorizar
          </CardTitle>
          <CardDescription>Cronogramas vencidos y órdenes esperando una decisión.</CardDescription>
        </div>
        <Button size="sm" variant={brief ? "outline" : "accent"} onClick={generate} disabled={loading}>
          {loading ? "Generando..." : brief ? "Actualizar" : "Generar"}
        </Button>
      </CardHeader>
      {brief && (
        <CardContent className="space-y-3">
          <p className="whitespace-pre-line text-sm leading-relaxed">{brief.text}</p>
          <div className="space-y-1 border-t border-border pt-3">
            <DataSource source="Mantenimiento de ConvivIA" asOf={brief.as_of} />
            {total > 0 && (
              <p className="text-xs text-muted-foreground">
                {brief.facts.cronogramas_vencidos.length} cronogramas vencidos · {brief.facts.ordenes_urgentes_abiertas.length} órdenes urgentes ·{" "}
                {brief.facts.ordenes_esperando_aprobacion.length + brief.facts.ordenes_esperando_validacion.length} esperando una decisión.
              </p>
            )}
          </div>
        </CardContent>
      )}
    </Card>
  );
}
