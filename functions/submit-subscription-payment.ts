// Edge Function: submit-subscription-payment
// Quien administra la copropiedad ya subió el comprobante al bucket privado
// "subscription-receipts" directo desde el navegador (RLS de storage
// valida que el key empiece con su propio organization_id). Esta función
// registra el reporte de pago y avisa a soporte por correo — insertar el
// pago directo desde el cliente ya lo permite RLS, pero mandar el email
// necesita la clave admin.
import { createAdminClient, createClient } from "npm:@insforge/sdk";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
}

const SUPPORT_EMAIL = "synflow.ia@gmail.com";

export default async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ error: { code: "METHOD_NOT_ALLOWED" } }, 405);

  const baseUrl = Deno.env.get("INSFORGE_BASE_URL")!;
  const userToken = req.headers.get("Authorization")?.replace("Bearer ", "") ?? null;
  if (!userToken) return jsonResponse({ error: { code: "UNAUTHENTICATED" } }, 401);

  const userClient = createClient({ baseUrl, accessToken: userToken });
  const { data: userData } = await userClient.auth.getCurrentUser();
  if (!userData?.user?.id) return jsonResponse({ error: { code: "UNAUTHENTICATED" } }, 401);

  let body: { organization_id?: string; receipt_storage_path?: string; amount?: number; note?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: { code: "VALIDATION_ERROR" } }, 400);
  }

  const { organization_id: organizationId, receipt_storage_path: receiptPath, amount, note } = body;
  if (!organizationId || !receiptPath) {
    return jsonResponse({ error: { code: "VALIDATION_ERROR", message: "organization_id y receipt_storage_path son requeridos." } }, 400);
  }

  const { data: allowed } = await userClient.database.rpc("has_org_permission", {
    p_organization_id: organizationId,
    p_permission: "settings.manage"
  });
  if (allowed !== true) return jsonResponse({ error: { code: "FORBIDDEN" } }, 403);

  // El comprobante debe empezar con "<organization_id>/" — evita que
  // alguien reporte un pago apuntando al archivo de otra copropiedad.
  if (!receiptPath.startsWith(`${organizationId}/`)) {
    return jsonResponse({ error: { code: "VALIDATION_ERROR", message: "El comprobante no pertenece a esta copropiedad." } }, 400);
  }

  const admin = createAdminClient({ baseUrl, apiKey: Deno.env.get("API_KEY")! });

  const { data: payment, error: insertError } = await admin.database
    .from("subscription_payments")
    .insert([
      {
        organization_id: organizationId,
        submitted_by: userData.user.id,
        receipt_storage_path: receiptPath,
        amount: amount ?? null,
        note: note ?? null
      }
    ])
    .select("id")
    .single();

  if (insertError || !payment) {
    console.error("submit_subscription_payment_insert_failed", insertError);
    return jsonResponse({ error: { code: "INTERNAL_ERROR", message: "No se pudo registrar el pago reportado." } }, 500);
  }

  const { data: profile } = await admin.database
    .from("property_profiles")
    .select("display_name")
    .eq("organization_id", organizationId)
    .maybeSingle();

  try {
    await admin.emails.send({
      to: SUPPORT_EMAIL,
      subject: `Nuevo pago reportado: ${profile?.display_name ?? organizationId}`,
      html: `<p>La copropiedad <strong>${profile?.display_name ?? organizationId}</strong> reportó un pago de suscripción.</p>
        <p>Monto informado: ${amount ?? "no especificado"}</p>
        <p>Nota: ${note ?? "—"}</p>
        <p>Revísalo y confírmalo desde el panel de soporte.</p>`
    });
  } catch (err) {
    // Best-effort: el pago ya quedó registrado y visible en /soporte aunque
    // el correo falle — no bloquea el flujo principal.
    console.error("submit_subscription_payment_email_failed", err);
  }

  return jsonResponse({ id: payment.id, status: "pending" }, 201);
}
