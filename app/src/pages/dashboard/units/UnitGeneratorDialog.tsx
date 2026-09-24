import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { insforge } from "@/lib/insforgeClient";
import { assertOk, errorMessage } from "@/lib/rpc";
import { generateUnits, MAX_GENERATED_UNITS } from "@/lib/unitGenerator";
import { UNIT_TYPE_LABELS } from "@/lib/labels";
import { useOrgId } from "@/hooks/useOrganization";
import { useTowers, useUnits } from "@/hooks/useCatalogs";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { UnitType } from "@/types/domain";

/** Crea en un paso todas las unidades de una torre (piso x apartamentos por piso). */
export function UnitGeneratorDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const { data: towers = [] } = useTowers();
  const { data: existingUnits = [] } = useUnits();
  const [towerName, setTowerName] = useState("Torre 1");
  const [prefix, setPrefix] = useState("T1");
  const [floorFrom, setFloorFrom] = useState("1");
  const [floorTo, setFloorTo] = useState("10");
  const [perFloor, setPerFloor] = useState("4");
  const [unitType, setUnitType] = useState<UnitType>("apartment");
  const [saving, setSaving] = useState(false);

  const generated = useMemo(
    () =>
      generateUnits({ prefix, floorFrom: Number(floorFrom), floorTo: Number(floorTo), unitsPerFloor: Number(perFloor), unitType }),
    [prefix, floorFrom, floorTo, perFloor, unitType]
  );
  const existingCodes = useMemo(() => new Set(existingUnits.map((u) => u.code)), [existingUnits]);
  const fresh = generated.filter((u) => !existingCodes.has(u.code));

  async function ensureTower(): Promise<string | null> {
    const name = towerName.trim();
    if (!name) return null;
    const found = towers.find((t) => t.name.toLowerCase() === name.toLowerCase());
    if (found) return found.id;
    const rows = assertOk(await insforge.database.from("towers").insert([{ organization_id: orgId, name, sort_order: towers.length }]).select("id"));
    return (rows as { id: string }[])[0].id;
  }

  async function create() {
    if (fresh.length === 0) return;
    setSaving(true);
    try {
      const towerId = await ensureTower();
      assertOk(
        await insforge.database
          .from("units")
          .insert(fresh.map((u) => ({ ...u, organization_id: orgId, tower_id: towerId, coefficient_pct: 0 })))
          .select("id")
      );
      toast.success(`${fresh.length} unidades creadas. Completa los coeficientes o impórtalos desde Excel.`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["units", orgId] }),
        queryClient.invalidateQueries({ queryKey: ["towers", orgId] })
      ]);
      onOpenChange(false);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Generar unidades por pisos</DialogTitle>
          <DialogDescription>Crea todas las unidades de una torre sin digitarlas una por una (piso 5, apto 2 → 502).</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="gen-tower">Torre / bloque</Label>
            <Input id="gen-tower" value={towerName} onChange={(e) => setTowerName(e.target.value)} placeholder="Torre 1 (vacío si no aplica)" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="gen-prefix">Prefijo del código</Label>
            <Input id="gen-prefix" value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="T1" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="gen-from">Desde el piso</Label>
            <Input id="gen-from" type="number" value={floorFrom} onChange={(e) => setFloorFrom(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="gen-to">Hasta el piso</Label>
            <Input id="gen-to" type="number" value={floorTo} onChange={(e) => setFloorTo(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="gen-per">Unidades por piso</Label>
            <Input id="gen-per" type="number" value={perFloor} onChange={(e) => setPerFloor(e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-3">
            <Label>Tipo de unidad</Label>
            <Select value={unitType} onValueChange={(v) => setUnitType(v as UnitType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(UNIT_TYPE_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="mt-4 rounded-md bg-muted/60 p-3 text-sm">
          {generated.length === 0 ? (
            <p className="text-destructive">Revisa los pisos y unidades por piso (máximo {MAX_GENERATED_UNITS} unidades).</p>
          ) : (
            <>
              <p className="font-medium">
                {fresh.length} unidades nuevas{generated.length > fresh.length ? ` (${generated.length - fresh.length} ya existen y se omiten)` : ""}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {generated.slice(0, 8).map((u) => u.code).join(", ")}{generated.length > 8 ? "…" : ""}
              </p>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={create} disabled={saving || fresh.length === 0}>
            {saving ? "Creando..." : `Crear ${fresh.length} unidades`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
