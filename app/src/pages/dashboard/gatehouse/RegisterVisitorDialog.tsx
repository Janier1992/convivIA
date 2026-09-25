import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { errorMessage, rpc } from "@/lib/rpc";
import { VISITOR_LOG_KIND_LABELS } from "@/lib/labels";
import { useOrgId } from "@/hooks/useOrganization";
import { useUnits } from "@/hooks/useCatalogs";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { VisitorAuthorization, VisitorLogKind } from "@/types/domain";

const NO_AUTH = "__none__";
const NO_UNIT = "__none__";
const KINDS: VisitorLogKind[] = ["visitor", "service", "delivery", "other"];

/** Registro rápido en la garita: con una preautorización pendiente, o un ingreso directo. */
export function RegisterVisitorDialog({
  open,
  onOpenChange,
  authorizations
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  authorizations: VisitorAuthorization[];
}) {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const { data: units = [] } = useUnits();
  const pending = authorizations.filter((a) => a.status === "pending");

  const [authorizationId, setAuthorizationId] = useState(NO_AUTH);
  const [unitId, setUnitId] = useState(NO_UNIT);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<VisitorLogKind>("visitor");
  const [document, setDocument] = useState("");
  const [phone, setPhone] = useState("");
  const [plate, setPlate] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setAuthorizationId(NO_AUTH);
    setUnitId(NO_UNIT);
    setName("");
    setKind("visitor");
    setDocument("");
    setPhone("");
    setPlate("");
    setNotes("");
  }, [open]);

  function applyAuthorization(id: string) {
    setAuthorizationId(id);
    const auth = pending.find((a) => a.id === id);
    if (!auth) return;
    setUnitId(auth.unit_id);
    setName(auth.visitor_name);
    setDocument(auth.visitor_document ?? "");
    setPhone(auth.visitor_phone ?? "");
    setPlate(auth.vehicle_plate ?? "");
  }

  async function save() {
    if (name.trim().length < 2) return toast.error("Escribe el nombre del visitante.");
    setSaving(true);
    try {
      await rpc("register_visitor_entry", {
        p_organization_id: orgId,
        p_visitor_name: name.trim(),
        p_unit_id: unitId === NO_UNIT ? null : unitId,
        p_authorization_id: authorizationId === NO_AUTH ? null : authorizationId,
        p_visitor_document: document.trim() || null,
        p_visitor_phone: phone.trim() || null,
        p_vehicle_plate: plate.trim() || null,
        p_kind: kind,
        p_notes: notes.trim() || null
      });
      toast.success("Ingreso registrado.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["visitor-authorizations", orgId] }),
        queryClient.invalidateQueries({ queryKey: ["visitor-logs-open", orgId] })
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
        <DialogHeader><DialogTitle>Registrar visitante</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          {pending.length > 0 && (
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Preautorización (opcional)</Label>
              <Select value={authorizationId} onValueChange={applyAuthorization}>
                <SelectTrigger><SelectValue placeholder="Sin preautorización" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_AUTH}>Ingreso directo, sin preautorización</SelectItem>
                  {pending.map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.visitor_name} · {a.units?.code ?? a.unit_id}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="visitor-name">Nombre del visitante</Label>
            <Input id="visitor-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label>Unidad</Label>
            <Select value={unitId} onValueChange={setUnitId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_UNIT}>Sin definir todavía</SelectItem>
                {units.filter((u) => u.is_active).map((u) => <SelectItem key={u.id} value={u.id}>{u.code}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Tipo</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as VisitorLogKind)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{KINDS.map((k) => <SelectItem key={k} value={k}>{VISITOR_LOG_KIND_LABELS[k]}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="visitor-document">Documento (opcional)</Label>
            <Input id="visitor-document" value={document} onChange={(e) => setDocument(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="visitor-phone">Teléfono (opcional)</Label>
            <Input id="visitor-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="visitor-plate">Placa del vehículo (opcional)</Label>
            <Input id="visitor-plate" value={plate} onChange={(e) => setPlate(e.target.value.toUpperCase())} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="visitor-notes">Notas</Label>
            <Textarea id="visitor-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Registrando..." : "Registrar ingreso"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
