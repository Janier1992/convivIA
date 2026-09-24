// Edge Function: twilio-disconnect
// Desconecta WhatsApp (Twilio) y borra las credenciales. Conserva las
// plantillas creadas en metadata para reutilizarlas si se reconecta.
import { createAdminClient, createClient } from "npm:@insforge/sdk";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
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

  let body: { organization_id?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: { code: "VALIDATION_ERROR" } }, 400);
  }
  const organizationId = body.organization_id;
  if (!organizationId) return jsonResponse({ error: { code: "VALIDATION_ERROR" } }, 400);

  const { data: allowed } = await userClient.database.rpc("has_org_permission", {
    p_organization_id: organizationId,
    p_permission: "integrations.manage"
  });
  if (allowed !== true) return jsonResponse({ error: { code: "FORBIDDEN" } }, 403);

  const admin = createAdminClient({ baseUrl, apiKey: Deno.env.get("API_KEY")! });
  const { error } = await admin.database
    .from("integrations")
    .update({ status: "disconnected", credentials: {}, connected_at: null })
    .eq("organization_id", organizationId)
    .eq("provider", "twilio");

  if (error) return jsonResponse({ error: { code: "INTERNAL_ERROR" } }, 500);
  return jsonResponse({ status: "disconnected" }, 200);
}
