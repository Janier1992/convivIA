import { useState } from "react";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import { functionsClient } from "@/lib/functionsClient";
import { useOrgId } from "@/hooks/useOrganization";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataSource } from "@/components/DataSource";

interface Brief {
  text: string;
  as_of: string;
}

/** Resumen del día redactado por IA a partir de las cifras del tablero (nunca inventa cifras). */
export function DailyBriefCard() {
  const orgId = useOrgId();
  const [brief, setBrief] = useState<Brief | null>(null);
  const [loading, setLoading] = useState(false);

  async function generate() {
    setLoading(true);
    try {
      setBrief(await functionsClient.post<Brief>("ai-assist", { action: "daily_brief", organization_id: orgId }));
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
            <Sparkles className="h-4 w-4 text-accent" aria-hidden /> Resumen del día
          </CardTitle>
          <CardDescription>Qué requiere atención hoy, a partir de las cifras del tablero.</CardDescription>
        </div>
        <Button size="sm" variant={brief ? "outline" : "accent"} onClick={generate} disabled={loading}>
          {loading ? "Generando..." : brief ? "Actualizar" : "Generar"}
        </Button>
      </CardHeader>
      {brief && (
        <CardContent className="space-y-3">
          <p className="whitespace-pre-line text-sm leading-relaxed">{brief.text}</p>
          <div className="space-y-1 border-t border-border pt-3">
            <DataSource source="tablero de ConvivIA" asOf={brief.as_of} />
            <p className="text-xs text-muted-foreground">
              Redactado por IA: las prioridades son recomendaciones, no datos oficiales. Verifica antes de actuar.
            </p>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
