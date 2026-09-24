import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { insforge } from "@/lib/insforgeClient";
import { assertOk, errorMessage } from "@/lib/rpc";
import { DOCUMENT_TYPE_LABELS, VISIBILITY_LABELS } from "@/lib/labels";
import { useOrgId } from "@/hooks/useOrganization";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { DocumentType } from "@/types/domain";

const DOC_TYPES = Object.keys(DOCUMENT_TYPE_LABELS) as DocumentType[];
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const ALLOWED_TYPES = ["application/pdf", "text/plain", "text/markdown"];

export function UploadDocumentDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<"file" | "text">("file");
  const [title, setTitle] = useState("");
  const [docType, setDocType] = useState<DocumentType>("bylaws");
  const [visibility, setVisibility] = useState<"public" | "residents" | "staff">("residents");
  const [version, setVersion] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);

  function reset() {
    setTitle(""); setVersion(""); setFile(null); setText("");
  }

  async function save() {
    if (!title.trim()) return toast.error("Escribe un título.");
    if (mode === "file" && !file) return toast.error("Selecciona un archivo.");
    if (mode === "text" && text.trim().length < 20) return toast.error("Pega al menos un párrafo de texto.");
    setSaving(true);
    try {
      let storageKey: string | null = null;
      let mimeType: string | null = null;
      let fileName: string | null = null;
      let sizeBytes: number | null = null;

      if (mode === "file" && file) {
        if (!ALLOWED_TYPES.includes(file.type) && !/\.(pdf|txt|md)$/i.test(file.name)) {
          throw new Error("Solo se admiten archivos PDF o de texto (.txt, .md).");
        }
        if (file.size > MAX_FILE_BYTES) throw new Error("El archivo no puede superar 15 MB.");
        const key = `${orgId}/${crypto.randomUUID()}-${file.name}`;
        const { error: uploadError } = await insforge.storage.from("documents").upload(key, file);
        if (uploadError) throw new Error(uploadError.message ?? "No se pudo subir el archivo.");
        storageKey = key;
        mimeType = file.type || null;
        fileName = file.name;
        sizeBytes = file.size;
      }

      assertOk(
        await insforge.database
          .from("documents")
          .insert([
            {
              organization_id: orgId,
              title: title.trim(),
              doc_type: docType,
              visibility,
              version: version.trim() || null,
              storage_key: storageKey,
              source_text: mode === "text" ? text.trim() : null,
              mime_type: mimeType,
              file_name: fileName,
              size_bytes: sizeBytes
            }
          ])
          .select("id")
      );
      toast.success("Documento cargado. Se está procesando para que el asistente pueda usarlo.");
      await queryClient.invalidateQueries({ queryKey: ["documents", orgId] });
      onOpenChange(false);
      reset();
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
          <DialogTitle>Subir documento</DialogTitle>
          <DialogDescription>PDF con texto (no escaneado) o texto pegado directamente. Se fragmenta para que el asistente cite la fuente exacta.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Tabs value={mode} onValueChange={(v) => setMode(v as "file" | "text")}>
            <TabsList>
              <TabsTrigger value="file">Archivo (PDF / .txt)</TabsTrigger>
              <TabsTrigger value="text">Pegar texto</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="space-y-1.5">
            <Label htmlFor="doc-title">Título</Label>
            <Input id="doc-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ej. Reglamento de propiedad horizontal" />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Tipo</Label>
              <Select value={docType} onValueChange={(v) => setDocType(v as DocumentType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{DOC_TYPES.map((t) => <SelectItem key={t} value={t}>{DOCUMENT_TYPE_LABELS[t]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Visibilidad</Label>
              <Select value={visibility} onValueChange={(v) => setVisibility(v as typeof visibility)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="public">Pública</SelectItem>
                  <SelectItem value="residents">Residentes</SelectItem>
                  <SelectItem value="staff">Solo equipo</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="doc-version">Versión (opcional)</Label>
              <Input id="doc-version" value={version} onChange={(e) => setVersion(e.target.value)} placeholder="Ej. v2 2026" />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{VISIBILITY_LABELS[visibility]}</p>

          {mode === "file" ? (
            <div className="space-y-1.5">
              <Label htmlFor="doc-file">Archivo</Label>
              <input
                id="doc-file"
                type="file"
                accept=".pdf,.txt,.md"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="block text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary-foreground hover:file:opacity-90"
              />
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="doc-text">Contenido</Label>
              <Textarea id="doc-text" rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder="Pega aquí el texto (por ejemplo, preguntas frecuentes o una circular corta)." />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Subiendo..." : "Subir documento"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
