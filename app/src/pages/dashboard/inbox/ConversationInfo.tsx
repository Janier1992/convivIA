import { useQuery } from "@tanstack/react-query";
import { insforge } from "@/lib/insforgeClient";
import { rpc } from "@/lib/rpc";
import { formatDate, formatMoney } from "@/lib/format";
import { RELATION_LABELS } from "@/lib/labels";
import { useOrganization } from "@/hooks/useOrganization";
import { Badge } from "@/components/ui/badge";
import type { Conversation, UnitStatement } from "@/types/domain";

interface PersonUnit {
  relation: string;
  units: { id: string; code: string } | null;
}

/** Datos del residente: sus unidades y, si puede, un vistazo rápido a su cartera. */
export function ConversationInfo({ conversation }: { conversation: Conversation }) {
  const { can } = useOrganization();

  const { data: units = [] } = useQuery({
    queryKey: ["conversation-units", conversation.person_id],
    enabled: !!conversation.person_id,
    queryFn: async () => {
      const { data, error } = await insforge.database.from("unit_persons").select("relation, units(id, code)").eq("person_id", conversation.person_id).is("ends_on", null);
      if (error) throw error;
      return data as unknown as PersonUnit[];
    }
  });

  const financeUnit = units.find((u) => u.relation === "owner" || u.relation === "tenant")?.units ?? null;

  const { data: statement } = useQuery({
    queryKey: ["conversation-statement", financeUnit?.id],
    enabled: !!financeUnit && can("finance.read"),
    queryFn: () => rpc<UnitStatement>("get_unit_statement", { p_unit_id: financeUnit!.id })
  });

  return (
    <div className="space-y-4">
      <div>
        <h3 className="mb-1 text-sm font-semibold">Contacto</h3>
        <p className="text-sm">{conversation.persons?.full_name || conversation.contact_name || "Sin nombre"}</p>
        <p className="text-xs text-muted-foreground">{conversation.external_identity}</p>
        {conversation.identity_status !== "verified" && <Badge variant="warning" className="mt-1">No verificado</Badge>}
      </div>
      {units.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold">Unidades</h3>
          <div className="flex flex-wrap gap-1.5">
            {units.map((u, i) => (
              <Badge key={i} variant={u.relation === "owner" ? "default" : "accent"}>{u.units?.code} · {RELATION_LABELS[u.relation as keyof typeof RELATION_LABELS]}</Badge>
            ))}
          </div>
        </div>
      )}
      {statement && (
        <div>
          <h3 className="mb-2 text-sm font-semibold">Cartera ({financeUnit?.code})</h3>
          <div className="rounded-md border border-border p-2.5 text-sm">
            <p>Saldo: <span className="font-semibold">{formatMoney(statement.balance)}</span></p>
            {Number(statement.overdue_amount) > 0 && <p className="text-destructive">Vencido: {formatMoney(statement.overdue_amount)} desde {formatDate(statement.oldest_overdue_due_date)}</p>}
          </div>
        </div>
      )}
      {conversation.notifications_opt_out && <Badge variant="muted">No recibe comunicados</Badge>}
    </div>
  );
}
