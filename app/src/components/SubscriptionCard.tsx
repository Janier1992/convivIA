import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CreditCard } from "lucide-react";
import { insforge } from "@/lib/insforgeClient";
import { functionsClient } from "@/lib/functionsClient";
import { useOrganization } from "@/hooks/useOrganization";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { FileLink } from "@/components/FileLink";
import { formatDate, formatMoney } from "@/lib/format";
import type { SubscriptionPayment } from "@/types/domain";

const STATUS_LABELS: Record<SubscriptionPayment["status"], string> = {
  pending: "En revisión",
  confirmed: "Confirmado",
  rejected: "Rechazado"
};

const STATUS_VARIANTS: Record<SubscriptionPayment["status"], "warning" | "success" | "destructive"> = {
  pending: "warning",
  confirmed: "success",
  rejected: "destructive"
};

/**
 * Cobro manual mientras no hay pasarela de suscripción: la copropiedad paga
 * por Nequi y sube la captura del comprobante aquí; soporte lo revisa desde
 * /soporte y, al confirmarlo, la reactivación (o extensión) del servicio y
 * el correo de confirmación salen solos — ver confirm-subscription-payment.
 */
export function SubscriptionCard({ organizationId }: { organizationId: string }) {
  const { memberships, can } = useOrganization();
  const queryClient = useQueryClient();
  const readOnly = !can("settings.manage");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const organization = memberships.find((m) => m.organization_id === organizationId)?.organizations ?? null;

  const { data: payments = [] } = useQuery({
    queryKey: ["subscription-payments", organizationId],
    queryFn: async () => {
      const { data, error } = await insforge.database
        .from("subscription_payments")
        .select("*")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return (data ?? []) as SubscriptionPayment[];
    }
  });

  async function handleReceiptChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // permite volver a elegir el mismo archivo si hace falta reintentar
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast.error("El comprobante debe ser una imagen (captura de pantalla del pago).");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("La imagen no puede superar 5 MB.");
      return;
    }

    setSubmitting(true);
    try {
      // Key con prefijo de organización: la política de storage sólo deja
      // subir acá si el primer segmento del key es el propio organization_id.
      const { data: uploadData, error: uploadError } = await insforge.storage
        .from("subscription-receipts")
        .upload(`${organizationId}/${crypto.randomUUID()}`, file);

      if (uploadError || !uploadData) {
        toast.error(uploadError?.message ?? "No se pudo subir el comprobante.");
        return;
      }

      await functionsClient.post("submit-subscription-payment", {
        organization_id: organizationId,
        receipt_storage_path: uploadData.key,
        amount: amount ? Number(amount) : undefined,
        note: note.trim() || undefined
      });

      toast.success("Pago reportado. Te avisaremos por correo cuando soporte lo confirme.");
      setAmount("");
      setNote("");
      queryClient.invalidateQueries({ queryKey: ["subscription-payments", organizationId] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo reportar el pago.");
    } finally {
      setSubmitting(false);
    }
  }

  const expiresAt = organization?.subscription_expires_at ? new Date(organization.subscription_expires_at) : null;
  const isSuspended = organization?.status === "suspended";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CreditCard className="h-4 w-4" /> Suscripción
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div
          className={`rounded-md border p-3 text-sm ${
            isSuspended ? "border-destructive/50 bg-destructive/10 text-destructive" : "border-border"
          }`}
        >
          {isSuspended
            ? "Tu servicio está suspendido por falta de pago. Reporta tu pago aquí abajo para reactivarlo."
            : expiresAt
              ? `Suscripción activa hasta el ${expiresAt.toLocaleDateString("es-CO")}.`
              : "Todavía no tienes una fecha de vencimiento registrada."}
        </div>

        {!readOnly && (
          <div className="space-y-3 rounded-md border border-border p-3">
            <p className="text-sm text-muted-foreground">
              Paga por Nequi y sube aquí la captura del comprobante. Cuando soporte lo confirme, tu servicio se
              reactiva (o extiende) automáticamente y te llega un correo de confirmación.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Monto pagado (opcional)</Label>
                <Input
                  type="number"
                  min={0}
                  disabled={submitting}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Nota (opcional)</Label>
                <Input disabled={submitting} value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="receipt-upload">Comprobante de pago</Label>
              <input
                id="receipt-upload"
                type="file"
                accept="image/*"
                disabled={submitting}
                onChange={handleReceiptChange}
                className="block text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary-foreground file:hover:opacity-90 disabled:opacity-60"
              />
            </div>
          </div>
        )}

        {payments.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium">Pagos reportados</p>
            {payments.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-3 rounded-md border border-border p-2 text-sm">
                <div>
                  <span>{formatDate(p.created_at)}</span>
                  {p.amount != null && <span className="text-muted-foreground"> — {formatMoney(p.amount)}</span>}
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={STATUS_VARIANTS[p.status]}>{STATUS_LABELS[p.status]}</Badge>
                  <FileLink kind="subscription_receipt" id={p.id} label="Ver" />
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
