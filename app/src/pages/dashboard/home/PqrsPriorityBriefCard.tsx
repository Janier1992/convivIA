import { useState } from "react";
import { toast } from "sonner";
import { ListChecks } from "lucide-react";
import { functionsClient } from "@/lib/functionsClient";
import { useOrgId } from "@/hooks/useOrganization";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataSource } from "@/components/DataSource";

interface Brief {
  text: string;
  as_of: string;
  groups: { vencidas: unknown[]; vencen_hoy: unknown[]; vencen_pronto: unknown[]; resto_count: number };
}

/** "Clasifica las PQRS abiertas y detecta las que están cerca del vencimiento" (sección 10 del prompt maestro). */
export function PqrsPriorityBriefCard() {
  const orgId = useOrgId();
  const [brief, setBrief] = useState<Brief | null>(null);
  const [loading, setLoading] = useState(false);

  async function generate() {
    setLoading(true);
    try {
      setBrief(await functionsClient.post<Brief>("ai-assist", { action: "pqrs_priority_brief", organization_id: orgId }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "El asistente de IA no está disponible.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2">
            <ListChecks className="h-4 w-4 text-accent" aria-hidden /> PQRS a priorizar
          </CardTitle>
          <CardDescription>Vencidas y por vencer en las próximas 48 horas.</CardDescription>
        </div>
        <Button size="sm" variant={brief ? "outline" : "accent"} onClick={generate} disabled={loading}>
          {loading ? "Generando..." : brief ? "Actualizar" : "Generar"}
        </Button>
      </CardHeader>
      {brief && (
        <CardContent className="space-y-3">
          <p className="whitespace-pre-line text-sm leading-relaxed">{brief.text}</p>
          <div className="space-y-1 border-t border-border pt-3">
            <DataSource source="PQRS de ConvivIA" asOf={brief.as_of} />
            <p className="text-xs text-muted-foreground">
              {brief.groups.vencidas.length} vencidas · {brief.groups.vencen_hoy.length} vencen hoy ·{" "}
              {brief.groups.vencen_pronto.length} vencen en 48 h · {brief.groups.resto_count} sin apuro todavía.
            </p>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
