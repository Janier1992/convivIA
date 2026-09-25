import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Gavel } from "lucide-react";
import { functionsClient } from "@/lib/functionsClient";
import { formatDate } from "@/lib/format";
import { useOrgId } from "@/hooks/useOrganization";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface Summary {
  found: boolean;
  text: string;
  assembly?: { id: string; title: string; scheduled_at: string };
  document?: { title: string };
  requires_review?: boolean;
}

/** "Resumen de la última acta" (sección 10 del prompt maestro), sobre el texto ya extraído del acta (P1). */
export function AssemblyMinutesSummaryCard() {
  const orgId = useOrgId();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);

  async function generate() {
    setLoading(true);
    try {
      setSummary(await functionsClient.post<Summary>("ai-assist", { action: "assembly_minutes_summary", organization_id: orgId }));
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
            <Gavel className="h-4 w-4 text-accent" aria-hidden /> Resumen de la última acta
          </CardTitle>
          <CardDescription>Temas y decisiones de la asamblea más reciente con acta cargada.</CardDescription>
        </div>
        <Button size="sm" variant={summary ? "outline" : "accent"} onClick={generate} disabled={loading}>
          {loading ? "Generando..." : summary ? "Actualizar" : "Generar"}
        </Button>
      </CardHeader>
      {summary && (
        <CardContent className="space-y-3">
          {summary.found ? (
            <>
              <p className="whitespace-pre-line text-sm leading-relaxed">{summary.text}</p>
              <div className="space-y-1 border-t border-border pt-3">
                <p className="text-xs text-muted-foreground">
                  {summary.assembly?.title}
                  {summary.assembly?.scheduled_at ? ` · ${formatDate(summary.assembly.scheduled_at)}` : ""}
                  {summary.assembly && (
                    <>
                      {" · "}
                      <Link to={`/dashboard/assembly/${summary.assembly.id}`} className="text-primary hover:underline">
                        Ver acta completa
                      </Link>
                    </>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  Resumen generado por IA para orientación rápida: confirma cualquier decisión contra el acta original antes de comunicarla.
                </p>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{summary.text}</p>
          )}
        </CardContent>
      )}
    </Card>
  );
}
