import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { errorMessage, rpc } from "@/lib/rpc";
import { formatMoney, formatTime, todayIn } from "@/lib/format";
import { useOrgId } from "@/hooks/useOrganization";
import { useCommonAreas, useUnits } from "@/hooks/useCatalogs";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

interface Slot {
  start_at: string;
  end_at: string;
  available: boolean;
  remaining_capacity: number;
}

/** Reserva creada por el equipo (no pasa por la ventana de anticipación mínima del residente). */
export function ReservationFormDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const { data: areas = [] } = useCommonAreas();
  const { data: units = [] } = useUnits();
  const [areaId, setAreaId] = useState("");
  const [unitId, setUnitId] = useState("");
  const [date, setDate] = useState(todayIn());
  const [duration, setDuration] = useState("");
  const [slot, setSlot] = useState<Slot | null>(null);
  const [guests, setGuests] = useState("1");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const area = areas.find((a) => a.id === areaId) ?? null;
  const effectiveDuration = Number(duration || area?.min_duration_minutes || 60);

  const { data: slots = [], isFetching } = useQuery({
    queryKey: ["area-slots", areaId, date, effectiveDuration],
    enabled: !!areaId && !!date,
    queryFn: () => rpc<Slot[]>("get_area_slots", { p_area_id: areaId, p_date: date, p_duration_minutes: effectiveDuration })
  });

  const available = useMemo(() => slots.filter((s) => s.available), [slots]);

  async function save() {
    if (!areaId || !unitId || !slot) return toast.error("Selecciona la zona, la unidad y una franja disponible.");
    setSaving(true);
    try {
      await rpc("book_area_reservation", {
        p_organization_id: orgId,
        p_area_id: areaId,
        p_unit_id: unitId,
        p_person_id: null,
        p_start_at: slot.start_at,
        p_end_at: slot.end_at,
        p_guests: Number(guests) || 1,
        p_notes: notes.trim() || null,
        p_source: "dashboard",
        p_conversation_id: null
      });
      toast.success("Reserva creada.");
      await queryClient.invalidateQueries({ queryKey: ["reservations", orgId] });
      onOpenChange(false);
      setAreaId(""); setUnitId(""); setSlot(null); setNotes("");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nueva reserva</DialogTitle>
          <DialogDescription>El equipo puede agendar sin la anticipación mínima, pero nunca en el pasado ni fuera del horario.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Zona común</Label>
            <Select value={areaId} onValueChange={(v) => { setAreaId(v); setSlot(null); }}>
              <SelectTrigger><SelectValue placeholder="Selecciona" /></SelectTrigger>
              <SelectContent>{areas.filter((a) => a.is_active).map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Unidad</Label>
            <Select value={unitId} onValueChange={setUnitId}>
              <SelectTrigger><SelectValue placeholder="Selecciona" /></SelectTrigger>
              <SelectContent>{units.filter((u) => u.is_active).map((u) => <SelectItem key={u.id} value={u.id}>{u.code}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="res-date">Fecha</Label>
            <Input id="res-date" type="date" value={date} onChange={(e) => { setDate(e.target.value); setSlot(null); }} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="res-duration">Duración (min)</Label>
            <Input id="res-duration" type="number" placeholder={String(area?.min_duration_minutes ?? 60)} value={duration} onChange={(e) => { setDuration(e.target.value); setSlot(null); }} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="res-guests">Invitados</Label>
            <Input id="res-guests" type="number" min={1} value={guests} onChange={(e) => setGuests(e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="res-notes">Notas (opcional)</Label>
            <Textarea id="res-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>

        {areaId && (
          <div className="space-y-2">
            <Label>Franjas disponibles</Label>
            {isFetching ? (
              <p className="text-sm text-muted-foreground">Consultando disponibilidad...</p>
            ) : available.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin franjas disponibles ese día.</p>
            ) : (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {available.map((s) => (
                  <button
                    key={s.start_at}
                    type="button"
                    onClick={() => setSlot(s)}
                    className={`rounded-md border px-2 py-1.5 text-xs transition-colors ${slot?.start_at === s.start_at ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted"}`}
                  >
                    {formatTime(s.start_at)}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {area && Number(area.fee_amount) > 0 && (
          <p className="text-xs text-muted-foreground">Esta zona tiene una tarifa de {formatMoney(area.fee_amount)} que se cargará a la unidad.</p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={save} disabled={saving || !slot}>{saving ? "Creando..." : "Crear reserva"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
