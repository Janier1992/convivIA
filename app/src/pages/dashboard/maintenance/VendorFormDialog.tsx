import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { errorMessage, rpc } from "@/lib/rpc";
import { useOrgId } from "@/hooks/useOrganization";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Vendor } from "@/types/domain";

export function VendorFormDialog({
  open,
  onOpenChange,
  vendor
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vendor?: Vendor | null;
}) {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [specialty, setSpecialty] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(vendor?.name ?? "");
    setSpecialty(vendor?.specialty ?? "");
    setPhone(vendor?.phone ?? "");
    setEmail(vendor?.email ?? "");
    setNotes(vendor?.notes ?? "");
  }, [open, vendor]);

  async function save() {
    if (name.trim().length < 2) return toast.error("Escribe el nombre del proveedor.");
    setSaving(true);
    try {
      if (vendor) {
        await rpc("update_vendor", {
          p_vendor_id: vendor.id,
          p_name: name.trim(),
          p_specialty: specialty.trim() || null,
          p_phone: phone.trim() || null,
          p_email: email.trim() || null,
          p_notes: notes.trim() || null
        });
        toast.success("Proveedor actualizado.");
      } else {
        await rpc("create_vendor", {
          p_organization_id: orgId,
          p_name: name.trim(),
          p_specialty: specialty.trim() || null,
          p_phone: phone.trim() || null,
          p_email: email.trim() || null,
          p_notes: notes.trim() || null
        });
        toast.success("Proveedor creado.");
      }
      await queryClient.invalidateQueries({ queryKey: ["vendors", orgId] });
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
        <DialogHeader><DialogTitle>{vendor ? "Editar proveedor" : "Nuevo proveedor"}</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="vendor-name">Nombre</Label>
            <Input id="vendor-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. Ascensores Andinos SAS" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="vendor-specialty">Especialidad</Label>
            <Input id="vendor-specialty" value={specialty} onChange={(e) => setSpecialty(e.target.value)} placeholder="Ej. Ascensores" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="vendor-phone">Teléfono</Label>
            <Input id="vendor-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="vendor-email">Correo</Label>
            <Input id="vendor-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="vendor-notes">Notas</Label>
            <Textarea id="vendor-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Guardando..." : vendor ? "Guardar cambios" : "Crear proveedor"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
