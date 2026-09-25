import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { errorMessage, rpc } from "@/lib/rpc";
import { useUnits } from "@/hooks/useCatalogs";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { UnitPersonOption } from "@/types/domain";

interface ProxyOption {
  id: string;
  unit_id: string;
  attorney_person_id: string;
  attorney_name: string;
}

export function CheckInUnitDialog({
  open,
  onOpenChange,
  organizationId,
  assemblyId,
  proxies,
  onSaved
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  assemblyId: string;
  proxies: ProxyOption[];
  onSaved: () => Promise<void> | void;
}) {
  const { data: units = [] } = useUnits();
  const [unitId, setUnitId] = useState("");
  const [personId, setPersonId] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setUnitId("");
    setPersonId("");
  }, [open]);

  const people = useQuery({
    queryKey: ["unit-active-people", unitId],
    enabled: open && !!unitId,
    queryFn: async () => rpc<UnitPersonOption[]>("get_unit_active_people", { p_organization_id: organizationId, p_unit_id: unitId })
  });

  const unitProxy = proxies.find((p) => p.unit_id === unitId);

  async function save() {
    if (!unitId) return toast.error("Elige la unidad.");
    if (!personId) return toast.error("Elige quién llega en representación de la unidad.");
    setSaving(true);
    try {
      const usingProxy = unitProxy && unitProxy.attorney_person_id === personId;
      await rpc("check_in_unit", {
        p_organization_id: organizationId,
        p_assembly_id: assemblyId,
        p_unit_id: unitId,
        p_person_id: personId,
        p_proxy_id: usingProxy ? unitProxy!.id : null
      });
      toast.success("Asistencia registrada.");
      onOpenChange(false);
      await onSaved();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Registrar asistencia</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Unidad</Label>
            <Select value={unitId} onValueChange={(v) => { setUnitId(v); setPersonId(""); }}>
              <SelectTrigger><SelectValue placeholder="Elige una unidad" /></SelectTrigger>
              <SelectContent>
                {units.filter((u) => u.is_active).map((u) => <SelectItem key={u.id} value={u.id}>{u.code}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {unitId && (
            <div className="space-y-1.5">
              <Label>Quién llega</Label>
              <Select value={personId} onValueChange={setPersonId}>
                <SelectTrigger><SelectValue placeholder="Elige la persona" /></SelectTrigger>
                <SelectContent>
                  {(people.data ?? []).map((p) => (
                    <SelectItem key={p.person_id} value={p.person_id}>{p.full_name} ({p.relation})</SelectItem>
                  ))}
                  {unitProxy && !people.data?.some((p) => p.person_id === unitProxy.attorney_person_id) && (
                    <SelectItem value={unitProxy.attorney_person_id}>{unitProxy.attorney_name} (apoderado)</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Registrando..." : "Registrar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
