import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { insforge } from "@/lib/insforgeClient";
import { assertOk, errorMessage } from "@/lib/rpc";
import { useOrgId } from "@/hooks/useOrganization";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { AreaHoursEditor } from "./AreaHoursEditor";
import type { CommonArea } from "@/types/domain";

interface FormState {
  name: string;
  description: string;
  rules: string;
  booking_mode: "exclusive" | "shared";
  capacity: string;
  max_guests: string;
  requires_approval: boolean;
  fee_amount: string;
  deposit_amount: string;
  slot_minutes: string;
  min_duration_minutes: string;
  max_duration_minutes: string;
  advance_min_hours: string;
  advance_max_days: string;
  max_active_per_unit: string;
  block_if_overdue: boolean;
  is_active: boolean;
}

const toForm = (a: CommonArea | null): FormState => ({
  name: a?.name ?? "",
  description: a?.description ?? "",
  rules: a?.rules ?? "",
  booking_mode: a?.booking_mode ?? "exclusive",
  capacity: a?.capacity != null ? String(a.capacity) : "",
  max_guests: a?.max_guests != null ? String(a.max_guests) : "",
  requires_approval: a?.requires_approval ?? false,
  fee_amount: a ? String(a.fee_amount) : "0",
  deposit_amount: a ? String(a.deposit_amount) : "0",
  slot_minutes: a ? String(a.slot_minutes) : "60",
  min_duration_minutes: a ? String(a.min_duration_minutes) : "60",
  max_duration_minutes: a ? String(a.max_duration_minutes) : "240",
  advance_min_hours: a ? String(a.advance_min_hours) : "24",
  advance_max_days: a ? String(a.advance_max_days) : "60",
  max_active_per_unit: a ? String(a.max_active_per_unit) : "2",
  block_if_overdue: a?.block_if_overdue ?? false,
  is_active: a?.is_active ?? true
});

export function AreaFormDialog({ open, onOpenChange, area, canWrite }: { open: boolean; onOpenChange: (open: boolean) => void; area: CommonArea | null; canWrite: boolean }) {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(toForm(area));
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const areaId = area?.id ?? createdId;

  useEffect(() => {
    if (open) { setForm(toForm(area)); setCreatedId(null); }
  }, [open, area]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));
  const num = (v: string) => (v.trim() === "" ? null : Number(v));

  async function save() {
    if (!form.name.trim()) return toast.error("El nombre es obligatorio.");
    if (form.booking_mode === "shared" && !num(form.capacity)) return toast.error("Las zonas compartidas necesitan un aforo.");
    const payload = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      rules: form.rules.trim() || null,
      booking_mode: form.booking_mode,
      capacity: num(form.capacity),
      max_guests: num(form.max_guests),
      requires_approval: form.requires_approval,
      fee_amount: Number(form.fee_amount) || 0,
      deposit_amount: Number(form.deposit_amount) || 0,
      slot_minutes: Number(form.slot_minutes) || 60,
      min_duration_minutes: Number(form.min_duration_minutes) || 60,
      max_duration_minutes: Number(form.max_duration_minutes) || 240,
      advance_min_hours: Number(form.advance_min_hours) || 0,
      advance_max_days: Number(form.advance_max_days) || 60,
      max_active_per_unit: Number(form.max_active_per_unit) || 1,
      block_if_overdue: form.block_if_overdue,
      is_active: form.is_active
    };
    setSaving(true);
    try {
      if (areaId) {
        assertOk(await insforge.database.from("common_areas").update(payload).eq("id", areaId).select("id"));
      } else {
        const rows = assertOk(await insforge.database.from("common_areas").insert([{ ...payload, organization_id: orgId }]).select("id"));
        setCreatedId((rows as { id: string }[])[0].id);
      }
      toast.success("Zona común guardada.");
      await queryClient.invalidateQueries({ queryKey: ["common-areas", orgId] });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>{area ? area.name : "Nueva zona común"}</DialogTitle></DialogHeader>
        <fieldset disabled={!canWrite} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="area-name">Nombre</Label>
              <Input id="area-name" value={form.name} onChange={(e) => set("name", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Modo de uso</Label>
              <Select value={form.booking_mode} onValueChange={(v) => set("booking_mode", v as "exclusive" | "shared")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="exclusive">Exclusivo (una reserva a la vez)</SelectItem>
                  <SelectItem value="shared">Compartido (por aforo)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="area-capacity">{form.booking_mode === "shared" ? "Aforo (obligatorio)" : "Aforo (opcional)"}</Label>
              <Input id="area-capacity" type="number" min={1} value={form.capacity} onChange={(e) => set("capacity", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="area-guests">Máximo de invitados por reserva</Label>
              <Input id="area-guests" type="number" min={1} value={form.max_guests} onChange={(e) => set("max_guests", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="area-fee">Tarifa (se carga a la unidad)</Label>
              <Input id="area-fee" type="number" min={0} value={form.fee_amount} onChange={(e) => set("fee_amount", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="area-deposit">Depósito (informativo)</Label>
              <Input id="area-deposit" type="number" min={0} value={form.deposit_amount} onChange={(e) => set("deposit_amount", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="area-slot">Intervalo entre franjas (min)</Label>
              <Input id="area-slot" type="number" min={15} value={form.slot_minutes} onChange={(e) => set("slot_minutes", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="area-max-unit">Máximo de reservas activas por unidad</Label>
              <Input id="area-max-unit" type="number" min={1} value={form.max_active_per_unit} onChange={(e) => set("max_active_per_unit", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="area-min-dur">Duración mínima (min)</Label>
              <Input id="area-min-dur" type="number" min={15} value={form.min_duration_minutes} onChange={(e) => set("min_duration_minutes", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="area-max-dur">Duración máxima (min)</Label>
              <Input id="area-max-dur" type="number" min={15} value={form.max_duration_minutes} onChange={(e) => set("max_duration_minutes", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="area-min-adv">Anticipación mínima (horas)</Label>
              <Input id="area-min-adv" type="number" min={0} value={form.advance_min_hours} onChange={(e) => set("advance_min_hours", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="area-max-adv">Anticipación máxima (días)</Label>
              <Input id="area-max-adv" type="number" min={1} value={form.advance_max_days} onChange={(e) => set("advance_max_days", e.target.value)} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="area-desc">Descripción</Label>
              <Textarea id="area-desc" rows={2} value={form.description} onChange={(e) => set("description", e.target.value)} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="area-rules">Reglas (el asistente las muestra a quien pregunte)</Label>
              <Textarea id="area-rules" rows={2} value={form.rules} onChange={(e) => set("rules", e.target.value)} />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="flex items-center justify-between rounded-md border border-border p-3">
              <Label className="text-sm">Requiere aprobación</Label>
              <Switch checked={form.requires_approval} onCheckedChange={(v) => set("requires_approval", v)} />
            </div>
            <div className="flex items-center justify-between rounded-md border border-border p-3">
              <Label className="text-sm">Bloquear si hay mora</Label>
              <Switch checked={form.block_if_overdue} onCheckedChange={(v) => set("block_if_overdue", v)} />
            </div>
            <div className="flex items-center justify-between rounded-md border border-border p-3">
              <Label className="text-sm">Activa</Label>
              <Switch checked={form.is_active} onCheckedChange={(v) => set("is_active", v)} />
            </div>
          </div>
        </fieldset>
        {canWrite && (
          <DialogFooter>
            <Button onClick={save} disabled={saving}>{saving ? "Guardando..." : area ? "Guardar cambios" : "Crear zona"}</Button>
          </DialogFooter>
        )}
        {areaId && (
          <div className="border-t border-border pt-4">
            <AreaHoursEditor areaId={areaId} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
