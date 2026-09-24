import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { insforge } from "@/lib/insforgeClient";
import { assertOk, errorMessage } from "@/lib/rpc";
import { todayIn } from "@/lib/format";
import { RELATION_LABELS } from "@/lib/labels";
import { useOrgId } from "@/hooks/useOrganization";
import { useUnits } from "@/hooks/useCatalogs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { UnitPerson, UnitRelation } from "@/types/domain";

/** Relaciones activas de una persona con unidades: agregar o finalizar (se conserva el historial). */
export function PersonRelations({ personId, canWrite }: { personId: string; canWrite: boolean }) {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const { data: units = [] } = useUnits();
  const [unitId, setUnitId] = useState("");
  const [relation, setRelation] = useState<UnitRelation>("owner");

  const { data: relations = [] } = useQuery({
    queryKey: ["person-relations", personId],
    queryFn: async () => {
      const { data, error } = await insforge.database
        .from("unit_persons")
        .select("id, unit_id, person_id, relation, is_primary_contact, starts_on, ends_on, units(id, code)")
        .eq("person_id", personId)
        .is("ends_on", null);
      if (error) throw error;
      return data as unknown as UnitPerson[];
    }
  });

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["person-relations", personId] }),
      queryClient.invalidateQueries({ queryKey: ["residents", orgId] })
    ]);

  async function add() {
    if (!unitId) return;
    try {
      assertOk(
        await insforge.database
          .from("unit_persons")
          .insert([{ organization_id: orgId, unit_id: unitId, person_id: personId, relation, starts_on: todayIn() }])
          .select("id")
      );
      setUnitId("");
      await refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function end(id: string) {
    try {
      assertOk(await insforge.database.from("unit_persons").update({ ends_on: todayIn() }).eq("id", id).select("id"));
      toast.success("Relación finalizada. Queda en el historial de la unidad.");
      await refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm font-semibold">Unidades</p>
      {relations.length === 0 && <p className="text-sm text-muted-foreground">Sin unidades asociadas.</p>}
      {relations.map((rel) => (
        <div key={rel.id} className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
          <div className="flex items-center gap-2">
            <span className="font-medium">{rel.units?.code}</span>
            <Badge variant={rel.relation === "owner" ? "default" : "accent"}>{RELATION_LABELS[rel.relation]}</Badge>
          </div>
          {canWrite && (
            <Button variant="ghost" size="sm" onClick={() => end(rel.id)}>
              Finalizar
            </Button>
          )}
        </div>
      ))}
      {canWrite && (
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <div className="space-y-1.5">
            <Label>Unidad</Label>
            <Select value={unitId} onValueChange={setUnitId}>
              <SelectTrigger><SelectValue placeholder="Selecciona" /></SelectTrigger>
              <SelectContent>
                {units.filter((u) => u.is_active).map((u) => <SelectItem key={u.id} value={u.id}>{u.code}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Relación</Label>
            <Select value={relation} onValueChange={(v) => setRelation(v as UnitRelation)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(RELATION_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button variant="outline" onClick={add} disabled={!unitId}>Asociar</Button>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Propietarios y arrendatarios pueden consultar la cartera de la unidad con el asistente; residentes y autorizados no.
      </p>
    </div>
  );
}
