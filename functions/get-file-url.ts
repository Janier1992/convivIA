// Edge Function: get-file-url
// Los archivos privados (soportes de pago, adjuntos del chat, documentos y
// comprobantes de suscripción) nunca están en buckets públicos. Esta
// función verifica el permiso de quien pide el archivo y genera una URL
// firmada de 5 minutos con la clave admin.
import { createAdminClient, createClient } from "npm:@insforge/sdk";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
}

const SIGNED_URL_TTL_SECONDS = 300;

type Kind = "payment_receipt" | "message_attachment" | "document" | "subscription_receipt";

interface Target {
  table: string;
  keyColumn: string;
  bucket: string;
  permission: string | null;
}

const TARGETS: Record<Kind, Target> = {
  payment_receipt: { table: "payments", keyColumn: "receipt_storage_key", bucket: "payment-receipts", permission: "finance.read" },
  message_attachment: { table: "messages", keyColumn: "metadata", bucket: "payment-receipts", permission: "inbox.read" },
  document: { table: "documents", keyColumn: "storage_key", bucket: "documents", permission: "documents.read" },
  subscription_receipt: { table: "subscription_payments", keyColumn: "receipt_storage_path", bucket: "subscription-receipts", permission: "settings.manage" }
};

export default async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== "GET") return jsonResponse({ error: { code: "METHOD_NOT_ALLOWED" } }, 405);

  const baseUrl = Deno.env.get("INSFORGE_BASE_URL")!;
  const userToken = req.headers.get("Authorization")?.replace("Bearer ", "") ?? null;
  if (!userToken) return jsonResponse({ error: { code: "UNAUTHENTICATED" } }, 401);

  const userClient = createClient({ baseUrl, accessToken: userToken });
  const { data: userData } = await userClient.auth.getCurrentUser();
  if (!userData?.user?.id) return jsonResponse({ error: { code: "UNAUTHENTICATED" } }, 401);

  const url = new URL(req.url);
  const kind = url.searchParams.get("kind") as Kind | null;
  const id = url.searchParams.get("id");
  if (!kind || !(kind in TARGETS) || !id) {
    return jsonResponse({ error: { code: "VALIDATION_ERROR", message: "kind e id son requeridos." } }, 400);
  }
  const target = TARGETS[kind];

  const admin = createAdminClient({ baseUrl, apiKey: Deno.env.get("API_KEY")! });
  const { data } = await admin.database
    .from(target.table)
    .select(["organization_id", target.keyColumn].join(", "))
    .eq("id", id)
    .maybeSingle();
  const row = data as Record<string, unknown> | null;
  if (!row) return jsonResponse({ error: { code: "NOT_FOUND", message: "El archivo no existe." } }, 404);

  const organizationId = row.organization_id as string;
  const [{ data: allowed }, { data: isSupport }] = await Promise.all([
    userClient.database.rpc("has_org_permission", { p_organization_id: organizationId, p_permission: target.permission }),
    kind === "subscription_receipt" ? userClient.database.rpc("is_support_staff", {}) : Promise.resolve({ data: false })
  ]);
  if (allowed !== true && isSupport !== true) return jsonResponse({ error: { code: "FORBIDDEN" } }, 403);

  const rawKey = row[target.keyColumn];
  const storageKey =
    kind === "message_attachment" ? ((rawKey as Record<string, unknown> | null)?.storage_key as string | undefined) : (rawKey as string | null);
  if (!storageKey) return jsonResponse({ error: { code: "NOT_FOUND", message: "No hay un archivo asociado." } }, 404);

  const { data: signed, error } = await admin.storage.from(target.bucket).createSignedUrl(storageKey, SIGNED_URL_TTL_SECONDS);
  if (error || !signed) {
    console.error("get_file_url_signing_failed", error);
    return jsonResponse({ error: { code: "INTERNAL_ERROR", message: "No se pudo generar el enlace del archivo." } }, 500);
  }
  return jsonResponse({ url: signed.signedUrl, expires_at: signed.expiresAt }, 200);
}
