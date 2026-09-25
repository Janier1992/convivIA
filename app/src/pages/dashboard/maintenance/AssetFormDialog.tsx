import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { errorMessage, rpc } from "@/lib/rpc";
import { ASSET_CATEGORY_LABELS } from "@/lib/labels";
import { useOrgId } from "@/hooks/useOrganization";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { Asset, AssetCategory } from "@/types/domain";

const CATEGORIES = Object.keys(ASSET_CATEGORY_LABELS) as AssetCategory[];

export function AssetFormDialog({
  open,
  onOpenChange,
  asset
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  asset?: Asset | null;
}) {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [category, setCategory] = useState<AssetCategory>("other");
  const [location, setLocation] = useState("");
  const [installedOn, setInstalledOn] = useState("");
  const [warrantyExpiresOn, setWarrantyExpiresOn] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(asset?.name ?? "");
    setCategory(asset?.category ?? "other");
    setLocation(asset?.location ?? "");
    setInstalledOn(asset?.installed_on?.slice(0, 10) ?? "");
    setWarrantyExpiresOn(asset?.warranty_expires_on?.slice(0, 10) ?? "");
    setNotes(asset?.notes ?? "");
  }, [open, asset]);

  async function save() {
    if (name.trim().length < 2) return toast.error("Escribe el nombre del activo.");
    setSaving(true);
    try {
      if (asset) {
        await rpc("update_asset", {
          p_asset_id: asset.id,
          p_name: name.trim(),
          p_category: category,
          p_location: location.trim() || null,
          p_installed_on: installedOn || null,
          p_warranty_expires_on: warrantyExpiresOn || null,
          p_notes: notes.trim() || null
        });
        toast.success("Activo actualizado.");
      } else {
        await rpc("create_asset", {
          p_organization_id: orgId,
          p_name: name.trim(),
          p_category: category,
          p_location: location.trim() || null,
          p_installed_on: installedOn || null,
          p_warranty_expires_on: warrantyExpiresOn || null,
          p_notes: notes.trim() || null
        });
        toast.success("Activo creado.");
      }
      await queryClient.invalidateQueries({ queryKey: ["assets", orgId] });
      onOpenChange(false);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function retire() {
    if (!asset) return;
    setSaving(true);
    try {
      await rpc("update_asset", { p_asset_id: asset.id, p_status: asset.status === "active" ? "retired" : "active" });
      toast.success(asset.status === "active" ? "Activo dado de baja." : "Activo reactivado.");
      await queryClient.invalidateQueries({ queryKey: ["assets", orgId] });
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
        <DialogHeader><DialogTitle>{asset ? "Editar activo" : "Nuevo activo"}</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="asset-name">Nombre</Label>
            <Input id="asset-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. Ascensor torre 1" />
          </div>
          <div className="space-y-1.5">
            <Label>Categoría</Label>
            <Select value={category} onValueChange={(v) => setCategory(v as AssetCategory)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{ASSET_CATEGORY_LABELS[c]}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="asset-location">Ubicación</Label>
            <Input id="asset-location" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Ej. Torre 1" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="asset-installed">Instalado el</Label>
            <Input id="asset-installed" type="date" value={installedOn} onChange={(e) => setInstalledOn(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="asset-warranty">Garantía hasta</Label>
            <Input id="asset-warranty" type="date" value={warrantyExpiresOn} onChange={(e) => setWarrantyExpiresOn(e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="asset-notes">Notas</Label>
            <Textarea id="asset-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter className="sm:justify-between">
          {asset ? (
            <Button variant="outline" onClick={retire} disabled={saving}>
              {asset.status === "active" ? "Dar de baja" : "Reactivar"}
            </Button>
          ) : <span />}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button onClick={save} disabled={saving}>{saving ? "Guardando..." : asset ? "Guardar cambios" : "Crear activo"}</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
