import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { insforge } from "@/lib/insforgeClient";
import { assertOk, errorMessage } from "@/lib/rpc";
import { UNIT_TYPE_LABELS } from "@/lib/labels";
import { useOrgId } from "@/hooks/useOrganization";
import { useTowers } from "@/hooks/useCatalogs";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { Unit, UnitType } from "@/types/domain";

const NO_TOWER = "__none__";

interface FormState {
  code: string;
  tower_id: string;
  unit_type: UnitType;
  floor: string;
  area_m2: string;
  coefficient_pct: string;
  is_active: boolean;
  notes: string;
}

function toForm(unit: Unit | null): FormState {
  return {
    code: unit?.code ?? "",
    tower_id: unit?.tower_id ?? NO_TOWER,
    unit_type: unit?.unit_type ?? "apartment",
    floor: unit?.floor ?? "",
    area_m2: unit?.area_m2 != null ? String(unit.area_m2) : "",
    coefficient_pct: unit ? String(unit.coefficient_pct) : "",
    is_active: unit?.is_active ?? true,
    notes: unit?.notes ?? ""
  };
}

export function UnitFormDialog({ open, onOpenChange, unit }: { open: boolean; onOpenChange: (open: boolean) => void; unit: Unit | null }) {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const { data: towers = [] } = useTowers();
  const [form, setForm] = useState<FormState>(toForm(unit));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setForm(toForm(unit));
  }, [open, unit]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  async function save() {
    const coefficient = form.coefficient_pct ? Number(form.coefficient_pct.replace(",", ".")) : 0;
    const area = form.area_m2 ? Number(form.area_m2.replace(",", ".")) : null;
    if (!form.code.trim()) return toast.error("El código de la unidad es obligatorio.");
    if (!Number.isFinite(coefficient) || coefficient < 0 || coefficient > 100) return toast.error("El coeficiente debe estar entre 0 y 100.");
    if (area !== null && (!Number.isFinite(area) || area <= 0)) return toast.error("El área debe ser un número positivo.");

    const payload = {
      code: form.code.trim().toUpperCase(),
      tower_id: form.tower_id === NO_TOWER ? null : form.tower_id,
      unit_type: form.unit_type,
      floor: form.floor.trim() || null,
      area_m2: area,
      coefficient_pct: coefficient,
      is_active: form.is_active,
      notes: form.notes.trim() || null
    };
    setSaving(true);
    try {
      if (unit) {
        assertOk(await insforge.database.from("units").update(payload).eq("id", unit.id).select("id"));
      } else {
        assertOk(await insforge.database.from("units").insert([{ ...payload, organization_id: orgId }]).select("id"));
      }
      toast.success(unit ? "Unidad actualizada." : "Unidad creada.");
      await queryClient.invalidateQueries({ queryKey: ["units", orgId] });
      onOpenChange(false);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{unit ? `Editar ${unit.code}` : "Nueva unidad"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="unit-code">Código</Label>
            <Input id="unit-code" value={form.code} onChange={(e) => set("code", e.target.value)} placeholder="T1-502" />
          </div>
          <div className="space-y-1.5">
            <Label>Torre / bloque</Label>
            <Select value={form.tower_id} onValueChange={(v) => set("tower_id", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_TOWER}>Sin torre</SelectItem>
                {towers.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Tipo</Label>
            <Select value={form.unit_type} onValueChange={(v) => set("unit_type", v as UnitType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(UNIT_TYPE_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="unit-floor">Piso</Label>
            <Input id="unit-floor" value={form.floor} onChange={(e) => set("floor", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="unit-area">Área privada (m²)</Label>
            <Input id="unit-area" inputMode="decimal" value={form.area_m2} onChange={(e) => set("area_m2", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="unit-coef">Coeficiente (%)</Label>
            <Input id="unit-coef" inputMode="decimal" value={form.coefficient_pct} onChange={(e) => set("coefficient_pct", e.target.value)} placeholder="0,8523" />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="unit-notes">Notas</Label>
            <Textarea id="unit-notes" rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
          </div>
          <div className="flex items-center justify-between rounded-md border border-border p-3 sm:col-span-2">
            <div>
              <Label>Unidad activa</Label>
              <p className="text-xs text-muted-foreground">Las inactivas no reciben cuotas ni pueden reservar.</p>
            </div>
            <Switch checked={form.is_active} onCheckedChange={(v) => set("is_active", v)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Guardando..." : "Guardar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
