import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Receipt, Undo2 } from "lucide-react";
import { insforge } from "@/lib/insforgeClient";
import { errorMessage, rpc } from "@/lib/rpc";
import { formatDate, formatMoney } from "@/lib/format";
import { PAYMENT_METHOD_LABELS, PAYMENT_STATUS } from "@/lib/labels";
import { useOrganization, useOrgId } from "@/hooks/useOrganization";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { QueryErrorState } from "@/components/QueryErrorState";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { FileLink } from "@/components/FileLink";
import type { Payment, PaymentStatus } from "@/types/domain";
import { RegisterPaymentDialog } from "./RegisterPaymentDialog";
import { ReviewPaymentDialog } from "./ReviewPaymentDialog";

const TABS: { value: PaymentStatus; label: string }[] = [
  { value: "pending_review", label: "Por revisar" },
  { value: "confirmed", label: "Confirmados" },
  { value: "rejected", label: "Rechazados" },
  { value: "reversed", label: "Reversados" }
];

export function PaymentsPage() {
  const orgId = useOrgId();
  const { can } = useOrganization();
  const canWrite = can("finance.write");
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<PaymentStatus>("pending_review");
  const [registerOpen, setRegisterOpen] = useState(false);
  const [reviewing, setReviewing] = useState<Payment | null>(null);
  const [reversing, setReversing] = useState<Payment | null>(null);

  const { data: payments = [], isLoading, isError, refetch } = useQuery({
    queryKey: ["payments", orgId, tab],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await insforge.database
        .from("payments")
        .select("*, units(code), persons(full_name)")
        .eq("organization_id", orgId)
        .eq("status", tab)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data as unknown as Payment[];
    }
  });

  async function reverse(reason: string) {
    if (!reversing) return;
    try {
      await rpc("reverse_payment", { p_payment_id: reversing.id, p_reason: reason });
      toast.success("Pago reversado.");
      await queryClient.invalidateQueries();
    } catch (err) {
      toast.error(errorMessage(err));
      throw err;
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pagos"
        description="Pagos reportados por residentes desde el chat y pagos registrados directamente por el equipo."
        actions={canWrite && <Button onClick={() => setRegisterOpen(true)}><Plus className="h-4 w-4" aria-hidden /> Registrar pago</Button>}
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as PaymentStatus)}>
        <TabsList>
          {TABS.map((t) => <TabsTrigger key={t.value} value={t.value}>{t.label}</TabsTrigger>)}
        </TabsList>
      </Tabs>

      {isError ? (
        <QueryErrorState onRetry={() => refetch()} message="No se pudieron cargar los pagos." />
      ) : isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : payments.length === 0 ? (
        <EmptyState icon={Receipt} title={`Sin pagos ${TABS.find((t) => t.value === tab)?.label.toLowerCase()}`} />
      ) : (
        <Card className="overflow-x-auto">
          <table className="table-base">
            <thead><tr><th>Fecha</th><th>Unidad</th><th>Reportado por</th><th className="text-right">Valor</th><th>Medio</th><th>Estado</th><th /></tr></thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id}>
                  <td>{p.paid_on ? formatDate(p.paid_on) : "—"}</td>
                  <td className="font-medium">{p.units?.code ?? "—"}</td>
                  <td>{p.persons?.full_name ?? (p.source === "dashboard" ? "Equipo" : "—")}</td>
                  <td className="text-right tabular-nums">{p.amount ? formatMoney(p.amount) : "—"}</td>
                  <td>{p.method ? PAYMENT_METHOD_LABELS[p.method] : "—"}</td>
                  <td><Badge variant={PAYMENT_STATUS[p.status].variant}>{PAYMENT_STATUS[p.status].label}</Badge></td>
                  <td>
                    <div className="flex items-center gap-1">
                      {p.receipt_storage_key && <FileLink kind="payment_receipt" id={p.id} label="Soporte" />}
                      {canWrite && p.status === "pending_review" && (
                        <Button size="sm" onClick={() => setReviewing(p)}>Revisar</Button>
                      )}
                      {canWrite && p.status === "confirmed" && (
                        <Button variant="ghost" size="sm" onClick={() => setReversing(p)}><Undo2 className="h-4 w-4" aria-hidden /> Reversar</Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <RegisterPaymentDialog open={registerOpen} onOpenChange={setRegisterOpen} />
      <ReviewPaymentDialog payment={reviewing} onOpenChange={(open) => !open && setReviewing(null)} />
      <ConfirmDialog
        open={!!reversing}
        onOpenChange={(open) => !open && setReversing(null)}
        title="Reversar pago"
        description={reversing ? `Se reversará el pago de ${formatMoney(reversing.amount)} de la unidad ${reversing.units?.code}. El saldo vuelve a quedar pendiente.` : undefined}
        confirmLabel="Reversar"
        destructive
        reasonLabel="Motivo de la reversión"
        onConfirm={reverse}
      />
    </div>
  );
}
