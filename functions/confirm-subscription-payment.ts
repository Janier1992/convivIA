// Edge Function: confirm-subscription-payment
// Soporte confirma o rechaza un pago de suscripción reportado. Confirmar
// además reactiva la copropiedad (si estaba suspendida) y extiende su
// vencimiento — todo en un solo paso ("sin pausas", como pidió el
// usuario), y avisa a la copropiedad por correo.
import { createAdminClient, createClient } from "npm:@insforge/sdk";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
}

const SUBSCRIPTION_PERIOD_DAYS = 30;

export default async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ error: { code: "METHOD_NOT_ALLOWED" } }, 405);

  const baseUrl = Deno.env.get("INSFORGE_BASE_URL")!;
  const userToken = req.headers.get("Authorization")?.replace("Bearer ", "") ?? null;
  if (!userToken) return jsonResponse({ error: { code: "UNAUTHENTICATED" } }, 401);

  const userClient = createClient({ baseUrl, accessToken: userToken });
  const { data: userData } = await userClient.auth.getCurrentUser();
  if (!userData?.user?.id) return jsonResponse({ error: { code: "UNAUTHENTICATED" } }, 401);

  const { data: staffRow } = await userClient.database
    .from("support_staff")
    .select("active")
    .eq("user_id", userData.user.id)
    .maybeSingle();
  if (!staffRow?.active) return jsonResponse({ error: { code: "FORBIDDEN" } }, 403);

  let body: { payment_id?: string; action?: "confirm" | "reject" };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: { code: "VALIDATION_ERROR" } }, 400);
  }

  const { payment_id: paymentId, action } = body;
  if (!paymentId || (action !== "confirm" && action !== "reject")) {
    return jsonResponse({ error: { code: "VALIDATION_ERROR", message: "payment_id y action ('confirm'|'reject') son requeridos." } }, 400);
  }

  const admin = createAdminClient({ baseUrl, apiKey: Deno.env.get("API_KEY")! });

  const { data: payment } = await admin.database.from("subscription_payments").select("*").eq("id", paymentId).maybeSingle();
  if (!payment) return jsonResponse({ error: { code: "VALIDATION_ERROR", message: "El pago no existe." } }, 404);
  if (payment.status !== "pending") {
    return jsonResponse({ error: { code: "VALIDATION_ERROR", message: "Este pago ya fue revisado." } }, 409);
  }

  const { error: updatePaymentError } = await admin.database
    .from("subscription_payments")
    .update({ status: action === "confirm" ? "confirmed" : "rejected", reviewed_by: userData.user.id, reviewed_at: new Date().toISOString() })
    .eq("id", paymentId);

  if (updatePaymentError) {
    console.error("confirm_subscription_payment_update_failed", updatePaymentError);
    return jsonResponse({ error: { code: "INTERNAL_ERROR", message: "No se pudo actualizar el pago." } }, 500);
  }

  const { data: profile } = await admin.database
    .from("property_profiles")
    .select("display_name, email")
    .eq("organization_id", payment.organization_id)
    .maybeSingle();

  let newExpiresAt: string | null = null;
  if (action === "confirm") {
    const { data: org } = await admin.database
      .from("organizations")
      .select("subscription_expires_at")
      .eq("id", payment.organization_id)
      .maybeSingle();

    const currentExpiry = org?.subscription_expires_at ? new Date(org.subscription_expires_at) : null;
    const base = currentExpiry && currentExpiry > new Date() ? currentExpiry : new Date();
    const extended = new Date(base);
    extended.setDate(extended.getDate() + SUBSCRIPTION_PERIOD_DAYS);
    newExpiresAt = extended.toISOString();

    const { error: orgUpdateError } = await admin.database
      .from("organizations")
      .update({ status: "active", subscription_expires_at: newExpiresAt })
      .eq("id", payment.organization_id);

    if (orgUpdateError) {
      console.error("confirm_subscription_payment_org_update_failed", orgUpdateError);
      return jsonResponse({ error: { code: "INTERNAL_ERROR", message: "El pago se marcó confirmado pero no se pudo reactivar la copropiedad." } }, 500);
    }
  }

  const ownerEmail = profile?.email as string | undefined;
  if (ownerEmail) {
    try {
      const html =
        action === "confirm"
          ? `<p>¡Hola! Confirmamos tu pago de la suscripción de ConvivIA para <strong>${profile?.display_name ?? "tu copropiedad"}</strong>.</p>
             <p>Tu servicio queda activo hasta el <strong>${new Date(newExpiresAt!).toLocaleDateString("es-CO")}</strong>.</p>
             <p>Gracias por confiar en nosotros.</p>`
          : `<p>Hola, revisamos el comprobante de pago que enviaste para <strong>${profile?.display_name ?? "tu copropiedad"}</strong> y no pudimos confirmarlo.</p>
             <p>Por favor contáctanos respondiendo este correo para resolverlo.</p>`;
      await admin.emails.send({
        to: ownerEmail,
        subject: action === "confirm" ? "Pago confirmado — ConvivIA" : "No pudimos confirmar tu pago — ConvivIA",
        html
      });
    } catch (err) {
      console.error("confirm_subscription_payment_email_failed", err);
    }
  }

  return jsonResponse({ status: action === "confirm" ? "confirmed" : "rejected", subscription_expires_at: newExpiresAt }, 200);
}
