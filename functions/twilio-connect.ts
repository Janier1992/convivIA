// Edge Function: twilio-connect
// Guarda las credenciales de Twilio/WhatsApp de una copropiedad (columna
// integrations.credentials, revocada para el panel: requiere clave admin)
// y crea en la cuenta de Twilio de la copropiedad las plantillas que Meta
// exige para escribir fuera de la ventana de 24 h.
import { createAdminClient, createClient } from "npm:@insforge/sdk";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
}

function normalizeWhatsApp(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith("whatsapp:") ? trimmed : `whatsapp:${trimmed}`;
}

const CONTENT_API_BASE = "https://content.twilio.com/v1/Content";

// Deben coincidir con las variables que arma el SQL (template_vars) en
// enqueue_payment_reminders, send_announcement, respond_pqrs_ticket y
// notify_reservation_update. Categoría UTILITY: mensajes transaccionales.
const TEMPLATES: Record<string, { body: string; sample: Record<string, string> }> = {
  payment_reminder: {
    body: "Hola {{1}}, te escribe la administración de {{2}}. La unidad {{3}} tiene un valor de {{4}} con fecha {{5}}. Si ya pagaste, responde a este mensaje con tu soporte para registrarlo.",
    sample: { "1": "Ana", "2": "Conjunto Los Almendros", "3": "T1-502", "4": "$ 350.000", "5": "10/10/2026" }
  },
  announcement: {
    body: "Hola {{1}}, la administración de {{2}} publicó un comunicado: {{3}}. Responde a este mensaje para leerlo completo.",
    sample: { "1": "Ana", "2": "Conjunto Los Almendros", "3": "Mantenimiento de ascensores" }
  },
  pqrs_update: {
    body: "Hola {{1}}, tu solicitud {{2}} en {{3}} tiene una respuesta de la administración. Responde a este mensaje para verla.",
    sample: { "1": "Ana", "2": "PQRS-2026-00012", "3": "Conjunto Los Almendros" }
  },
  reservation_update: {
    body: "Hola {{1}}, hay una actualización sobre tu reserva de {{2}} del {{3}} en {{4}}. Responde a este mensaje para ver el detalle.",
    sample: { "1": "Ana", "2": "Salón social", "3": "10/10/2026", "4": "Conjunto Los Almendros" }
  }
};

/**
 * Crea y somete a aprobación una plantilla. Best-effort: si falla, WhatsApp
 * igual queda conectado para responder dentro de la ventana de 24 h; solo
 * los avisos proactivos de ese tipo quedarán sin enviarse (el outbox lo
 * reporta con un error claro).
 */
async function createTemplate(accountSid: string, authToken: string, key: string): Promise<string | null> {
  const auth = "Basic " + btoa(`${accountSid}:${authToken}`);
  const template = TEMPLATES[key];
  try {
    const createRes = await fetch(CONTENT_API_BASE, {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: JSON.stringify({
        friendly_name: `convivia_${key}_${Date.now()}`,
        language: "es",
        variables: template.sample,
        types: { "twilio/text": { body: template.body } }
      })
    });
    const created = (await createRes.json()) as { sid?: string };
    if (!createRes.ok || !created.sid) {
      console.error("twilio_template_create_failed", key, created);
      return null;
    }
    const approvalRes = await fetch(`${CONTENT_API_BASE}/${created.sid}/ApprovalRequests/whatsapp`, {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: JSON.stringify({ name: `convivia_${key}_${created.sid.slice(-8).toLowerCase()}`, category: "UTILITY" })
    });
    if (!approvalRes.ok) console.error("twilio_template_approval_failed", key, await approvalRes.text().catch(() => ""));
    return created.sid;
  } catch (err) {
    console.error("twilio_template_setup_failed", key, err);
    return null;
  }
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ error: { code: "METHOD_NOT_ALLOWED" } }, 405);

  const baseUrl = Deno.env.get("INSFORGE_BASE_URL")!;
  const userToken = req.headers.get("Authorization")?.replace("Bearer ", "") ?? null;
  if (!userToken) return jsonResponse({ error: { code: "UNAUTHENTICATED" } }, 401);

  const userClient = createClient({ baseUrl, accessToken: userToken });
  const { data: userData } = await userClient.auth.getCurrentUser();
  if (!userData?.user?.id) return jsonResponse({ error: { code: "UNAUTHENTICATED" } }, 401);

  let body: { organization_id?: string; accountSid?: string; authToken?: string; whatsappNumber?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: { code: "VALIDATION_ERROR" } }, 400);
  }
  const { organization_id: organizationId, accountSid, authToken, whatsappNumber } = body;
  if (!organizationId || !accountSid?.startsWith("AC") || !authToken || !whatsappNumber) {
    return jsonResponse({ error: { code: "VALIDATION_ERROR", message: "Faltan campos requeridos o el Account SID no es válido." } }, 400);
  }

  const { data: allowed } = await userClient.database.rpc("has_org_permission", {
    p_organization_id: organizationId,
    p_permission: "integrations.manage"
  });
  if (allowed !== true) return jsonResponse({ error: { code: "FORBIDDEN" } }, 403);

  const admin = createAdminClient({ baseUrl, apiKey: Deno.env.get("API_KEY")! });
  const { data: existing } = await admin.database
    .from("integrations")
    .select("metadata")
    .eq("organization_id", organizationId)
    .eq("provider", "twilio")
    .maybeSingle();

  // Al reconectar se reutilizan las plantillas ya creadas en vez de someter
  // plantillas nuevas a Meta cada vez.
  const templates: Record<string, string> = { ...((existing?.metadata as { templates?: Record<string, string> } | null)?.templates ?? {}) };
  for (const key of Object.keys(TEMPLATES)) {
    if (!templates[key]) {
      const sid = await createTemplate(accountSid, authToken, key);
      if (sid) templates[key] = sid;
    }
  }

  const { error } = await admin.database.from("integrations").upsert(
    [
      {
        organization_id: organizationId,
        provider: "twilio",
        status: "connected",
        credentials: { account_sid: accountSid, auth_token: authToken },
        metadata: { whatsapp_number: normalizeWhatsApp(whatsappNumber), templates },
        connected_at: new Date().toISOString()
      }
    ],
    { onConflict: "organization_id,provider" }
  );
  if (error) {
    console.error("twilio_connect_upsert_failed", error);
    return jsonResponse({ error: { code: "INTERNAL_ERROR", message: "No se pudo guardar la integración." } }, 500);
  }

  return jsonResponse(
    { status: "connected", templatesConfigured: Object.keys(templates), templatesMissing: Object.keys(TEMPLATES).filter((k) => !templates[k]) },
    200
  );
}
