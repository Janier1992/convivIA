import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { insforge } from "@/lib/insforgeClient";
import { assertOk, errorMessage } from "@/lib/rpc";
import { useOrgId } from "@/hooks/useOrganization";
import { usePqrsCategories } from "@/hooks/useCatalogs";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

export function PqrsCategoriesCard({ readOnly }: { readOnly: boolean }) {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const { data: categories = [] } = usePqrsCategories();
  const [name, setName] = useState("");
  const [slaHours, setSlaHours] = useState("72");

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["pqrs-categories", orgId] });

  async function add() {
    if (!name.trim()) return;
    try {
      assertOk(await insforge.database.from("pqrs_categories").insert([{ organization_id: orgId, name: name.trim(), sla_hours: Number(slaHours) || 72, sort_order: categories.length * 10 }]).select("id"));
      setName(""); setSlaHours("72");
      await refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function updateSla(id: string, hours: string) {
    await insforge.database.from("pqrs_categories").update({ sla_hours: Number(hours) || 1 }).eq("id", id);
    await refresh();
  }

  async function toggle(id: string, active: boolean) {
    await insforge.database.from("pqrs_categories").update({ is_active: !active }).eq("id", id);
    await refresh();
  }

  async function remove(id: string) {
    try {
      await insforge.database.from("pqrs_categories").delete().eq("id", id);
      await refresh();
    } catch {
      toast.error("No se puede eliminar una categoría con PQRS asociadas. Desactívala en su lugar.");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Categorías de PQRS</CardTitle>
        <CardDescription>El tiempo de respuesta (SLA) se calcula desde la radicación con esta categoría.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {categories.map((c) => (
          <div key={c.id} className="flex items-center justify-between gap-3 rounded-md border border-border p-2.5">
            <span className="text-sm font-medium">{c.name}</span>
            <div className="flex items-center gap-2">
              <Input type="number" className="h-8 w-20" disabled={readOnly} value={c.sla_hours} onChange={(e) => updateSla(c.id, e.target.value)} />
              <span className="text-xs text-muted-foreground">horas</span>
              {!readOnly && (
                <>
                  <Switch checked={c.is_active} onCheckedChange={() => toggle(c.id, c.is_active)} aria-label={`${c.is_active ? "Desactivar" : "Activar"} ${c.name}`} />
                  <Button variant="ghost" size="icon" onClick={() => remove(c.id)} aria-label={`Eliminar ${c.name}`}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                </>
              )}
            </div>
          </div>
        ))}
        {!readOnly && (
          <div className="flex gap-2 border-t border-border pt-3">
            <Input placeholder="Nombre de la categoría" value={name} onChange={(e) => setName(e.target.value)} className="flex-1" />
            <Input type="number" placeholder="SLA (h)" value={slaHours} onChange={(e) => setSlaHours(e.target.value)} className="w-28" />
            <Button onClick={add}><Plus className="h-4 w-4" aria-hidden /></Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
