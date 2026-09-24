import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { errorMessage, rpc } from "@/lib/rpc";
import { PQRS_PRIORITY, PQRS_TYPE_LABELS } from "@/lib/labels";
import { useOrgId } from "@/hooks/useOrganization";
import { usePqrsCategories, useUnits } from "@/hooks/useCatalogs";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { PqrsPriority, PqrsType } from "@/types/domain";

const TYPES: PqrsType[] = ["peticion", "queja", "reclamo", "sugerencia", "felicitacion"];
const PRIORITIES: PqrsPriority[] = ["low", "normal", "high", "urgent"];
const NO_UNIT = "__none__";

/** Radicación manual desde el panel (llamada telefónica, oficio presencial, etc.). */
export function CreatePqrsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const { data: categories = [] } = usePqrsCategories();
  const { data: units = [] } = useUnits();
  const [type, setType] = useState<PqrsType>("peticion");
  const [categoryId, setCategoryId] = useState("");
  const [priority, setPriority] = useState<PqrsPriority>("normal");
  const [unitId, setUnitId] = useState(NO_UNIT);
  const [requesterName, setRequesterName] = useState("");
  const [requesterContact, setRequesterContact] = useState("");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (subject.trim().length < 3) return toast.error("Escribe un asunto.");
    if (description.trim().length < 3) return toast.error("Escribe la descripción.");
    setSaving(true);
    try {
      const ticket = await rpc<{ radicado: string }>("create_pqrs_ticket", {
        p_organization_id: orgId,
        p_ticket_type: type,
        p_category_id: categoryId || null,
        p_subject: subject.trim(),
        p_description: description.trim(),
        p_priority: priority,
        p_unit_id: unitId === NO_UNIT ? null : unitId,
        p_requester_person_id: null,
        p_requester_name: requesterName.trim() || null,
        p_requester_contact: requesterContact.trim() || null,
        p_channel: "dashboard",
        p_conversation_id: null,
        p_actor_kind: "staff"
      });
      toast.success(`Radicada como ${ticket.radicado}.`);
      await queryClient.invalidateQueries({ queryKey: ["pqrs", orgId] });
      onOpenChange(false);
      setSubject(""); setDescription(""); setRequesterName(""); setRequesterContact(""); setUnitId(NO_UNIT);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader><DialogTitle>Radicar PQRS</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Tipo</Label>
            <Select value={type} onValueChange={(v) => setType(v as PqrsType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{TYPES.map((t) => <SelectItem key={t} value={t}>{PQRS_TYPE_LABELS[t]}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Categoría</Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger><SelectValue placeholder="Sin categoría" /></SelectTrigger>
              <SelectContent>{categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Prioridad</Label>
            <Select value={priority} onValueChange={(v) => setPriority(v as PqrsPriority)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{PRIORITIES.map((p) => <SelectItem key={p} value={p}>{PQRS_PRIORITY[p].label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Unidad (opcional)</Label>
            <Select value={unitId} onValueChange={setUnitId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_UNIT}>Sin unidad</SelectItem>
                {units.filter((u) => u.is_active).map((u) => <SelectItem key={u.id} value={u.id}>{u.code}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pqrs-name">Nombre de quien solicita</Label>
            <Input id="pqrs-name" value={requesterName} onChange={(e) => setRequesterName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pqrs-contact">Contacto</Label>
            <Input id="pqrs-contact" value={requesterContact} onChange={(e) => setRequesterContact(e.target.value)} placeholder="Teléfono o correo" />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="pqrs-subject">Asunto</Label>
            <Input id="pqrs-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="pqrs-desc">Descripción</Label>
            <Textarea id="pqrs-desc" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Radicando..." : "Radicar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
