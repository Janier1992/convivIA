import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { errorMessage, rpc } from "@/lib/rpc";
import { useUnits } from "@/hooks/useCatalogs";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { UnitPersonOption } from "@/types/domain";

interface PersonOption {
  person_id: string;
  full_name: string;
}

export function RegisterProxyDialog({
  open,
  onOpenChange,
  organizationId,
  assemblyId,
  onSaved
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  assemblyId: string;
  onSaved: () => Promise<void> | void;
}) {
  const { data: units = [] } = useUnits();
  const [unitId, setUnitId] = useState("");
  const [grantorId, setGrantorId] = useState("");
  const [attorneyQuery, setAttorneyQuery] = useState("");
  const [attorneyId, setAttorneyId] = useState("");
  const [attorneyName, setAttorneyName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setUnitId("");
    setGrantorId("");
    setAttorneyQuery("");
    setAttorneyId("");
    setAttorneyName("");
  }, [open]);

  const owners = useQuery({
    queryKey: ["unit-active-people", unitId],
    enabled: open && !!unitId,
    queryFn: async () => rpc<UnitPersonOption[]>("get_unit_active_people", { p_organization_id: organizationId, p_unit_id: unitId })
  });
  const unitOwners = (owners.data ?? []).filter((p) => p.relation === "owner");

  const [debouncedQuery, setDebouncedQuery] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(attorneyQuery.trim()), 300);
    return () => clearTimeout(timer);
  }, [attorneyQuery]);

  const attorneyResults = useQuery({
    queryKey: ["search-persons", debouncedQuery],
    enabled: open && debouncedQuery.length >= 2,
    queryFn: async () => rpc<PersonOption[]>("search_persons_basic", { p_organization_id: organizationId, p_query: debouncedQuery })
  });

  async function save() {
    if (!unitId) return toast.error("Elige la unidad que otorga el poder.");
    if (!grantorId) return toast.error("Elige quién otorga el poder (debe ser propietario de la unidad).");
    if (!attorneyId) return toast.error("Elige el apoderado.");
    setSaving(true);
    try {
      await rpc("register_proxy", {
        p_organization_id: organizationId,
        p_assembly_id: assemblyId,
        p_unit_id: unitId,
        p_grantor_person_id: grantorId,
        p_attorney_person_id: attorneyId
      });
      toast.success("Poder registrado.");
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
        <DialogHeader><DialogTitle>Registrar poder</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Unidad que otorga el poder</Label>
            <Select value={unitId} onValueChange={(v) => { setUnitId(v); setGrantorId(""); }}>
              <SelectTrigger><SelectValue placeholder="Elige una unidad" /></SelectTrigger>
              <SelectContent>
                {units.filter((u) => u.is_active).map((u) => <SelectItem key={u.id} value={u.id}>{u.code}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {unitId && (
            <div className="space-y-1.5">
              <Label>Propietario que otorga el poder</Label>
              <Select value={grantorId} onValueChange={setGrantorId}>
                <SelectTrigger><SelectValue placeholder={unitOwners.length ? "Elige el propietario" : "Sin propietario vinculado a esta unidad"} /></SelectTrigger>
                <SelectContent>
                  {unitOwners.map((p) => <SelectItem key={p.person_id} value={p.person_id}>{p.full_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="attorney-search">Apoderado (busca por nombre)</Label>
            <Input
              id="attorney-search"
              value={attorneyId ? attorneyName : attorneyQuery}
              onChange={(e) => { setAttorneyId(""); setAttorneyQuery(e.target.value); }}
              placeholder="Escribe al menos 2 letras"
            />
            {!attorneyId && attorneyResults.data && attorneyResults.data.length > 0 && (
              <div className="max-h-40 overflow-y-auto rounded-md border border-border">
                {attorneyResults.data.map((p) => (
                  <button
                    key={p.person_id}
                    type="button"
                    className="block w-full px-3 py-2 text-left text-sm hover:bg-muted"
                    onClick={() => { setAttorneyId(p.person_id); setAttorneyName(p.full_name); }}
                  >
                    {p.full_name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Registrando..." : "Registrar poder"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
