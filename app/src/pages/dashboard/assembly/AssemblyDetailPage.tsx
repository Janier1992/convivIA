import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, ClipboardList, FileCheck2, Users, Vote as VoteIcon } from "lucide-react";
import { insforge } from "@/lib/insforgeClient";
import { errorMessage, rpc } from "@/lib/rpc";
import { formatDateTime, formatNumber } from "@/lib/format";
import { ASSEMBLY_STATUS, ASSEMBLY_TYPE_LABELS, VOTE_CHOICE_LABELS } from "@/lib/labels";
import { useOrganization } from "@/hooks/useOrganization";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { QueryErrorState } from "@/components/QueryErrorState";
import type {
  Assembly,
  AssemblyAgendaItem,
  AssemblyQuorum,
  DocumentRow,
  VoteChoice,
  VoteResults
} from "@/types/domain";
import { AddAgendaItemDialog } from "./AddAgendaItemDialog";
import { RegisterProxyDialog } from "./RegisterProxyDialog";
import { CheckInUnitDialog } from "./CheckInUnitDialog";

interface AttendeeRow {
  id: string;
  unit_id: string;
  unit_code: string;
  full_name: string;
  proxy_id: string | null;
  coefficient_pct: number;
  checked_in_at: string;
}

interface ProxyListRow {
  id: string;
  unit_id: string;
  unit_code: string;
  grantor_name: string;
  attorney_person_id: string;
  attorney_name: string;
  status: "accepted" | "revoked";
}

interface VoteRow {
  unit_id: string;
  choice: VoteChoice;
  coefficient_pct: number;
}

function QuorumBar({ pct, requiredPct }: { pct: number; requiredPct: number }) {
  const reached = pct >= requiredPct;
  return (
    <div className="space-y-1">
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full ${reached ? "bg-success" : "bg-accent"}`}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        {formatNumber(pct)}% presente de {formatNumber(requiredPct)}% requerido {reached ? "· quórum alcanzado" : ""}
      </p>
    </div>
  );
}

export function AssemblyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useOrganization();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canWrite = can("assembly.write");

  const [addItemOpen, setAddItemOpen] = useState(false);
  const [proxyOpen, setProxyOpen] = useState(false);
  const [checkInOpen, setCheckInOpen] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [minutesDocId, setMinutesDocId] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const assembly = useQuery({
    queryKey: ["assembly", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await insforge.database.from("assemblies").select("*").eq("id", id).single();
      if (error) throw error;
      return data as Assembly;
    }
  });

  const agendaItems = useQuery({
    queryKey: ["assembly-agenda", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await insforge.database
        .from("assembly_agenda_items")
        .select("*")
        .eq("assembly_id", id)
        .order("position", { ascending: true });
      if (error) throw error;
      return data as AssemblyAgendaItem[];
    }
  });

  const proxies = useQuery({
    queryKey: ["assembly-proxies", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await insforge.database.rpc("get_assembly_proxies", { p_assembly_id: id });
      if (error) throw error;
      return data as ProxyListRow[];
    }
  });

  const attendees = useQuery({
    queryKey: ["assembly-attendees", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await insforge.database.rpc("get_assembly_attendees", { p_assembly_id: id });
      if (error) throw error;
      return data as AttendeeRow[];
    }
  });

  const quorum = useQuery({
    queryKey: ["assembly-quorum", id],
    enabled: !!id,
    queryFn: async () => rpc<AssemblyQuorum>("get_assembly_quorum", { p_assembly_id: id })
  });

  const minutesCandidates = useQuery({
    queryKey: ["assembly-minutes-docs", assembly.data?.organization_id],
    enabled: !!assembly.data?.organization_id && can("documents.read"),
    queryFn: async () => {
      const { data, error } = await insforge.database
        .from("documents")
        .select("id, title, status")
        .eq("organization_id", assembly.data!.organization_id)
        .eq("doc_type", "assembly_minutes")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data as unknown as DocumentRow[];
    }
  });

  const votes = useQuery({
    queryKey: ["assembly-votes", selectedItemId],
    enabled: !!selectedItemId,
    queryFn: async () => {
      const { data, error } = await insforge.database
        .from("votes")
        .select("unit_id, choice, coefficient_pct")
        .eq("agenda_item_id", selectedItemId);
      if (error) throw error;
      return data as unknown as VoteRow[];
    }
  });

  const voteResults = useQuery({
    queryKey: ["assembly-vote-results", selectedItemId],
    enabled: !!selectedItemId,
    queryFn: async () => rpc<VoteResults>("get_vote_results", { p_agenda_item_id: selectedItemId })
  });

  async function refreshAll() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["assembly-agenda", id] }),
      queryClient.invalidateQueries({ queryKey: ["assembly-proxies", id] }),
      queryClient.invalidateQueries({ queryKey: ["assembly-attendees", id] }),
      queryClient.invalidateQueries({ queryKey: ["assembly-quorum", id] })
    ]);
  }

  async function transition(action: "start_assembly" | "close_assembly" | "cancel_assembly") {
    setBusy(true);
    try {
      await rpc(action, { p_assembly_id: id });
      toast.success("Actualizado.");
      await queryClient.invalidateQueries({ queryKey: ["assembly", id] });
      await refreshAll();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function revokeProxy(proxyId: string) {
    setBusy(true);
    try {
      await rpc("revoke_proxy", { p_proxy_id: proxyId });
      toast.success("Poder anulado.");
      await queryClient.invalidateQueries({ queryKey: ["assembly-proxies", id] });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function removeAttendee(attendeeId: string) {
    setBusy(true);
    try {
      await rpc("remove_attendee", { p_attendee_id: attendeeId });
      toast.success("Asistencia retirada.");
      await refreshAll();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function castVote(unitId: string, choice: VoteChoice) {
    if (!selectedItemId) return;
    setBusy(true);
    try {
      await rpc("cast_vote", { p_assembly_id: id, p_agenda_item_id: selectedItemId, p_unit_id: unitId, p_choice: choice });
      toast.success("Voto registrado.");
      await queryClient.invalidateQueries({ queryKey: ["assembly-votes", selectedItemId] });
      await queryClient.invalidateQueries({ queryKey: ["assembly-vote-results", selectedItemId] });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function saveMinutes() {
    if (!minutesDocId) return;
    setBusy(true);
    try {
      await rpc("set_assembly_minutes", { p_assembly_id: id, p_document_id: minutesDocId });
      toast.success("Acta vinculada.");
      await queryClient.invalidateQueries({ queryKey: ["assembly", id] });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (assembly.isError) {
    return <QueryErrorState onRetry={() => assembly.refetch()} message="No se pudo cargar la asamblea." />;
  }
  if (!assembly.data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const a = assembly.data;
  const votingItems = (agendaItems.data ?? []).filter((i) => i.requires_vote);
  const selectedItem = agendaItems.data?.find((i) => i.id === selectedItemId) ?? null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={a.title}
        description={`${ASSEMBLY_TYPE_LABELS[a.assembly_type]} · ${formatDateTime(a.scheduled_at)}${a.location ? ` · ${a.location}` : ""}`}
        actions={
          <>
            <Badge variant={ASSEMBLY_STATUS[a.status].variant}>{ASSEMBLY_STATUS[a.status].label}</Badge>
            {canWrite && a.status === "draft" && (
              <Button size="sm" onClick={() => transition("start_assembly")} disabled={busy}>Iniciar</Button>
            )}
            {canWrite && a.status === "in_progress" && (
              <Button size="sm" onClick={() => transition("close_assembly")} disabled={busy}>Cerrar asamblea</Button>
            )}
            {canWrite && (a.status === "draft" || a.status === "in_progress") && (
              <Button size="sm" variant="outline" onClick={() => transition("cancel_assembly")} disabled={busy}>Cancelar</Button>
            )}
            <Button size="sm" variant="outline" onClick={() => navigate("/dashboard/assembly")}>Volver</Button>
          </>
        }
      />

      <Card className="p-4">
        {quorum.isLoading ? (
          <Skeleton className="h-8 w-full" />
        ) : quorum.data ? (
          <QuorumBar pct={quorum.data.present_coefficient_pct} requiredPct={quorum.data.first_call_quorum_pct} />
        ) : null}
      </Card>

      <Tabs defaultValue="agenda">
        <TabsList>
          <TabsTrigger value="agenda">Orden del día</TabsTrigger>
          <TabsTrigger value="proxies">Poderes {proxies.data && proxies.data.length > 0 ? `(${proxies.data.length})` : ""}</TabsTrigger>
          <TabsTrigger value="attendance">Asistencia {attendees.data && attendees.data.length > 0 ? `(${attendees.data.length})` : ""}</TabsTrigger>
          <TabsTrigger value="voting">Votación</TabsTrigger>
          <TabsTrigger value="minutes">Acta</TabsTrigger>
        </TabsList>

        <TabsContent value="agenda" className="space-y-4">
          {canWrite && (
            <div className="flex justify-end">
              <Button size="sm" onClick={() => setAddItemOpen(true)} disabled={a.status === "closed" || a.status === "cancelled"}>
                <ClipboardList className="h-4 w-4" aria-hidden /> Agregar punto
              </Button>
            </div>
          )}
          {agendaItems.isError ? (
            <QueryErrorState onRetry={() => agendaItems.refetch()} message="No se pudo cargar el orden del día." />
          ) : agendaItems.isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : agendaItems.data!.length === 0 ? (
            <EmptyState icon={ClipboardList} title="Todavía no hay puntos en el orden del día" />
          ) : (
            <div className="space-y-2">
              {agendaItems.data!.map((item) => (
                <Card key={item.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{item.position}. {item.title}</p>
                      {item.description && <p className="mt-1 text-sm text-muted-foreground">{item.description}</p>}
                    </div>
                    {item.requires_vote && <Badge variant="accent">Requiere votación</Badge>}
                  </div>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="proxies" className="space-y-4">
          {canWrite && (
            <div className="flex justify-end">
              <Button size="sm" onClick={() => setProxyOpen(true)} disabled={a.status === "closed" || a.status === "cancelled"}>
                <Users className="h-4 w-4" aria-hidden /> Registrar poder
              </Button>
            </div>
          )}
          {proxies.isError ? (
            <QueryErrorState onRetry={() => proxies.refetch()} message="No se pudieron cargar los poderes." />
          ) : proxies.isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : proxies.data!.length === 0 ? (
            <EmptyState icon={Users} title="No hay poderes registrados en esta asamblea" />
          ) : (
            <Card className="overflow-x-auto">
              <table className="table-base">
                <thead><tr><th>Unidad</th><th>Otorga</th><th>Apoderado</th><th>Estado</th><th></th></tr></thead>
                <tbody>
                  {proxies.data!.map((p) => (
                    <tr key={p.id}>
                      <td className="font-medium">{p.unit_code}</td>
                      <td>{p.grantor_name}</td>
                      <td>{p.attorney_name}</td>
                      <td><Badge variant={p.status === "accepted" ? "success" : "muted"}>{p.status === "accepted" ? "Vigente" : "Anulado"}</Badge></td>
                      <td>
                        {canWrite && p.status === "accepted" && (
                          <Button size="sm" variant="outline" onClick={() => revokeProxy(p.id)} disabled={busy}>Anular</Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="attendance" className="space-y-4">
          {canWrite && (
            <div className="flex justify-end">
              <Button size="sm" onClick={() => setCheckInOpen(true)} disabled={a.status === "closed" || a.status === "cancelled"}>
                <CheckCircle2 className="h-4 w-4" aria-hidden /> Registrar asistencia
              </Button>
            </div>
          )}
          {attendees.isError ? (
            <QueryErrorState onRetry={() => attendees.refetch()} message="No se pudo cargar la asistencia." />
          ) : attendees.isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : attendees.data!.length === 0 ? (
            <EmptyState icon={CheckCircle2} title="Todavía no hay unidades registradas como presentes" />
          ) : (
            <Card className="overflow-x-auto">
              <table className="table-base">
                <thead><tr><th>Unidad</th><th>Presente</th><th>Coeficiente</th><th>Con poder</th><th>Ingresó</th><th></th></tr></thead>
                <tbody>
                  {attendees.data!.map((r) => (
                    <tr key={r.id}>
                      <td className="font-medium">{r.unit_code}</td>
                      <td>{r.full_name}</td>
                      <td>{formatNumber(r.coefficient_pct)}%</td>
                      <td>{r.proxy_id ? <Badge variant="accent">Sí</Badge> : "—"}</td>
                      <td>{formatDateTime(r.checked_in_at)}</td>
                      <td>
                        {canWrite && (
                          <Button size="sm" variant="outline" onClick={() => removeAttendee(r.id)} disabled={busy}>Quitar</Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="voting" className="space-y-4">
          {votingItems.length === 0 ? (
            <EmptyState icon={VoteIcon} title="Ningún punto del orden del día requiere votación" />
          ) : (
            <>
              <div className="max-w-md space-y-1.5">
                <Select value={selectedItemId ?? ""} onValueChange={setSelectedItemId}>
                  <SelectTrigger><SelectValue placeholder="Elige un punto para votar" /></SelectTrigger>
                  <SelectContent>
                    {votingItems.map((i) => <SelectItem key={i.id} value={i.id}>{i.position}. {i.title}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              {selectedItem && (
                <>
                  {voteResults.data && (
                    <Card className="grid grid-cols-3 gap-4 p-4 text-center">
                      <div><p className="text-lg font-bold">{formatNumber(voteResults.data.a_favor_pct)}%</p><p className="text-xs text-muted-foreground">A favor ({voteResults.data.a_favor_count})</p></div>
                      <div><p className="text-lg font-bold">{formatNumber(voteResults.data.en_contra_pct)}%</p><p className="text-xs text-muted-foreground">En contra ({voteResults.data.en_contra_count})</p></div>
                      <div><p className="text-lg font-bold">{formatNumber(voteResults.data.abstencion_pct)}%</p><p className="text-xs text-muted-foreground">Abstención ({voteResults.data.abstencion_count})</p></div>
                    </Card>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Cifras crudas por coeficiente. El tipo de mayoría requerida depende del reglamento y del tema: quien preside la
                    asamblea certifica el resultado en el acta, no este panel.
                  </p>

                  {attendees.isLoading ? (
                    <Skeleton className="h-32 w-full" />
                  ) : attendees.data!.length === 0 ? (
                    <EmptyState icon={Users} title="Registra primero la asistencia para poder votar" />
                  ) : (
                    <Card className="overflow-x-auto">
                      <table className="table-base">
                        <thead><tr><th>Unidad</th><th>Coeficiente</th><th>Voto</th></tr></thead>
                        <tbody>
                          {attendees.data!.map((r) => {
                            const vote = votes.data?.find((v) => v.unit_id === r.unit_id);
                            return (
                              <tr key={r.id}>
                                <td className="font-medium">{r.unit_code}</td>
                                <td>{formatNumber(r.coefficient_pct)}%</td>
                                <td>
                                  {canWrite && a.status === "in_progress" ? (
                                    <div className="flex flex-wrap gap-1.5">
                                      {(["a_favor", "en_contra", "abstencion"] as VoteChoice[]).map((choice) => (
                                        <Button
                                          key={choice}
                                          size="sm"
                                          variant={vote?.choice === choice ? "default" : "outline"}
                                          onClick={() => castVote(r.unit_id, choice)}
                                          disabled={busy}
                                        >
                                          {VOTE_CHOICE_LABELS[choice]}
                                        </Button>
                                      ))}
                                    </div>
                                  ) : vote ? (
                                    VOTE_CHOICE_LABELS[vote.choice]
                                  ) : (
                                    "Sin voto"
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </Card>
                  )}
                </>
              )}
            </>
          )}
        </TabsContent>

        <TabsContent value="minutes" className="space-y-4">
          <Card className="space-y-3 p-4">
            <p className="text-sm text-muted-foreground">
              El acta es un documento versionado (tipo "acta de asamblea"). Súbela desde Documentos y vincúlala aquí.
            </p>
            {a.minutes_document_id ? (
              <p className="flex items-center gap-2 text-sm font-medium">
                <FileCheck2 className="h-4 w-4 text-success" aria-hidden /> Acta vinculada.
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">Todavía no hay un acta vinculada a esta asamblea.</p>
            )}
            {canWrite && a.status !== "cancelled" && (
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-[16rem] space-y-1.5">
                  <Select value={minutesDocId} onValueChange={setMinutesDocId}>
                    <SelectTrigger><SelectValue placeholder="Elige el documento del acta" /></SelectTrigger>
                    <SelectContent>
                      {(minutesCandidates.data ?? []).map((d) => <SelectItem key={d.id} value={d.id}>{d.title}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <Button size="sm" onClick={saveMinutes} disabled={busy || !minutesDocId}>Vincular acta</Button>
              </div>
            )}
          </Card>
        </TabsContent>
      </Tabs>

      <AddAgendaItemDialog open={addItemOpen} onOpenChange={setAddItemOpen} assemblyId={a.id} onSaved={refreshAll} />
      <RegisterProxyDialog
        open={proxyOpen}
        onOpenChange={setProxyOpen}
        organizationId={a.organization_id}
        assemblyId={a.id}
        onSaved={refreshAll}
      />
      <CheckInUnitDialog
        open={checkInOpen}
        onOpenChange={setCheckInOpen}
        organizationId={a.organization_id}
        assemblyId={a.id}
        proxies={(proxies.data ?? []).filter((p) => p.status === "accepted")}
        onSaved={refreshAll}
      />
    </div>
  );
}
