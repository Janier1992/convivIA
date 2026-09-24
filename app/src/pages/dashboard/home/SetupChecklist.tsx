import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { CheckCircle2, Circle } from "lucide-react";
import { insforge } from "@/lib/insforgeClient";
import { useOrgId } from "@/hooks/useOrganization";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface Step {
  key: string;
  label: string;
  hint: string;
  to: string;
  done: boolean;
}

/**
 * Guía de arranque para una copropiedad nueva: se oculta sola cuando todo
 * está listo. Cada paso elimina trabajo manual concreto.
 */
export function SetupChecklist() {
  const orgId = useOrgId();
  const { data: steps } = useQuery({
    queryKey: ["setup-checklist", orgId],
    queryFn: async (): Promise<Step[]> => {
      const [units, fee, channels, documents, areas] = await Promise.all([
        insforge.database.from("units").select("id", { count: "exact", head: true }).eq("organization_id", orgId),
        insforge.database.from("charge_concepts").select("amount").eq("organization_id", orgId).eq("kind", "ordinary").gt("amount", 0).limit(1),
        insforge.database.rpc("get_channel_status", { p_organization_id: orgId }),
        insforge.database.from("documents").select("id", { count: "exact", head: true }).eq("organization_id", orgId),
        insforge.database.from("common_areas").select("id", { count: "exact", head: true }).eq("organization_id", orgId)
      ]);
      const connected = ((channels.data ?? []) as { status: string }[]).some((c) => c.status === "connected");
      return [
        { key: "units", label: "Registrar unidades y residentes", hint: "Importa tu censo desde Excel en minutos.", to: "/dashboard/units", done: (units.count ?? 0) > 0 },
        { key: "fee", label: "Configurar la cuota de administración", hint: "Valor fijo o por coeficiente.", to: "/dashboard/billing", done: (fee.data ?? []).length > 0 },
        { key: "channels", label: "Conectar Telegram o WhatsApp", hint: "Para que el asistente atienda a los residentes.", to: "/dashboard/integrations", done: connected },
        { key: "documents", label: "Subir el reglamento", hint: "El asistente responde dudas citando el documento.", to: "/dashboard/documents", done: (documents.count ?? 0) > 0 },
        { key: "areas", label: "Configurar zonas comunes", hint: "Horarios, tarifas y reglas de reserva.", to: "/dashboard/common-areas", done: (areas.count ?? 0) > 0 }
      ];
    }
  });

  if (!steps || steps.every((s) => s.done)) return null;
  const done = steps.filter((s) => s.done).length;

  return (
    <Card className="border-primary/30">
      <CardHeader>
        <CardTitle>Pon en marcha tu copropiedad</CardTitle>
        <CardDescription>
          {done} de {steps.length} pasos listos
        </CardDescription>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
          <div className="brand-gradient h-full rounded-full transition-all" style={{ width: `${(done / steps.length) * 100}%` }} />
        </div>
      </CardHeader>
      <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {steps.map((step) => (
          <Link
            key={step.key}
            to={step.to}
            className="flex items-start gap-3 rounded-md border border-border p-3 transition-colors hover:bg-muted/60"
          >
            {step.done ? (
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-label="Listo" />
            ) : (
              <Circle className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-label="Pendiente" />
            )}
            <span>
              <span className={step.done ? "text-sm font-medium text-muted-foreground line-through" : "text-sm font-medium"}>{step.label}</span>
              <span className="block text-xs text-muted-foreground">{step.hint}</span>
            </span>
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}
