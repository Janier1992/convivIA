import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { insforge } from "@/lib/insforgeClient";
import { assertOk, errorMessage } from "@/lib/rpc";
import { useOrgId } from "@/hooks/useOrganization";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/PageHeader";
import { QueryErrorState } from "@/components/QueryErrorState";
import type { AgentConfig } from "@/types/domain";
import { AgentRulesCard } from "./AgentRulesCard";
import { AssistantPreviewChat } from "./AssistantPreviewChat";

const CAPABILITY_FIELDS: { key: keyof AgentConfig; label: string; hint: string }[] = [
  { key: "finance_enabled", label: "Consultar estado de cuenta", hint: "Saldo, cartera y próximos vencimientos." },
  { key: "payment_reports_enabled", label: "Reportar pagos", hint: "El residente envía el soporte y queda pendiente de revisión." },
  { key: "pqrs_enabled", label: "Radicar y consultar PQRS", hint: "" },
  { key: "reservations_enabled", label: "Reservar zonas comunes", hint: "" },
  { key: "documents_enabled", label: "Buscar en documentos", hint: "Reglamento, manual de convivencia, actas..." },
  { key: "handoff_enabled", label: "Transferir a una persona", hint: "El residente puede pedir hablar con el equipo." }
];

export function AssistantPage() {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<AgentConfig | null>(null);
  const [saving, setSaving] = useState(false);

  const { data: config, isError, refetch } = useQuery({
    queryKey: ["agent-config", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await insforge.database.from("agents").select("*").eq("organization_id", orgId).single();
      if (error) throw error;
      return data as AgentConfig;
    }
  });

  useEffect(() => setDraft(config ?? null), [config]);

  async function save() {
    if (!draft) return;
    setSaving(true);
    try {
      assertOk(
        await insforge.database
          .from("agents")
          .update({
            name: draft.name,
            tone: draft.tone,
            system_instructions: draft.system_instructions,
            enabled: draft.enabled,
            finance_enabled: draft.finance_enabled,
            payment_reports_enabled: draft.payment_reports_enabled,
            pqrs_enabled: draft.pqrs_enabled,
            reservations_enabled: draft.reservations_enabled,
            documents_enabled: draft.documents_enabled,
            handoff_enabled: draft.handoff_enabled
          })
          .eq("id", draft.id)
          .select("id")
      );
      toast.success("Configuración guardada.");
      await queryClient.invalidateQueries({ queryKey: ["agent-config", orgId] });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  if (isError) return <QueryErrorState onRetry={() => refetch()} message="No se pudo cargar la configuración del asistente." />;
  if (!draft) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Asistente IA" description="Responde por Telegram y WhatsApp usando solo datos reales de tu copropiedad; nunca inventa saldos ni disponibilidad." />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader><CardTitle>Configuración general</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between rounded-md border border-border p-3">
                <div>
                  <Label>Asistente activo</Label>
                  <p className="text-xs text-muted-foreground">Si lo desactivas, los canales dejan de responder automáticamente.</p>
                </div>
                <Switch checked={draft.enabled} onCheckedChange={(v) => setDraft({ ...draft, enabled: v })} />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="agent-name">Nombre del asistente</Label>
                  <Input id="agent-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Tono</Label>
                  <Select value={draft.tone} onValueChange={(v) => setDraft({ ...draft, tone: v as AgentConfig["tone"] })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="friendly">Amable (tuteo)</SelectItem>
                      <SelectItem value="formal">Formal (trato de usted)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="agent-instructions">Instrucciones personalizadas</Label>
                <Textarea
                  id="agent-instructions"
                  rows={4}
                  value={draft.system_instructions ?? ""}
                  onChange={(e) => setDraft({ ...draft, system_instructions: e.target.value })}
                  placeholder="Ej. Siempre recuerda que el parqueadero de visitantes cierra a las 10pm."
                />
                <p className="text-xs text-muted-foreground">Se agregan después de las reglas críticas del sistema; no pueden contradecirlas.</p>
              </div>
              <div className="space-y-3">
                <Label>Capacidades habilitadas</Label>
                {CAPABILITY_FIELDS.map((field) => (
                  <div key={field.key} className="flex items-center justify-between">
                    <div>
                      <p className="text-sm">{field.label}</p>
                      {field.hint && <p className="text-xs text-muted-foreground">{field.hint}</p>}
                    </div>
                    <Switch checked={Boolean(draft[field.key])} onCheckedChange={(v) => setDraft({ ...draft, [field.key]: v })} />
                  </div>
                ))}
              </div>
              <Button onClick={save} disabled={saving}>{saving ? "Guardando..." : "Guardar cambios"}</Button>
            </CardContent>
          </Card>

          <AgentRulesCard />
        </div>

        <div>
          <Card>
            <CardHeader><CardTitle>Vista previa</CardTitle></CardHeader>
            <CardContent>
              <AssistantPreviewChat />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
