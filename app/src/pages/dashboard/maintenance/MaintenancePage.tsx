import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarClock, Plus, Truck, Wrench } from "lucide-react";
import { insforge } from "@/lib/insforgeClient";
import { errorMessage, rpc } from "@/lib/rpc";
import { formatDate } from "@/lib/format";
import { ASSET_CATEGORY_LABELS, ASSET_STATUS_LABELS, WORK_ORDER_PRIORITY, WORK_ORDER_STATUS } from "@/lib/labels";
import { useOrganization, useOrgId } from "@/hooks/useOrganization";
import { useAssets, useVendors } from "@/hooks/useCatalogs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { QueryErrorState } from "@/components/QueryErrorState";
import type { Asset, MaintenanceSchedule, Vendor, WorkOrder } from "@/types/domain";
import { CreateWorkOrderDialog } from "./CreateWorkOrderDialog";
import { WorkOrderDetailDialog } from "./WorkOrderDetailDialog";
import { AssetFormDialog } from "./AssetFormDialog";
import { VendorFormDialog } from "./VendorFormDialog";
import { MaintenanceScheduleFormDialog } from "./MaintenanceScheduleFormDialog";

export function MaintenancePage() {
  const orgId = useOrgId();
  const { can } = useOrganization();
  const canWrite = can("maintenance.write");
  const queryClient = useQueryClient();

  const [createWorkOrderOpen, setCreateWorkOrderOpen] = useState(false);
  const [selectedWorkOrderId, setSelectedWorkOrderId] = useState<string | null>(null);
  const [assetDialog, setAssetDialog] = useState<{ open: boolean; asset?: Asset | null }>({ open: false });
  const [vendorDialog, setVendorDialog] = useState<{ open: boolean; vendor?: Vendor | null }>({ open: false });
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);

  const { data: workOrders = [], isLoading: loadingOrders, isError: errorOrders, refetch: refetchOrders } = useQuery({
    queryKey: ["work-orders", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await insforge.database
        .from("work_orders")
        .select("*, assets(name), vendors(name), pqrs_tickets(radicado)")
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false })
        .limit(300);
      if (error) throw error;
      return data as unknown as WorkOrder[];
    }
  });

  const { data: assets = [], isLoading: loadingAssets, isError: errorAssets, refetch: refetchAssets } = useAssets();
  const { data: vendors = [], isLoading: loadingVendors, isError: errorVendors, refetch: refetchVendors } = useVendors();

  const { data: schedules = [], isLoading: loadingSchedules, isError: errorSchedules, refetch: refetchSchedules } = useQuery({
    queryKey: ["maintenance-schedules", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await insforge.database
        .from("maintenance_schedules")
        .select("*, assets(name)")
        .eq("organization_id", orgId)
        .eq("is_active", true)
        .order("next_due_on", { ascending: true });
      if (error) throw error;
      return data as unknown as MaintenanceSchedule[];
    }
  });

  const openOrders = workOrders.filter((w) => w.status !== "closed" && w.status !== "cancelled");

  async function markScheduleDone(schedule: MaintenanceSchedule) {
    try {
      await rpc("mark_maintenance_schedule_done", { p_schedule_id: schedule.id });
      toast.success("Marcado como ejecutado. Próxima fecha actualizada.");
      await queryClient.invalidateQueries({ queryKey: ["maintenance-schedules", orgId] });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Mantenimiento"
        description="Activos, proveedores y órdenes de trabajo: reporte, diagnóstico, aprobación, ejecución y cierre, con historial de garantías."
      />

      <Tabs defaultValue="orders">
        <TabsList>
          <TabsTrigger value="orders">Órdenes {openOrders.length > 0 ? `(${openOrders.length})` : ""}</TabsTrigger>
          <TabsTrigger value="assets">Activos</TabsTrigger>
          <TabsTrigger value="vendors">Proveedores</TabsTrigger>
          <TabsTrigger value="schedules">Preventivo</TabsTrigger>
        </TabsList>

        <TabsContent value="orders" className="space-y-4">
          <div className="flex justify-end">
            {canWrite && <Button onClick={() => setCreateWorkOrderOpen(true)}><Plus className="h-4 w-4" aria-hidden /> Reportar daño</Button>}
          </div>
          {errorOrders ? (
            <QueryErrorState onRetry={() => refetchOrders()} message="No se pudieron cargar las órdenes de trabajo." />
          ) : loadingOrders ? (
            <Skeleton className="h-64 w-full" />
          ) : workOrders.length === 0 ? (
            <EmptyState
              icon={Wrench}
              title="Aún no hay órdenes de trabajo"
              description="Reporta un daño (ascensor, bomba de agua, portón) o enlázalo desde una PQRS de categoría Mantenimiento."
            />
          ) : (
            <Card className="overflow-x-auto">
              <table className="table-base">
                <thead><tr><th>Código</th><th>Título</th><th>Activo</th><th>Prioridad</th><th>Estado</th><th>Reportada</th></tr></thead>
                <tbody>
                  {workOrders.map((w) => (
                    <tr key={w.id} className="cursor-pointer" onClick={() => setSelectedWorkOrderId(w.id)}>
                      <td className="font-medium">{w.code}</td>
                      <td className="max-w-xs truncate">{w.title}</td>
                      <td>{w.assets?.name ?? "—"}</td>
                      <td><Badge variant={WORK_ORDER_PRIORITY[w.priority].variant}>{WORK_ORDER_PRIORITY[w.priority].label}</Badge></td>
                      <td><Badge variant={WORK_ORDER_STATUS[w.status].variant}>{WORK_ORDER_STATUS[w.status].label}</Badge></td>
                      <td>{formatDate(w.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="assets" className="space-y-4">
          <div className="flex justify-end">
            {canWrite && <Button onClick={() => setAssetDialog({ open: true, asset: null })}><Plus className="h-4 w-4" aria-hidden /> Nuevo activo</Button>}
          </div>
          {errorAssets ? (
            <QueryErrorState onRetry={() => refetchAssets()} message="No se pudieron cargar los activos." />
          ) : loadingAssets ? (
            <Skeleton className="h-64 w-full" />
          ) : assets.length === 0 ? (
            <EmptyState icon={Wrench} title="Aún no hay activos registrados" description="Ascensores, bombas de agua, plantas eléctricas, portones..." />
          ) : (
            <Card className="overflow-x-auto">
              <table className="table-base">
                <thead><tr><th>Nombre</th><th>Categoría</th><th>Ubicación</th><th>Garantía</th><th>Estado</th></tr></thead>
                <tbody>
                  {assets.map((a) => (
                    <tr key={a.id} className="cursor-pointer" onClick={() => canWrite && setAssetDialog({ open: true, asset: a })}>
                      <td className="font-medium">{a.name}</td>
                      <td>{ASSET_CATEGORY_LABELS[a.category]}</td>
                      <td>{a.location ?? "—"}</td>
                      <td>{a.warranty_expires_on ? formatDate(a.warranty_expires_on) : "—"}</td>
                      <td><Badge variant={a.status === "active" ? "success" : "muted"}>{ASSET_STATUS_LABELS[a.status]}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="vendors" className="space-y-4">
          <div className="flex justify-end">
            {canWrite && <Button onClick={() => setVendorDialog({ open: true, vendor: null })}><Plus className="h-4 w-4" aria-hidden /> Nuevo proveedor</Button>}
          </div>
          {errorVendors ? (
            <QueryErrorState onRetry={() => refetchVendors()} message="No se pudieron cargar los proveedores." />
          ) : loadingVendors ? (
            <Skeleton className="h-64 w-full" />
          ) : vendors.length === 0 ? (
            <EmptyState icon={Truck} title="Aún no hay proveedores" description="Contactos externos que ejecutan reparaciones y mantenimientos." />
          ) : (
            <Card className="overflow-x-auto">
              <table className="table-base">
                <thead><tr><th>Nombre</th><th>Especialidad</th><th>Teléfono</th><th>Correo</th><th>Estado</th></tr></thead>
                <tbody>
                  {vendors.map((v) => (
                    <tr key={v.id} className="cursor-pointer" onClick={() => canWrite && setVendorDialog({ open: true, vendor: v })}>
                      <td className="font-medium">{v.name}</td>
                      <td>{v.specialty ?? "—"}</td>
                      <td>{v.phone ?? "—"}</td>
                      <td>{v.email ?? "—"}</td>
                      <td><Badge variant={v.is_active ? "success" : "muted"}>{v.is_active ? "Activo" : "Inactivo"}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="schedules" className="space-y-4">
          <div className="flex justify-end">
            {canWrite && <Button onClick={() => setScheduleDialogOpen(true)}><Plus className="h-4 w-4" aria-hidden /> Nuevo cronograma</Button>}
          </div>
          {errorSchedules ? (
            <QueryErrorState onRetry={() => refetchSchedules()} message="No se pudieron cargar los cronogramas." />
          ) : loadingSchedules ? (
            <Skeleton className="h-64 w-full" />
          ) : schedules.length === 0 ? (
            <EmptyState
              icon={CalendarClock}
              title="Aún no hay mantenimiento preventivo programado"
              description="Ej. revisión mensual del ascensor, mantenimiento trimestral de la planta eléctrica."
            />
          ) : (
            <Card className="overflow-x-auto">
              <table className="table-base">
                <thead><tr><th>Título</th><th>Activo</th><th>Frecuencia</th><th>Próxima fecha</th><th>Última ejecución</th>{canWrite && <th />}</tr></thead>
                <tbody>
                  {schedules.map((s) => {
                    const overdue = new Date(s.next_due_on) < new Date();
                    return (
                      <tr key={s.id}>
                        <td className="font-medium">{s.title}</td>
                        <td>{s.assets?.name ?? "—"}</td>
                        <td>Cada {s.frequency_months} {s.frequency_months === 1 ? "mes" : "meses"}</td>
                        <td className={overdue ? "font-medium text-destructive" : ""}>{formatDate(s.next_due_on)}</td>
                        <td>{s.last_done_on ? formatDate(s.last_done_on) : "—"}</td>
                        {canWrite && (
                          <td>
                            <Button size="sm" variant="outline" onClick={() => markScheduleDone(s)}>Marcar ejecutado</Button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      <CreateWorkOrderDialog open={createWorkOrderOpen} onOpenChange={setCreateWorkOrderOpen} />
      <WorkOrderDetailDialog workOrderId={selectedWorkOrderId} onOpenChange={(open) => !open && setSelectedWorkOrderId(null)} />
      <AssetFormDialog open={assetDialog.open} onOpenChange={(open) => setAssetDialog({ open, asset: open ? assetDialog.asset : null })} asset={assetDialog.asset} />
      <VendorFormDialog open={vendorDialog.open} onOpenChange={(open) => setVendorDialog({ open, vendor: open ? vendorDialog.vendor : null })} vendor={vendorDialog.vendor} />
      <MaintenanceScheduleFormDialog open={scheduleDialogOpen} onOpenChange={setScheduleDialogOpen} />
    </div>
  );
}
