import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { insforge } from "@/lib/insforgeClient";
import { assertOk, errorMessage } from "@/lib/rpc";
import { useOrgId } from "@/hooks/useOrganization";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { AgentRule } from "@/types/domain";

export function AgentRulesCard() {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [instruction, setInstruction] = useState("");

  const { data: rules = [] } = useQuery({
    queryKey: ["agent-rules", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await insforge.database.from("agent_rules").select("*").eq("organization_id", orgId).order("priority");
      if (error) throw error;
      return data as AgentRule[];
    }
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["agent-rules", orgId] });

  async function add() {
    if (!name.trim() || !instruction.trim()) return;
    try {
      assertOk(await insforge.database.from("agent_rules").insert([{ organization_id: orgId, name: name.trim(), instruction: instruction.trim(), priority: rules.length * 10 }]).select("id"));
      setName(""); setInstruction("");
      await refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function toggle(rule: AgentRule) {
    await insforge.database.from("agent_rules").update({ enabled: !rule.enabled }).eq("id", rule.id);
    await refresh();
  }

  async function remove(id: string) {
    await insforge.database.from("agent_rules").delete().eq("id", id);
    await refresh();
  }

  return (
    <Card>
      <CardHeader><CardTitle>Reglas adicionales de la copropiedad</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Se agregan después de las reglas críticas del sistema (confirmación explícita, no inventar datos, etc.), que siempre están activas y no se pueden desactivar desde aquí.
        </p>
        {rules.map((rule) => (
          <div key={rule.id} className="flex items-start justify-between gap-3 rounded-md border border-border p-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">{rule.name}</p>
              <p className="text-xs text-muted-foreground">{rule.instruction}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Switch checked={rule.enabled} onCheckedChange={() => toggle(rule)} aria-label={`${rule.enabled ? "Desactivar" : "Activar"} ${rule.name}`} />
              <Button variant="ghost" size="icon" onClick={() => remove(rule.id)} aria-label={`Eliminar ${rule.name}`}>
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          </div>
        ))}
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input placeholder="Nombre de la regla" value={name} onChange={(e) => setName(e.target.value)} />
          <Input placeholder="Instrucción" value={instruction} onChange={(e) => setInstruction(e.target.value)} />
          <Button onClick={add}><Plus className="h-4 w-4" aria-hidden /></Button>
        </div>
      </CardContent>
    </Card>
  );
}
