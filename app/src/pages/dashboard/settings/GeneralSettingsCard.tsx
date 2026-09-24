import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { insforge } from "@/lib/insforgeClient";
import { assertOk, errorMessage } from "@/lib/rpc";
import { isValidEmail } from "@/lib/validation";
import { useOrgId } from "@/hooks/useOrganization";
import { usePropertyProfile } from "@/hooks/usePropertyProfile";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { PropertyProfile } from "@/types/domain";

export function GeneralSettingsCard({ readOnly }: { readOnly: boolean }) {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const { data: profile } = usePropertyProfile();
  const [form, setForm] = useState<PropertyProfile | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);

  useEffect(() => setForm(profile ?? null), [profile]);

  async function handleLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !form) return;
    if (!file.type.startsWith("image/")) return toast.error("El logo debe ser una imagen.");
    if (file.size > 3 * 1024 * 1024) return toast.error("El logo no puede superar 3 MB.");
    setUploadingLogo(true);
    try {
      const { data: uploadData, error: uploadError } = await insforge.storage.from("property-logos").upload(`${orgId}/logo`, file);
      if (uploadError || !uploadData) throw new Error(uploadError?.message ?? "No se pudo subir el logo.");
      assertOk(await insforge.database.from("property_profiles").update({ logo_url: uploadData.url }).eq("organization_id", orgId).select("organization_id"));
      setForm({ ...form, logo_url: uploadData.url });
      await queryClient.invalidateQueries({ queryKey: ["property-profile", orgId] });
      toast.success("Logo actualizado.");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setUploadingLogo(false);
    }
  }

  async function save() {
    if (!form) return;
    if (form.email?.trim() && !isValidEmail(form.email)) return toast.error("Escribe un correo válido.");
    setSaving(true);
    try {
      assertOk(
        await insforge.database
          .from("property_profiles")
          .update({
            display_name: form.display_name,
            legal_name: form.legal_name,
            nit: form.nit,
            address: form.address,
            city: form.city,
            department: form.department,
            phone: form.phone,
            email: form.email,
            website: form.website,
            description: form.description,
            administrator_name: form.administrator_name,
            office_hours: form.office_hours,
            privacy_policy_url: form.privacy_policy_url,
            payment_instructions: form.payment_instructions
          })
          .eq("organization_id", orgId)
          .select("organization_id")
      );
      toast.success("Datos guardados.");
      await queryClient.invalidateQueries({ queryKey: ["property-profile", orgId] });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  if (!form) return null;
  const set = <K extends keyof PropertyProfile>(key: K, value: PropertyProfile[K]) => setForm({ ...form, [key]: value });

  return (
    <Card>
      <CardHeader><CardTitle>Datos de la copropiedad</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted">
            {form.logo_url ? <img src={form.logo_url} alt={form.display_name} className="h-full w-full object-cover" /> : <span className="text-[10px] text-muted-foreground">Sin logo</span>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="logo-upload">Logo</Label>
            <input id="logo-upload" type="file" accept="image/*" disabled={readOnly || uploadingLogo} onChange={handleLogoChange} className="block text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary-foreground hover:file:opacity-90 disabled:opacity-60" />
          </div>
        </div>
        <fieldset disabled={readOnly} className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="s-name">Nombre visible</Label>
            <Input id="s-name" value={form.display_name} onChange={(e) => set("display_name", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="s-admin">Administrador(a)</Label>
            <Input id="s-admin" value={form.administrator_name ?? ""} onChange={(e) => set("administrator_name", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="s-nit">NIT</Label>
            <Input id="s-nit" value={form.nit ?? ""} onChange={(e) => set("nit", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="s-legal">Razón social</Label>
            <Input id="s-legal" value={form.legal_name ?? ""} onChange={(e) => set("legal_name", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="s-address">Dirección</Label>
            <Input id="s-address" value={form.address ?? ""} onChange={(e) => set("address", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="s-city">Ciudad</Label>
            <Input id="s-city" value={form.city ?? ""} onChange={(e) => set("city", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="s-phone">Teléfono</Label>
            <Input id="s-phone" value={form.phone ?? ""} onChange={(e) => set("phone", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="s-email">Correo</Label>
            <Input id="s-email" type="email" value={form.email ?? ""} onChange={(e) => set("email", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="s-hours">Horario de atención</Label>
            <Input id="s-hours" value={form.office_hours ?? ""} onChange={(e) => set("office_hours", e.target.value)} placeholder="Lunes a viernes 8am-5pm" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="s-privacy">Enlace a la política de tratamiento de datos</Label>
            <Input id="s-privacy" value={form.privacy_policy_url ?? ""} onChange={(e) => set("privacy_policy_url", e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="s-desc">Descripción</Label>
            <Textarea id="s-desc" rows={2} value={form.description ?? ""} onChange={(e) => set("description", e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="s-pay">Instrucciones de pago (el asistente las muestra a residentes verificados)</Label>
            <Textarea id="s-pay" rows={2} value={form.payment_instructions ?? ""} onChange={(e) => set("payment_instructions", e.target.value)} />
          </div>
        </fieldset>
        {!readOnly && <Button onClick={save} disabled={saving}>{saving ? "Guardando..." : "Guardar cambios"}</Button>}
      </CardContent>
    </Card>
  );
}
