import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { insforge } from "@/lib/insforgeClient";
import { assertOk, errorMessage } from "@/lib/rpc";
import { formatDateTime } from "@/lib/format";
import { DOCUMENT_TYPE_OPTIONS } from "@/lib/labels";
import { isValidEmail } from "@/lib/validation";
import { useOrgId } from "@/hooks/useOrganization";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { Person } from "@/types/domain";
import { PersonRelations } from "./PersonRelations";

interface FormState {
  full_name: string;
  document_type: string;
  document_number: string;
  phone: string;
  email: string;
  notes: string;
}

const toForm = (p: Person | null): FormState => ({
  full_name: p?.full_name ?? "",
  document_type: p?.document_type ?? "CC",
  document_number: p?.document_number ?? "",
  phone: p?.phone ?? "",
  email: p?.email ?? "",
  notes: p?.notes ?? ""
});

export function PersonFormDialog({
  open,
  onOpenChange,
  person,
  canWrite
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  person: Person | null;
  canWrite: boolean;
}) {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(toForm(person));
  const [created, setCreated] = useState<Person | null>(null);
  const [saving, setSaving] = useState(false);
  const current = person ?? created;

  useEffect(() => {
    if (open) {
      setForm(toForm(person));
      setCreated(null);
    }
  }, [open, person]);

  const set = (key: keyof FormState, value: string) => setForm((f) => ({ ...f, [key]: value }));

  async function save() {
    if (form.full_name.trim().length < 2) return toast.error("Escribe el nombre completo.");
    if (form.email && !isValidEmail(form.email)) return toast.error("El correo no es válido.");
    const payload = {
      full_name: form.full_name.trim(),
      document_type: form.document_number.trim() ? form.document_type : null,
      document_number: form.document_number.trim() || null,
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      notes: form.notes.trim() || null
    };
    setSaving(true);
    try {
      if (current) {
        assertOk(await insforge.database.from("persons").update(payload).eq("id", current.id).select("id"));
        toast.success("Datos actualizados.");
      } else {
        const rows = assertOk(await insforge.database.from("persons").insert([{ ...payload, organization_id: orgId }]).select("*"));
        setCreated((rows as Person[])[0]);
        toast.success("Persona creada. Ahora asóciala a sus unidades.");
      }
      await queryClient.invalidateQueries({ queryKey: ["residents", orgId] });
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
          <DialogTitle>{current ? current.full_name : "Nueva persona"}</DialogTitle>
        </DialogHeader>
        <fieldset disabled={!canWrite} className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="p-name">Nombre completo</Label>
            <Input id="p-name" value={form.full_name} onChange={(e) => set("full_name", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Tipo de documento</Label>
            <Select value={form.document_type} onValueChange={(v) => set("document_type", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {DOCUMENT_TYPE_OPTIONS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="p-doc">Número de documento</Label>
            <Input id="p-doc" value={form.document_number} onChange={(e) => set("document_number", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="p-phone">Celular (WhatsApp / Telegram)</Label>
            <Input id="p-phone" inputMode="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="300 123 4567" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="p-email">Correo</Label>
            <Input id="p-email" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="p-notes">Notas internas</Label>
            <Textarea id="p-notes" rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
          </div>
        </fieldset>
        <p className="mt-2 text-xs text-muted-foreground">
          El celular identifica al residente cuando escribe al asistente: debe ser el mismo con el que usa WhatsApp o Telegram.
          {current?.data_consent_at && ` Autorizó el tratamiento de datos el ${formatDateTime(current.data_consent_at)}.`}
        </p>
        {canWrite && (
          <DialogFooter>
            <Button onClick={save} disabled={saving}>{saving ? "Guardando..." : current ? "Guardar cambios" : "Crear persona"}</Button>
          </DialogFooter>
        )}
        {current && (
          <div className="mt-5 border-t border-border pt-4">
            <PersonRelations personId={current.id} canWrite={canWrite} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
