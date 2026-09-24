import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { LogIn, LogOut, Package, ShieldAlert, UserPlus } from "lucide-react";
import { insforge } from "@/lib/insforgeClient";
import { errorMessage, rpc } from "@/lib/rpc";
import { formatDateTime, formatRelative } from "@/lib/format";
import { GATE_NOTE_CATEGORY_LABELS, PACKAGE_STATUS, VISITOR_AUTH_STATUS, VISITOR_LOG_KIND_LABELS } from "@/lib/labels";
import { useOrganization, useOrgId } from "@/hooks/useOrganization";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { QueryErrorState } from "@/components/QueryErrorState";
import type { GateNote, PackageRow, VisitorAuthorization, VisitorLog } from "@/types/domain";
import { RegisterVisitorDialog } from "./RegisterVisitorDialog";
import { RegisterPackageDialog } from "./RegisterPackageDialog";
import { AddGateNoteDialog } from "./AddGateNoteDialog";

/** Portería: interfaz de máxima velocidad, sin filtros complejos. Búsqueda rápida por unidad, registro en dos clics. */
export function GatehousePage() {
  const orgId = useOrgId();
  const { can } = useOrganization();
  const queryClient = useQueryClient();
  const canWrite = can("porteria.write");
  const [registerVisitorOpen, setRegisterVisitorOpen] = useState(false);
  const [registerPackageOpen, setRegisterPackageOpen] = useState(false);
  const [addNoteOpen, setAddNoteOpen] = useState(false);

  const authorizations = useQuery({
    queryKey: ["visitor-authorizations", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await insforge.database
        .from("visitor_authorizations")
        .select("*, units(code)")
        .eq("organization_id", orgId)
        .in("status", ["pending", "used"])
        .order("valid_from", { ascending: true })
        .limit(100);
      if (error) throw error;
      return data as unknown as VisitorAuthorization[];
    }
  });

  const openVisits = useQuery({
    queryKey: ["visitor-logs-open", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await insforge.database
        .from("visitor_logs")
        .select("*, units(code)")
        .eq("organization_id", orgId)
        .is("exit_at", null)
        .order("entry_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data as unknown as VisitorLog[];
    }
  });

  const packages = useQuery({
    queryKey: ["packages-pending", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await insforge.database
        .from("packages")
        .select("*, units(code)")
        .eq("organization_id", orgId)
        .eq("status", "received")
        .order("received_at", { ascending: false })
        .limit(150);
      if (error) throw error;
      return data as unknown as PackageRow[];
    }
  });

  const notes = useQuery({
    queryKey: ["gate-notes", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await insforge.database
        .from("gate_notes")
        .select("*")
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data as unknown as GateNote[];
    }
  });

  async function invalidateAll() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["visitor-authorizations", orgId] }),
      queryClient.invalidateQueries({ queryKey: ["visitor-logs-open", orgId] })
    ]);
  }

  async function registerExit(logId: string) {
    try {
      await rpc("register_visitor_exit", { p_visitor_log_id: logId });
      toast.success("Salida registrada.");
      await invalidateAll();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function deliverPackage(packageId: string) {
    const name = window.prompt("¿A nombre de quién se entrega? (opcional)") ?? undefined;
    try {
      await rpc("deliver_package", { p_package_id: packageId, p_delivered_to_name: name || null });
      toast.success("Paquete entregado.");
      await queryClient.invalidateQueries({ queryKey: ["packages-pending", orgId] });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Portería"
        description="Visitantes, paquetes y novedades, en tiempo real."
        actions={
          canWrite && (
            <>
              <Button variant="outline" onClick={() => setAddNoteOpen(true)}>
                <ShieldAlert className="h-4 w-4" aria-hidden /> Novedad
              </Button>
              <Button variant="outline" onClick={() => setRegisterPackageOpen(true)}>
                <Package className="h-4 w-4" aria-hidden /> Paquete
              </Button>
              <Button onClick={() => setRegisterVisitorOpen(true)}>
                <UserPlus className="h-4 w-4" aria-hidden /> Registrar visitante
              </Button>
            </>
          )
        }
      />

      <Tabs defaultValue="visitors">
        <TabsList>
          <TabsTrigger value="visitors">
            Visitantes {openVisits.data && openVisits.data.length > 0 ? `(${openVisits.data.length} dentro)` : ""}
          </TabsTrigger>
          <TabsTrigger value="packages">Paquetes {packages.data && packages.data.length > 0 ? `(${packages.data.length})` : ""}</TabsTrigger>
          <TabsTrigger value="notes">Novedades</TabsTrigger>
        </TabsList>

        <TabsContent value="visitors" className="space-y-6">
          <div>
            <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Dentro del conjunto ahora</h2>
            {openVisits.isError ? (
              <QueryErrorState onRetry={() => openVisits.refetch()} message="No se pudieron cargar los visitantes." />
            ) : openVisits.isLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : openVisits.data!.length === 0 ? (
              <EmptyState icon={LogIn} title="Nadie registrado como visitante en este momento" />
            ) : (
              <Card className="overflow-x-auto">
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>Visitante</th><th>Unidad</th><th>Tipo</th><th>Placa</th><th>Ingresó</th><th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {openVisits.data!.map((v) => (
                      <tr key={v.id}>
                        <td className="font-medium">{v.visitor_name}</td>
                        <td>{v.units?.code ?? "—"}</td>
                        <td>{VISITOR_LOG_KIND_LABELS[v.kind]}</td>
                        <td>{v.vehicle_plate ?? "—"}</td>
                        <td>{formatRelative(v.entry_at)}</td>
                        <td>
                          {canWrite && (
                            <Button size="sm" variant="outline" onClick={() => registerExit(v.id)}>
                              <LogOut className="h-3.5 w-3.5" aria-hidden /> Salida
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            )}
          </div>

          <div>
            <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Autorizaciones vigentes</h2>
            {authorizations.isError ? (
              <QueryErrorState onRetry={() => authorizations.refetch()} message="No se pudieron cargar las autorizaciones." />
            ) : authorizations.isLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : authorizations.data!.length === 0 ? (
              <EmptyState icon={UserPlus} title="No hay autorizaciones de visitantes activas" />
            ) : (
              <Card className="overflow-x-auto">
                <table className="table-base">
                  <thead>
                    <tr><th>Visitante</th><th>Unidad</th><th>Ventana</th><th>Placa</th><th>Estado</th></tr>
                  </thead>
                  <tbody>
                    {authorizations.data!.map((a) => (
                      <tr key={a.id}>
                        <td className="font-medium">{a.visitor_name}</td>
                        <td>{a.units?.code ?? "—"}</td>
                        <td>
                          {formatDateTime(a.valid_from)} – {formatDateTime(a.valid_until)}
                        </td>
                        <td>{a.vehicle_plate ?? "—"}</td>
                        <td><Badge variant={VISITOR_AUTH_STATUS[a.status].variant}>{VISITOR_AUTH_STATUS[a.status].label}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            )}
          </div>
        </TabsContent>

        <TabsContent value="packages">
          {packages.isError ? (
            <QueryErrorState onRetry={() => packages.refetch()} message="No se pudieron cargar los paquetes." />
          ) : packages.isLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : packages.data!.length === 0 ? (
            <EmptyState icon={Package} title="No hay paquetes por reclamar" />
          ) : (
            <Card className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr><th>Unidad</th><th>Transportadora</th><th>Descripción</th><th>Recibido</th><th>Estado</th><th></th></tr>
                </thead>
                <tbody>
                  {packages.data!.map((p) => (
                    <tr key={p.id}>
                      <td className="font-medium">{p.units?.code ?? "—"}</td>
                      <td>{p.courier ?? "—"}</td>
                      <td className="max-w-xs truncate">{p.description ?? "—"}</td>
                      <td>{formatRelative(p.received_at)}</td>
                      <td><Badge variant={PACKAGE_STATUS[p.status].variant}>{PACKAGE_STATUS[p.status].label}</Badge></td>
                      <td>
                        {canWrite && (
                          <Button size="sm" variant="outline" onClick={() => deliverPackage(p.id)}>
                            Entregar
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="notes">
          {notes.isError ? (
            <QueryErrorState onRetry={() => notes.refetch()} message="No se pudieron cargar las novedades." />
          ) : notes.isLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : notes.data!.length === 0 ? (
            <EmptyState icon={ShieldAlert} title="Sin novedades registradas" />
          ) : (
            <div className="space-y-3">
              {notes.data!.map((n) => (
                <Card key={n.id} className="p-4">
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant="default">{GATE_NOTE_CATEGORY_LABELS[n.category]}</Badge>
                    <span className="text-xs text-muted-foreground">{formatDateTime(n.created_at)}{n.shift ? ` · Turno ${n.shift}` : ""}</span>
                  </div>
                  <p className="mt-2 text-sm">{n.note}</p>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <RegisterVisitorDialog open={registerVisitorOpen} onOpenChange={setRegisterVisitorOpen} authorizations={authorizations.data ?? []} />
      <RegisterPackageDialog open={registerPackageOpen} onOpenChange={setRegisterPackageOpen} />
      <AddGateNoteDialog open={addNoteOpen} onOpenChange={setAddNoteOpen} />
    </div>
  );
}
