import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { insforge } from "@/lib/insforgeClient";
import { assertOk, errorMessage } from "@/lib/rpc";
import { useOrgId } from "@/hooks/useOrganization";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { ChargeConcept } from "@/types/domain";

const KIND_LABELS: Record<ChargeConcept["kind"], string> = {
  ordinary: "Ordinaria", extraordinary: "Extraordinaria", fine: "Multa", interest: "Interés (sistema)",
  common_area: "Zona común (sistema)", opening_balance: "Saldo inicial (sistema)", other: "Otro"
};

export function ChargeConceptsCard({ readOnly }: { readOnly: boolean }) {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [calculation, setCalculation] = useState<ChargeConcept["calculation"]>("manual");
  const [amount, setAmount] = useState("0");

  const { data: concepts = [] } = useQuery({
    queryKey: ["charge-concepts-settings", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await insforge.database.from("charge_concepts").select("*").eq("organization_id", orgId).order("is_system").order("name");
      if (error) throw error;
      return data as ChargeConcept[];
    }
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["charge-concepts-settings", orgId] });

  async function add() {
    if (!name.trim()) return;
    try {
      assertOk(await insforge.database.from("charge_concepts").insert([{ organization_id: orgId, name: name.trim(), kind: "extraordinary", calculation, amount: Number(amount) || 0 }]).select("id"));
      setName(""); setAmount("0");
      await refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function updateAmount(concept: ChargeConcept, value: string) {
    try {
      assertOk(await insforge.database.from("charge_concepts").update({ amount: Number(value) || 0 }).eq("id", concept.id).select("id"));
      await refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function toggle(concept: ChargeConcept) {
    await insforge.database.from("charge_concepts").update({ is_active: !concept.is_active }).eq("id", concept.id);
    await refresh();
  }

  async function remove(id: string) {
    try {
      await insforge.database.from("charge_concepts").delete().eq("id", id);
      await refresh();
    } catch {
      toast.error("No se puede eliminar un concepto con cargos asociados. Desactívalo en su lugar.");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Conceptos de cobro</CardTitle>
        <CardDescription>La cuota de administración es de tipo "por coeficiente"; el resto puede ser fijo o manual.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {concepts.map((c) => (
          <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-2.5">
            <div>
              <p className="text-sm font-medium">{c.name}</p>
              <p className="text-xs text-muted-foreground">{KIND_LABELS[c.kind]} · {c.calculation === "coefficient" ? "por coeficiente" : c.calculation === "fixed" ? "valor fijo" : "manual"}</p>
            </div>
            <div className="flex items-center gap-2">
              {c.calculation !== "manual" ? (
                <Input type="number" className="h-8 w-32" disabled={readOnly} value={c.amount} onChange={(e) => updateAmount(c, e.target.value)} />
              ) : (
                <span className="text-sm text-muted-foreground">Se define al cargar cada vez</span>
              )}
              {!readOnly && !c.is_system && (
                <>
                  <Switch checked={c.is_active} onCheckedChange={() => toggle(c)} aria-label={`${c.is_active ? "Desactivar" : "Activar"} ${c.name}`} />
                  <Button variant="ghost" size="icon" onClick={() => remove(c.id)} aria-label={`Eliminar ${c.name}`}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                </>
              )}
              {c.is_system && <Badge variant="muted">Del sistema</Badge>}
            </div>
          </div>
        ))}
        {!readOnly && (
          <div className="flex flex-col gap-2 border-t border-border pt-3 sm:flex-row">
            <Input placeholder="Nombre del concepto" value={name} onChange={(e) => setName(e.target.value)} className="flex-1" />
            <Select value={calculation} onValueChange={(v) => setCalculation(v as ChargeConcept["calculation"])}>
              <SelectTrigger className="sm:w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="manual">Manual (por cargo)</SelectItem>
                <SelectItem value="fixed">Valor fijo</SelectItem>
                <SelectItem value="coefficient">Por coeficiente</SelectItem>
              </SelectContent>
            </Select>
            {calculation !== "manual" && <Input type="number" placeholder="Valor" value={amount} onChange={(e) => setAmount(e.target.value)} className="sm:w-32" />}
            <Button onClick={add}><Plus className="h-4 w-4" aria-hidden /></Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
