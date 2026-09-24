import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MessageCircle, Plus, Users } from "lucide-react";
import { insforge } from "@/lib/insforgeClient";
import { RELATION_LABELS } from "@/lib/labels";
import { useOrganization } from "@/hooks/useOrganization";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { QueryErrorState } from "@/components/QueryErrorState";
import type { Person, UnitRelation } from "@/types/domain";
import { PersonFormDialog } from "./PersonFormDialog";

type PersonRow = Person & { unit_persons: { relation: UnitRelation; ends_on: string | null; units: { code: string } | null }[] };

function normalize(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function ResidentsPage() {
  const { currentOrganizationId: orgId, can } = useOrganization();
  const canWrite = can("residents.write");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Person | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data: persons = [], isLoading, isError, refetch } = useQuery({
    queryKey: ["residents", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await insforge.database
        .from("persons")
        .select("*, unit_persons(relation, ends_on, units(code))")
        .eq("organization_id", orgId)
        .order("full_name", { ascending: true })
        .limit(5000);
      if (error) throw error;
      return data as unknown as PersonRow[];
    }
  });

  // Canal vinculado: la persona ya se verificó con el asistente y puede recibir avisos.
  const { data: linked = new Map<string, string>() } = useQuery({
    queryKey: ["linked-channels", orgId],
    enabled: !!orgId && can("inbox.read"),
    queryFn: async () => {
      const { data, error } = await insforge.database
        .from("conversations")
        .select("person_id, channel")
        .eq("organization_id", orgId)
        .eq("identity_status", "verified")
        .eq("is_preview", false)
        .limit(10000);
      if (error) throw error;
      return new Map((data as { person_id: string; channel: string }[]).map((r) => [r.person_id, r.channel]));
    }
  });

  const filtered = useMemo(() => {
    const term = normalize(search.trim());
    if (!term) return persons;
    return persons.filter((p) =>
      [p.full_name, p.phone ?? "", p.document_number ?? "", ...p.unit_persons.map((r) => r.units?.code ?? "")].some((v) =>
        normalize(v).includes(term)
      )
    );
  }, [persons, search]);

  function open(person: Person | null) {
    setSelected(person);
    setDialogOpen(true);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Residentes"
        description={`${persons.length} personas en el censo · ${linked.size} con canal vinculado al asistente.`}
        actions={canWrite && <Button onClick={() => open(null)}><Plus className="h-4 w-4" aria-hidden /> Nueva persona</Button>}
      />
      <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nombre, celular, documento o unidad" className="max-w-md" aria-label="Buscar residente" />

      {isError ? (
        <QueryErrorState onRetry={() => refetch()} message="No se pudo cargar el censo." />
      ) : isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : persons.length === 0 ? (
        <EmptyState icon={Users} title="El censo está vacío" description="Importa el censo desde Unidades → Importar censo, o crea las personas una a una." />
      ) : (
        <Card className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr><th>Nombre</th><th>Unidades</th><th>Celular</th><th>Documento</th><th>Asistente</th></tr>
            </thead>
            <tbody>
              {filtered.map((person) => {
                const active = person.unit_persons.filter((r) => !r.ends_on);
                const channel = linked.get(person.id);
                return (
                  <tr key={person.id} className="cursor-pointer" onClick={() => open(person)}>
                    <td className="font-medium">{person.full_name}</td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {active.map((r, i) => (
                          <Badge key={i} variant={r.relation === "owner" ? "default" : "accent"}>
                            {r.units?.code} · {RELATION_LABELS[r.relation]}
                          </Badge>
                        ))}
                        {active.length === 0 && <span className="text-xs text-muted-foreground">Sin unidad</span>}
                      </div>
                    </td>
                    <td className="tabular-nums">{person.phone ?? "—"}</td>
                    <td>{person.document_number ? `${person.document_type ?? ""} ${person.document_number}` : "—"}</td>
                    <td>
                      {channel ? (
                        <Badge variant="success"><MessageCircle className="h-3 w-3" aria-hidden /> {channel === "telegram" ? "Telegram" : "WhatsApp"}</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">Sin vincular</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filtered.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">Nadie coincide con la búsqueda.</p>}
        </Card>
      )}

      <PersonFormDialog open={dialogOpen} onOpenChange={setDialogOpen} person={selected} canWrite={canWrite} />
    </div>
  );
}
