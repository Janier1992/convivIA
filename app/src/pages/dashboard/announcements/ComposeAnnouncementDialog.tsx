import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import { insforge } from "@/lib/insforgeClient";
import { assertOk, errorMessage } from "@/lib/rpc";
import { functionsClient } from "@/lib/functionsClient";
import { AUDIENCE_LABELS } from "@/lib/labels";
import { useOrgId } from "@/hooks/useOrganization";
import { useTowers, useUnits } from "@/hooks/useCatalogs";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { AudienceType } from "@/types/domain";

const AUDIENCES: AudienceType[] = ["all", "owners", "residents", "debtors", "towers", "units"];

export function ComposeAnnouncementDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const { data: towers = [] } = useTowers();
  const { data: units = [] } = useUnits();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState<AudienceType>("all");
  const [towerIds, setTowerIds] = useState<string[]>([]);
  const [unitIds, setUnitIds] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [saving, setSaving] = useState(false);

  function toggle(list: string[], setList: (v: string[]) => void, id: string) {
    setList(list.includes(id) ? list.filter((v) => v !== id) : [...list, id]);
  }

  async function draftWithAi() {
    if (notes.trim().length < 10) return toast.error("Escribe al menos una frase con lo que quieres comunicar.");
    setDrafting(true);
    try {
      const draft = await functionsClient.post<{ title: string; body: string }>("ai-assist", {
        action: "draft_announcement",
        organization_id: orgId,
        notes: notes.trim()
      });
      setTitle(draft.title);
      setBody(draft.body);
      toast.success("Borrador generado. Revísalo antes de enviar.");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setDrafting(false);
    }
  }

  async function saveDraft() {
    if (title.trim().length < 3) return toast.error("Escribe un título.");
    if (body.trim().length < 3) return toast.error("Escribe el contenido del comunicado.");
    if (audience === "towers" && towerIds.length === 0) return toast.error("Selecciona al menos una torre.");
    if (audience === "units" && unitIds.length === 0) return toast.error("Selecciona al menos una unidad.");
    setSaving(true);
    try {
      assertOk(
        await insforge.database
          .from("announcements")
          .insert([{ organization_id: orgId, title: title.trim(), body: body.trim(), audience_type: audience, audience_tower_ids: towerIds, audience_unit_ids: unitIds }])
          .select("id")
      );
      toast.success("Borrador guardado. Revísalo y envíalo desde la lista.");
      await queryClient.invalidateQueries({ queryKey: ["announcements", orgId] });
      onOpenChange(false);
      setTitle(""); setBody(""); setNotes(""); setTowerIds([]); setUnitIds([]);
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
          <DialogTitle>Nuevo comunicado</DialogTitle>
          <DialogDescription>Se entrega como mensaje privado a cada persona por su chat vinculado (nunca como lista pública).</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="ann-notes">Notas para la IA (opcional)</Label>
            <div className="flex gap-2">
              <Textarea id="ann-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ej. Corte de agua el sábado 10 de 8am a 12pm por mantenimiento del tanque" />
              <Button type="button" variant="outline" onClick={draftWithAi} disabled={drafting} className="shrink-0">
                <Sparkles className="h-4 w-4" aria-hidden /> {drafting ? "Redactando..." : "Redactar"}
              </Button>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ann-title">Título</Label>
            <Input id="ann-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ann-body">Contenido</Label>
            <Textarea id="ann-body" rows={5} value={body} onChange={(e) => setBody(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Audiencia</Label>
            <Select value={audience} onValueChange={(v) => setAudience(v as AudienceType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{AUDIENCES.map((a) => <SelectItem key={a} value={a}>{AUDIENCE_LABELS[a]}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {audience === "towers" && (
            <div className="flex flex-wrap gap-2">
              {towers.map((t) => (
                <button key={t.id} type="button" onClick={() => toggle(towerIds, setTowerIds, t.id)} className={`rounded-full border px-3 py-1 text-xs ${towerIds.includes(t.id) ? "border-primary bg-primary/10 text-primary" : "border-border"}`}>
                  {t.name}
                </button>
              ))}
            </div>
          )}
          {audience === "units" && (
            <div className="flex max-h-32 flex-wrap gap-2 overflow-y-auto">
              {units.filter((u) => u.is_active).map((u) => (
                <button key={u.id} type="button" onClick={() => toggle(unitIds, setUnitIds, u.id)} className={`rounded-full border px-3 py-1 text-xs ${unitIds.includes(u.id) ? "border-primary bg-primary/10 text-primary" : "border-border"}`}>
                  {u.code}
                </button>
              ))}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={saveDraft} disabled={saving}>{saving ? "Guardando..." : "Guardar borrador"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
