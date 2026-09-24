import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { insforge } from "@/lib/insforgeClient";
import { assertOk, errorMessage } from "@/lib/rpc";
import { useOrgId } from "@/hooks/useOrganization";
import { useTowers, useUnits } from "@/hooks/useCatalogs";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export function TowersDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const { data: towers = [] } = useTowers();
  const { data: units = [] } = useUnits();
  const [name, setName] = useState("");

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["towers", orgId] });

  async function add() {
    if (!name.trim()) return;
    try {
      assertOk(await insforge.database.from("towers").insert([{ organization_id: orgId, name: name.trim(), sort_order: towers.length }]).select("id"));
      setName("");
      await refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function remove(id: string) {
    try {
      assertOk(await insforge.database.from("towers").delete().eq("id", id).select("id"));
      await refresh();
    } catch {
      toast.error("No se puede eliminar una torre que tiene unidades. Muévelas o elimínalas primero.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Torres y bloques</DialogTitle>
          <DialogDescription>Agrupan las unidades y sirven para segmentar comunicados.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {towers.map((tower) => {
            const count = units.filter((u) => u.tower_id === tower.id).length;
            return (
              <div key={tower.id} className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                <div>
                  <p className="text-sm font-medium">{tower.name}</p>
                  <p className="text-xs text-muted-foreground">{count} unidades</p>
                </div>
                <Button variant="ghost" size="icon" onClick={() => remove(tower.id)} disabled={count > 0} aria-label={`Eliminar ${tower.name}`}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            );
          })}
          {towers.length === 0 && <p className="text-sm text-muted-foreground">Aún no hay torres.</p>}
        </div>
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre (ej. Torre 3, Bloque B)" />
          <Button type="submit">Agregar</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
