import { useState } from "react";
import { toast } from "sonner";
import { TrendingUp } from "lucide-react";
import { functionsClient } from "@/lib/functionsClient";
import { useOrgId } from "@/hooks/useOrganization";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataSource } from "@/components/DataSource";

interface PortfolioFacts {
  desde: string;
  as_of: string;
  recaudado_7d: number;
  facturado_7d: number;
  cartera_vencida_total: number;
  unidades_en_mora_total: number;
  unidades_nuevas_en_mora: { unidad: string }[];
  unidades_recuperadas: { unidad: string }[];
}

interface Brief {
  text: string;
  as_of: string;
  facts: PortfolioFacts;
}

/** "¿Qué cambió en la cartera esta semana?" (sección 10 del prompt maestro), redactado por IA sobre cifras deterministas. */
export function WeeklyPortfolioBriefCard() {
  const orgId = useOrgId();
  const [brief, setBrief] = useState<Brief | null>(null);
  const [loading, setLoading] = useState(false);

  async function generate() {
    setLoading(true);
    try {
      setBrief(await functionsClient.post<Brief>("ai-assist", { action: "portfolio_weekly_brief", organization_id: orgId }));
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
            <TrendingUp className="h-4 w-4 text-accent" aria-hidden /> Cartera de la semana
          </CardTitle>
          <CardDescription>Qué cambió en los últimos 7 días.</CardDescription>
        </div>
        <Button size="sm" variant={brief ? "outline" : "accent"} onClick={generate} disabled={loading}>
          {loading ? "Generando..." : brief ? "Actualizar" : "Generar"}
        </Button>
      </CardHeader>
      {brief && (
        <CardContent className="space-y-3">
          <p className="whitespace-pre-line text-sm leading-relaxed">{brief.text}</p>
          <div className="space-y-1 border-t border-border pt-3">
            <DataSource source="cartera de ConvivIA (últimos 7 días)" asOf={brief.as_of} />
            <p className="text-xs text-muted-foreground">
              Redactado por IA a partir de cifras reales; las prioridades son recomendaciones, no datos oficiales.
            </p>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
