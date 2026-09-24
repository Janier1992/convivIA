import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileText, Plus, RefreshCw, Trash2 } from "lucide-react";
import { insforge } from "@/lib/insforgeClient";
import { errorMessage, rpc } from "@/lib/rpc";
import { formatBytes, formatDateTime } from "@/lib/format";
import { DOCUMENT_TYPE_LABELS, VISIBILITY_LABELS } from "@/lib/labels";
import { useOrganization, useOrgId } from "@/hooks/useOrganization";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { QueryErrorState } from "@/components/QueryErrorState";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { FileLink } from "@/components/FileLink";
import type { DocumentRow } from "@/types/domain";
import { UploadDocumentDialog } from "./UploadDocumentDialog";

const STATUS_BADGE: Record<DocumentRow["status"], { label: string; variant: "muted" | "warning" | "success" | "destructive" }> = {
  pending: { label: "En cola", variant: "muted" },
  processing: { label: "Procesando", variant: "warning" },
  ready: { label: "Listo", variant: "success" },
  failed: { label: "Falló", variant: "destructive" }
};

export function DocumentsPage() {
  const orgId = useOrgId();
  const { can } = useOrganization();
  const canWrite = can("documents.write");
  const queryClient = useQueryClient();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [deleting, setDeleting] = useState<DocumentRow | null>(null);

  const { data: documents = [], isLoading, isError, refetch } = useQuery({
    queryKey: ["documents", orgId],
    enabled: !!orgId,
    refetchInterval: (query) => (query.state.data?.some((d) => d.status === "pending" || d.status === "processing") ? 4000 : false),
    queryFn: async () => {
      const { data, error } = await insforge.database
        .from("documents")
        .select("*")
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data as DocumentRow[];
    }
  });

  async function reprocess(id: string) {
    try {
      await rpc("reprocess_document", { p_document_id: id });
      toast.success("Documento en cola para reprocesar.");
      await queryClient.invalidateQueries({ queryKey: ["documents", orgId] });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    try {
      await insforge.database.from("documents").delete().eq("id", deleting.id);
      toast.success("Documento eliminado.");
      await queryClient.invalidateQueries({ queryKey: ["documents", orgId] });
    } catch (err) {
      toast.error(errorMessage(err));
      throw err;
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Documentos"
        description="Reglamento, manual de convivencia, actas y demás documentos que el asistente puede citar."
        actions={canWrite && <Button onClick={() => setUploadOpen(true)}><Plus className="h-4 w-4" aria-hidden /> Subir documento</Button>}
      />

      {isError ? (
        <QueryErrorState onRetry={() => refetch()} message="No se pudieron cargar los documentos." />
      ) : isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : documents.length === 0 ? (
        <EmptyState icon={FileText} title="Aún no hay documentos" description="Sube el reglamento para que el asistente pueda responder dudas citando la fuente." />
      ) : (
        <div className="space-y-2">
          {documents.map((doc) => (
            <Card key={doc.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="font-medium">{doc.title}</p>
                <p className="text-xs text-muted-foreground">
                  {DOCUMENT_TYPE_LABELS[doc.doc_type]} · {VISIBILITY_LABELS[doc.visibility]} · {doc.chunk_count} fragmentos
                  {doc.size_bytes ? ` · ${formatBytes(doc.size_bytes)}` : ""} · {formatDateTime(doc.created_at)}
                </p>
                {doc.status === "failed" && doc.error && <p className="mt-1 text-xs text-destructive">{doc.error}</p>}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge variant={STATUS_BADGE[doc.status].variant}>{STATUS_BADGE[doc.status].label}</Badge>
                {doc.storage_key && <FileLink kind="document" id={doc.id} label="Ver archivo" />}
                {canWrite && doc.status === "failed" && (
                  <Button size="sm" variant="outline" onClick={() => reprocess(doc.id)}><RefreshCw className="h-4 w-4" aria-hidden /> Reintentar</Button>
                )}
                {canWrite && (
                  <Button size="sm" variant="ghost" onClick={() => setDeleting(doc)}><Trash2 className="h-4 w-4 text-destructive" aria-hidden /></Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      <UploadDocumentDialog open={uploadOpen} onOpenChange={setUploadOpen} />
      <ConfirmDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)} title="Eliminar documento" confirmLabel="Eliminar" destructive onConfirm={confirmDelete} />
    </div>
  );
}
