import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Undo2 } from "lucide-react";
import { insforge } from "@/lib/insforgeClient";
import { errorMessage, rpc } from "@/lib/rpc";
import { formatDateTime } from "@/lib/format";
import { useOrganization } from "@/hooks/useOrganization";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ConfirmDialog";

interface Batch {
  id: string;
  file_name: string | null;
  status: "completed" | "rolled_back";
  summary: { counts?: Record<string, number> };
  created_at: string;
}

export function ImportHistory() {
  const { currentOrganizationId: orgId, can } = useOrganization();
  const queryClient = useQueryClient();
  const [target, setTarget] = useState<Batch | null>(null);
  const { data: batches = [] } = useQuery({
    queryKey: ["import-batches", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await insforge.database
        .from("import_batches")
        .select("id, file_name, status, summary, created_at")
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return data as Batch[];
    }
  });

  if (batches.length === 0) return null;

  async function rollback() {
    if (!target) return;
    try {
      const undone = await rpc<Record<string, number>>("rollback_import_batch", { p_batch_id: target.id });
      toast.success(`Importación revertida: ${undone.units} unidades y ${undone.persons} personas eliminadas.`);
      await queryClient.invalidateQueries();
    } catch (err) {
      toast.error(errorMessage(err));
      throw err;
    }
  }

  return (
    <div className="mt-6 space-y-2 border-t border-border pt-4">
      <p className="text-sm font-semibold">Importaciones anteriores</p>
      {batches.map((batch) => (
        <div key={batch.id} className="flex items-center justify-between gap-3 rounded-md border border-border p-2.5 text-sm">
          <div className="min-w-0">
            <p className="truncate font-medium">{batch.file_name ?? "Importación"}</p>
            <p className="text-xs text-muted-foreground">
              {formatDateTime(batch.created_at)} · {batch.summary.counts?.units_created ?? 0} unidades, {batch.summary.counts?.persons_created ?? 0} personas
            </p>
          </div>
          {batch.status === "rolled_back" ? (
            <Badge variant="muted">Revertida</Badge>
          ) : (
            can("residents.write") && (
              <Button variant="ghost" size="sm" onClick={() => setTarget(batch)}>
                <Undo2 className="h-4 w-4" aria-hidden /> Revertir
              </Button>
            )
          )}
        </div>
      ))}
      <ConfirmDialog
        open={!!target}
        onOpenChange={(open) => !open && setTarget(null)}
        title="Revertir importación"
        description="Se eliminan las unidades, personas, relaciones y saldos iniciales CREADOS por esta importación, si nada posterior depende de ellos. Los cambios sobre unidades que ya existían no se revierten (quedan en la auditoría)."
        confirmLabel="Revertir"
        destructive
        onConfirm={rollback}
      />
    </div>
  );
}
