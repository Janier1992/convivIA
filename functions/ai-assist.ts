// Edge Function: ai-assist
// IA para el equipo de administración (no para residentes), sección 10 del
// prompt maestro:
//   - draft_announcement: borrador de comunicado a partir de notas.
//   - daily_brief: resumen de lo que requiere atención hoy.
//   - portfolio_weekly_brief: qué cambió en la cartera en los últimos 7 días.
//   - pqrs_priority_brief: PQRS abiertas agrupadas por cercanía al vencimiento.
// La IA redacta e interpreta; las cifras salen siempre de una función
// determinista de la base de datos (RLS del usuario) y nunca se inventan: el
// borrador marca [COMPLETAR: ...] cuando faltan datos y los resúmenes
// separan DATOS de RECOMENDACIONES.
//
// Proveedor: Google Gemini (vía la capa de compatibilidad con la API de
// OpenAI), obtenido gratis en Google AI Studio (https://aistudio.google.com/apikey).
// Elegido para arrancar sin costo; queda intercambiable sin tocar código:
// si más adelante se prefiere OpenAI (u otro proveedor compatible), basta con
// definir OPENAI_API_KEY + OPENAI_BASE_URL como secretos y dejar GEMINI_API_KEY
// sin usar.
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
const GEMINI_OPENAI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/";
const DEFAULT_MODEL = "gemini-2.0-flash";

function aiClient() {
  const apiKey = Deno.env.get("GEMINI_API_KEY") || Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) throw new Error("MISSING_AI_API_KEY");
  return new OpenAI({
    apiKey,
    baseURL: Deno.env.get("OPENAI_BASE_URL") || GEMINI_OPENAI_BASE_URL,
    maxRetries: 1
  });
}

function aiModel(): string {
  return Deno.env.get("OPENAI_MODEL") || DEFAULT_MODEL;
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

  const completion = await aiClient().chat.completions.create({
    model: aiModel(),
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
  const completion = await aiClient().chat.completions.create({
    model: aiModel(),
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

const PORTFOLIO_BRIEF_RULES = `Eres el asistente del equipo de administración de una copropiedad en Colombia.
Recibes un JSON con los cambios de cartera de los últimos 7 días (fuente: get_portfolio_weekly_changes).
Reglas:
- Usa SOLO las cifras del JSON; no calcules ni estimes cifras nuevas ni asumas causas.
- Formato de texto plano con dos secciones:
  "DATOS (fuente: cartera ConvivIA, del <desde> al <as_of>)" con viñetas: recaudado, facturado, cartera vencida
  total, unidades que entraron en mora esta semana (con sus códigos) y unidades que se pusieron al día, y
  "PRIORIDADES SUGERIDAS (recomendación, no dato oficial)" con máximo 3 viñetas accionables (ej. a quién
  contactar primero).
- Si "unidades_nuevas_en_mora" está vacío, dilo como buena noticia, no lo omitas.
- Máximo 900 caracteres. Español colombiano.`;

async function portfolioWeeklyBrief(client: ReturnType<typeof createClient>, organizationId: string) {
  const { data: facts, error } = await client.database.rpc("get_portfolio_weekly_changes", { p_organization_id: organizationId });
  if (error || !facts) return jsonResponse({ error: { code: "FORBIDDEN" } }, 403);

  const completion = await aiClient().chat.completions.create({
    model: aiModel(),
    temperature: 0.2,
    messages: [
      { role: "system", content: PORTFOLIO_BRIEF_RULES },
      { role: "user", content: JSON.stringify(facts) }
    ]
  });
  return jsonResponse(
    {
      text: completion.choices[0]?.message?.content ?? "",
      as_of: (facts as { as_of?: string }).as_of ?? new Date().toISOString(),
      source: "get_portfolio_weekly_changes",
      facts
    },
    200
  );
}

const PQRS_PRIORITY_RULES = `Eres el asistente del equipo de administración de una copropiedad en Colombia.
Recibes un JSON con PQRS abiertas agrupadas por cercanía a su vencimiento (SLA): "vencidas", "vencen_hoy",
"vencen_pronto" (próximas 48 h) y "resto".
Reglas:
- Usa SOLO los tickets del JSON; no inventes radicados, asuntos ni plazos.
- Escribe un párrafo de máximo 3 líneas priorizando qué atender primero (vencidas primero, luego vence_hoy),
  citando el radicado de cada una. Si un grupo está vacío, no lo menciones.
- Si todos los grupos están vacíos, dilo como buena noticia en una sola línea.
- Español colombiano, texto plano, máximo 500 caracteres.`;

async function pqrsPriorityBrief(client: ReturnType<typeof createClient>, organizationId: string) {
  const { data: allowed } = await client.database.rpc("has_org_permission", {
    p_organization_id: organizationId,
    p_permission: "pqrs.read"
  });
  if (allowed !== true) return jsonResponse({ error: { code: "FORBIDDEN" } }, 403);

  const { data: rows, error } = await client.database
    .from("pqrs_tickets")
    .select("radicado, subject, priority, due_at, status")
    .eq("organization_id", organizationId)
    .not("status", "in", "(answered,closed)")
    .order("due_at", { ascending: true })
    .limit(60);
  if (error) return jsonResponse({ error: { code: "INTERNAL_ERROR" } }, 500);

  const now = Date.now();
  const tickets = (rows ?? []) as { radicado: string; subject: string; priority: string; due_at: string; status: string }[];
  const groups = { vencidas: [], vencen_hoy: [], vencen_pronto: [], resto: [] } as Record<string, typeof tickets>;
  for (const t of tickets) {
    const hoursLeft = (new Date(t.due_at).getTime() - now) / 3_600_000;
    const bucket = hoursLeft < 0 ? "vencidas" : hoursLeft <= 24 ? "vencen_hoy" : hoursLeft <= 48 ? "vencen_pronto" : "resto";
    groups[bucket].push(t);
  }
  // "resto" no se manda a la IA: no aporta a priorizar y solo infla el prompt.
  const facts = { as_of: new Date(now).toISOString(), vencidas: groups.vencidas, vencen_hoy: groups.vencen_hoy, vencen_pronto: groups.vencen_pronto };

  let text = "No hay PQRS abiertas vencidas ni por vencer en las próximas 48 horas.";
  if (groups.vencidas.length + groups.vencen_hoy.length + groups.vencen_pronto.length > 0) {
    const completion = await aiClient().chat.completions.create({
      model: aiModel(),
      temperature: 0.2,
      messages: [
        { role: "system", content: PQRS_PRIORITY_RULES },
        { role: "user", content: JSON.stringify(facts) }
      ]
    });
    text = completion.choices[0]?.message?.content ?? text;
  }

  return jsonResponse(
    { text, as_of: facts.as_of, source: "pqrs_tickets", groups: { ...groups, resto_count: groups.resto.length } },
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
    if (body.action === "portfolio_weekly_brief") {
      return await portfolioWeeklyBrief(client, body.organization_id);
    }
    if (body.action === "pqrs_priority_brief") {
      return await pqrsPriorityBrief(client, body.organization_id);
    }
    return jsonResponse({ error: { code: "VALIDATION_ERROR", message: "Acción no soportada." } }, 400);
  } catch (err) {
    console.error("ai_assist_failed", err);
    return jsonResponse({ error: { code: "AI_UNAVAILABLE", message: "El asistente de IA no está disponible en este momento." } }, 502);
  }
}
