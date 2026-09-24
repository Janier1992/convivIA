import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { insforge } from "@/lib/insforgeClient";
import { assertOk, errorMessage } from "@/lib/rpc";
import { isNonNegativeNumber, isPositiveInteger } from "@/lib/validation";
import { useOrgId } from "@/hooks/useOrganization";
import { usePropertyProfile } from "@/hooks/usePropertyProfile";
import { CURRENCY_OPTIONS } from "@/lib/currency";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { PropertyProfile } from "@/types/domain";

export function FinanceSettingsCard({ readOnly }: { readOnly: boolean }) {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const { data: profile } = usePropertyProfile();
  const [form, setForm] = useState<PropertyProfile | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => setForm(profile ?? null), [profile]);
  if (!form) return null;

  const set = <K extends keyof PropertyProfile>(key: K, value: PropertyProfile[K]) => setForm({ ...form, [key]: value });

  async function save() {
    if (!form) return;
    if (
      !isPositiveInteger(form.due_day) || form.due_day > 28 ||
      !isNonNegativeNumber(form.late_interest_monthly_rate) || form.late_interest_monthly_rate > 10 ||
      !isPositiveInteger(form.payment_reminder_days_before + 1) ||
      !isPositiveInteger(form.payment_reminder_days_after + 1)
    ) {
      return toast.error("Revisa los valores numéricos.");
    }
    setSaving(true);
    try {
      assertOk(
        await insforge.database
          .from("property_profiles")
          .update({
            currency: form.currency,
            due_day: form.due_day,
            late_interest_monthly_rate: form.late_interest_monthly_rate,
            rounding_unit: form.rounding_unit,
            payment_reminder_days_before: form.payment_reminder_days_before,
            payment_reminder_days_after: form.payment_reminder_days_after
          })
          .eq("organization_id", orgId)
          .select("organization_id")
      );
      toast.success("Configuración de cartera guardada.");
      await queryClient.invalidateQueries({ queryKey: ["property-profile", orgId] });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cartera</CardTitle>
        <CardDescription>Estos valores los usa el motor de liquidación y de recordatorios; no se pueden inventar desde el chat.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <fieldset disabled={readOnly} className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Moneda</Label>
            <Select value={form.currency} onValueChange={(v) => set("currency", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{CURRENCY_OPTIONS.map((c) => <SelectItem key={c.code} value={c.code}>{c.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="due-day">Día de vencimiento (1-28)</Label>
            <Input id="due-day" type="number" min={1} max={28} value={form.due_day} onChange={(e) => set("due_day", Number(e.target.value))} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="interest-rate">Tasa de interés de mora mensual (%)</Label>
            <Input id="interest-rate" type="number" min={0} max={10} step="0.1" value={form.late_interest_monthly_rate} onChange={(e) => set("late_interest_monthly_rate", Number(e.target.value))} />
            <p className="text-xs text-muted-foreground">Valida el tope legal vigente antes de liquidar; la plataforma no lo certifica.</p>
          </div>
          <div className="space-y-1.5">
            <Label>Redondeo de cuotas liquidadas</Label>
            <Select value={String(form.rounding_unit)} onValueChange={(v) => set("rounding_unit", Number(v))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {[1, 10, 50, 100, 500, 1000].map((u) => <SelectItem key={u} value={String(u)}>{u === 1 ? "Sin redondeo" : `Al múltiplo de ${u}`}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rem-before">Recordatorio antes del vencimiento (días)</Label>
            <Input id="rem-before" type="number" min={0} value={form.payment_reminder_days_before} onChange={(e) => set("payment_reminder_days_before", Number(e.target.value))} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rem-after">Recordatorio tras vencer (días)</Label>
            <Input id="rem-after" type="number" min={0} value={form.payment_reminder_days_after} onChange={(e) => set("payment_reminder_days_after", Number(e.target.value))} />
          </div>
        </fieldset>
        {!readOnly && <Button onClick={save} disabled={saving}>{saving ? "Guardando..." : "Guardar cambios"}</Button>}
      </CardContent>
    </Card>
  );
}
