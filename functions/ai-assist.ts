// Edge Function: ai-assist
// IA para el equipo de administración (no para residentes):
//   - draft_announcement: borrador de comunicado a partir de notas.
//   - daily_brief: resumen de lo que requiere atención hoy.
// La IA redacta e interpreta; las cifras salen de get_admin_dashboard (RLS
// del usuario) y nunca se inventan: el borrador marca [COMPLETAR: ...]
// cuando faltan datos y el resumen separa DATOS de RECOMENDACIONES.
import { createClient } from "npm:@insforge/sdk";
import OpenAI from "npm:openai";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
}

const MAX_NOTES_LENGTH = 2000;

function openaiClient() {
  return new OpenAI({
    apiKey: Deno.env.get("OPENAI_API_KEY")!,
    baseURL: Deno.env.get("OPENAI_BASE_URL") || undefined,
    maxRetries: 1
  });
}

const DRAFT_RULES = `Redactas comunicados de la administración de una copropiedad en Colombia (conjunto, edificio o condominio).
Reglas:
- Usa SOLO la información de las notas. No inventes fechas, horas, valores, normas, sanciones ni nombres.
- Si falta un dato concreto necesario (fecha, hora, valor, lugar), escribe [COMPLETAR: descripción del dato].
- Nunca incluyas datos personales de residentes ni listas de unidades en mora.
- Español colombiano, tono cordial y profesional, claro y breve (máximo 1.200 caracteres en el cuerpo).
- Devuelve SOLO un JSON: {"title": "...", "body": "..."} (título de máximo 80 caracteres, cuerpo sin firma).`;

const BRIEF_RULES = `Eres el asistente del equipo de administración de una copropiedad en Colombia.
Recibes un JSON con cifras del tablero. Escribe un resumen de lo que requiere atención HOY.
Reglas:
- Usa SOLO las cifras del JSON; no calcules ni estimes cifras nuevas.
- Si una sección es null, di que no tienes permiso o datos para ella.
- Formato de texto plano con dos secciones:
  "DATOS (fuente: tablero ConvivIA, corte <fecha>)" con viñetas de cifras relevantes, y
  "PRIORIDADES SUGERIDAS (recomendación, no dato oficial)" con máximo 4 viñetas accionables.
- Máximo 900 caracteres. Español colombiano.`;

async function draftAnnouncement(client: ReturnType<typeof createClient>, organizationId: string, notes: string) {
  const { data: allowed } = await client.database.rpc("has_org_permission", {
    p_organization_id: organizationId,
    p_permission: "communications.send"
  });
  if (allowed !== true) return jsonResponse({ error: { code: "FORBIDDEN" } }, 403);

  const { data: profile } = await client.database
    .from("property_profiles")
    .select("display_name")
    .eq("organization_id", organizationId)
    .maybeSingle();

  const completion = await openaiClient().chat.completions.create({
    model: Deno.env.get("OPENAI_MODEL") ?? "gpt-4o-mini",
    temperature: 0.4,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: DRAFT_RULES },
      { role: "user", content: `Copropiedad: ${profile?.display_name ?? "la copropiedad"}\nNotas del administrador:\n${notes}` }
    ]
  });
  const raw = completion.choices[0]?.message?.content ?? "{}";
  let parsed: { title?: string; body?: string } = {};
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = { title: "", body: raw };
  }
  return jsonResponse(
    { title: (parsed.title ?? "").slice(0, 160), body: (parsed.body ?? "").slice(0, 3500), generated_by: "ia", requires_review: true },
    200
  );
}

async function dailyBrief(client: ReturnType<typeof createClient>, organizationId: string) {
  const { data: dashboard, error } = await client.database.rpc("get_admin_dashboard", { p_organization_id: organizationId });
  if (error || !dashboard) return jsonResponse({ error: { code: "FORBIDDEN" } }, 403);

  const { data: dueSoon } = await client.database
    .from("pqrs_tickets")
    .select("radicado, subject, priority, due_at, status")
    .eq("organization_id", organizationId)
    .not("status", "in", "(answered,closed)")
    .order("due_at", { ascending: true })
    .limit(6);

  const facts = { tablero: dashboard, pqrs_mas_proximas_a_vencer: dueSoon ?? [] };
  const completion = await openaiClient().chat.completions.create({
    model: Deno.env.get("OPENAI_MODEL") ?? "gpt-4o-mini",
    temperature: 0.2,
    messages: [
      { role: "system", content: BRIEF_RULES },
      { role: "user", content: JSON.stringify(facts) }
    ]
  });
  return jsonResponse(
    {
      text: completion.choices[0]?.message?.content ?? "",
      as_of: (dashboard as { as_of?: string }).as_of ?? new Date().toISOString(),
      source: "get_admin_dashboard",
      facts
    },
    200
  );
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ error: { code: "METHOD_NOT_ALLOWED" } }, 405);

  const baseUrl = Deno.env.get("INSFORGE_BASE_URL")!;
  const userToken = req.headers.get("Authorization")?.replace("Bearer ", "") ?? null;
  if (!userToken) return jsonResponse({ error: { code: "UNAUTHENTICATED" } }, 401);

  const client = createClient({ baseUrl, accessToken: userToken });
  const { data: userData } = await client.auth.getCurrentUser();
  if (!userData?.user?.id) return jsonResponse({ error: { code: "UNAUTHENTICATED" } }, 401);

  let body: { action?: string; organization_id?: string; notes?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: { code: "VALIDATION_ERROR" } }, 400);
  }
  if (!body.organization_id) return jsonResponse({ error: { code: "VALIDATION_ERROR", message: "organization_id es requerido." } }, 400);

  try {
    if (body.action === "draft_announcement") {
      const notes = (body.notes ?? "").trim();
      if (notes.length < 10) {
        return jsonResponse({ error: { code: "VALIDATION_ERROR", message: "Escribe al menos una frase con lo que quieres comunicar." } }, 400);
      }
      return await draftAnnouncement(client, body.organization_id, notes.slice(0, MAX_NOTES_LENGTH));
    }
    if (body.action === "daily_brief") {
      return await dailyBrief(client, body.organization_id);
    }
    return jsonResponse({ error: { code: "VALIDATION_ERROR", message: "Acción no soportada." } }, 400);
  } catch (err) {
    console.error("ai_assist_failed", err);
    return jsonResponse({ error: { code: "AI_UNAVAILABLE", message: "El asistente de IA no está disponible en este momento." } }, 502);
  }
}
