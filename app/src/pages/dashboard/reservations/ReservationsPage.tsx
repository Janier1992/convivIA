import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarDays, CheckCircle2, Plus, XCircle } from "lucide-react";
import { insforge } from "@/lib/insforgeClient";
import { errorMessage, rpc } from "@/lib/rpc";
import { formatDateTime, todayIn } from "@/lib/format";
import { RESERVATION_STATUS } from "@/lib/labels";
import { useOrganization, useOrgId } from "@/hooks/useOrganization";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { QueryErrorState } from "@/components/QueryErrorState";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import type { AreaReservation, ReservationStatus } from "@/types/domain";
import { ReservationFormDialog } from "./ReservationFormDialog";

const ALL = "__all__";
const UPCOMING = "__upcoming__";
const FILTERS: { value: string; label: string }[] = [
  { value: UPCOMING, label: "Próximas" },
  { value: "pending_approval", label: "Por aprobar" },
  { value: ALL, label: "Todas" }
];

export function ReservationsPage() {
  const orgId = useOrgId();
  const { can } = useOrganization();
  const canWrite = can("reservations.write");
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState(UPCOMING);
  const [createOpen, setCreateOpen] = useState(false);
  const [rejecting, setRejecting] = useState<AreaReservation | null>(null);
  const [cancelling, setCancelling] = useState<AreaReservation | null>(null);

  const { data: reservations = [], isLoading, isError, refetch } = useQuery({
    queryKey: ["reservations", orgId, filter],
    enabled: !!orgId,
    queryFn: async () => {
      let query = insforge.database
        .from("area_reservations")
        .select("*, common_areas(name), units(code), persons(full_name)")
        .eq("organization_id", orgId)
        .order("start_at", { ascending: filter !== ALL });
      if (filter === UPCOMING) query = query.gte("start_at", `${todayIn()}T00:00:00Z`).in("status", ["pending_approval", "confirmed"]);
      else if (filter !== ALL) query = query.eq("status", filter as ReservationStatus);
      const { data, error } = await query.limit(200);
      if (error) throw error;
      return data as unknown as AreaReservation[];
    }
  });

  async function approve(id: string) {
    try {
      await rpc("decide_area_reservation", { p_reservation_id: id, p_approve: true, p_reason: null });
      toast.success("Reserva aprobada.");
      await queryClient.invalidateQueries({ queryKey: ["reservations", orgId] });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function reject(reason: string) {
    if (!rejecting) return;
    await rpc("decide_area_reservation", { p_reservation_id: rejecting.id, p_approve: false, p_reason: reason });
    toast.success("Reserva rechazada.");
    await queryClient.invalidateQueries({ queryKey: ["reservations", orgId] });
  }

  async function cancel(reason: string) {
    if (!cancelling) return;
    await rpc("cancel_area_reservation", { p_reservation_id: cancelling.id, p_reason: reason || null });
    toast.success("Reserva cancelada.");
    await queryClient.invalidateQueries({ queryKey: ["reservations", orgId] });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reservas"
        description="Reservas de zonas comunes creadas por residentes o por el equipo."
        actions={canWrite && <Button onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" aria-hidden /> Nueva reserva</Button>}
      />

      <Select value={filter} onValueChange={setFilter}>
        <SelectTrigger className="w-48" aria-label="Filtrar reservas"><SelectValue /></SelectTrigger>
        <SelectContent>{FILTERS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}</SelectContent>
      </Select>

      {isError ? (
        <QueryErrorState onRetry={() => refetch()} message="No se pudieron cargar las reservas." />
      ) : isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : reservations.length === 0 ? (
        <EmptyState icon={CalendarDays} title="No hay reservas en este filtro" />
      ) : (
        <Card className="overflow-x-auto">
          <table className="table-base">
            <thead><tr><th>Zona</th><th>Unidad</th><th>Fecha</th><th>Estado</th><th /></tr></thead>
            <tbody>
              {reservations.map((r) => (
                <tr key={r.id}>
                  <td className="font-medium">{r.common_areas?.name}</td>
                  <td>{r.units?.code}{r.persons?.full_name ? <span className="text-muted-foreground"> · {r.persons.full_name}</span> : ""}</td>
                  <td>{formatDateTime(r.start_at)}</td>
                  <td><Badge variant={RESERVATION_STATUS[r.status].variant}>{RESERVATION_STATUS[r.status].label}</Badge></td>
                  <td>
                    {canWrite && r.status === "pending_approval" && (
                      <div className="flex gap-1">
                        <Button size="sm" onClick={() => approve(r.id)}><CheckCircle2 className="h-4 w-4" aria-hidden /> Aprobar</Button>
                        <Button size="sm" variant="destructive" onClick={() => setRejecting(r)}><XCircle className="h-4 w-4" aria-hidden /> Rechazar</Button>
                      </div>
                    )}
                    {canWrite && r.status === "confirmed" && new Date(r.start_at) > new Date() && (
                      <Button size="sm" variant="ghost" onClick={() => setCancelling(r)}>Cancelar</Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <ReservationFormDialog open={createOpen} onOpenChange={setCreateOpen} />
      <ConfirmDialog open={!!rejecting} onOpenChange={(o) => !o && setRejecting(null)} title="Rechazar reserva" confirmLabel="Rechazar" destructive reasonLabel="Motivo" onConfirm={reject} />
      <ConfirmDialog open={!!cancelling} onOpenChange={(o) => !o && setCancelling(null)} title="Cancelar reserva" confirmLabel="Cancelar reserva" destructive reasonLabel="Motivo (opcional)" reasonRequired={false} onConfirm={cancel} />
    </div>
  );
}
