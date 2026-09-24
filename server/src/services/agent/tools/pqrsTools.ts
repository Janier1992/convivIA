import { z } from "zod";
import { insforgeAdmin } from "../../../lib/insforge.js";
import { logger } from "../../../lib/logger.js";
import { formatDateTimeInZone, pqrsStatusLabel } from "../../../lib/format.js";
import { findByIdOrName, truncate } from "../../../lib/text.js";
import { AppError, ErrorCodes, toAppError } from "../../../utils/AppError.js";
import { notifyOrganization } from "../../notifications/pushService.js";
import { proposeAction } from "../pendingActions.js";
import { resolveOwnUnit } from "../unitResolver.js";
import { fail, ok, requireIdentity, structuredMeta, toToolResult, type ToolContext, type ToolDefinition } from "../toolTypes.js";

const TICKET_TYPES = ["peticion", "queja", "reclamo", "sugerencia", "felicitacion"] as const;
const PRIORITIES = ["low", "normal", "high", "urgent"] as const;
const PRIORITY_LABELS: Record<(typeof PRIORITIES)[number], string> = { low: "baja", normal: "normal", high: "alta", urgent: "urgente" };
const DATA_UPDATE_CATEGORY = "Actualización de datos";

async function loadCategories(organizationId: string): Promise<{ id: string; name: string }[]> {
  const { data, error } = await insforgeAdmin.database
    .from("pqrs_categories")
    .select("id, name")
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });
  if (error) throw new AppError(ErrorCodes.INTERNAL_ERROR, "No se pudieron cargar las categorías de PQRS.", 500);
  return (data ?? []) as { id: string; name: string }[];
}

const proponerSchema = z.object({
  tipo: z.enum(TICKET_TYPES),
  categoria: z.string().min(2).max(80),
  asunto: z.string().min(3).max(120),
  descripcion: z.string().min(10).max(2000),
  unidad: z.string().max(40).optional(),
  prioridad: z.enum(PRIORITIES).optional()
});

const proponerPqrs: ToolDefinition<z.infer<typeof proponerSchema>> = {
  name: "proponer_pqrs",
  description:
    "Prepara la radicación de una PQRS (petición, queja, reclamo, sugerencia o felicitación) con categoría y prioridad. " +
    "Clasifica según lo que describe el residente. Requiere confirmación posterior con confirmar_accion.",
  parameters: {
    type: "object",
    properties: {
      tipo: { type: "string", enum: [...TICKET_TYPES] },
      categoria: { type: "string", description: "Nombre de una categoría de la lista CATEGORÍAS DE PQRS." },
      asunto: { type: "string", description: "Título corto (máx. 120 caracteres)." },
      descripcion: { type: "string", description: "Descripción completa con lo que contó el residente (lugar, fecha, detalles)." },
      unidad: { type: "string", description: "Código de la unidad relacionada, si aplica." },
      prioridad: { type: "string", enum: [...PRIORITIES], description: "urgent solo para riesgos de seguridad o daños graves." }
    },
    required: ["tipo", "categoria", "asunto", "descripcion"]
  },
  schema: proponerSchema,
  access: "verified",
  capability: "pqrs",
  execute: (args, ctx) =>
    toToolResult(async () => {
      const identity = requireIdentity(ctx);
      const categories = await loadCategories(ctx.organizationId);
      const category = findByIdOrName(categories, args.categoria);
      if (!category) {
        return fail(ErrorCodes.CATEGORY_NOT_FOUND, `Categoría no reconocida. Usa una de: ${categories.map((c) => c.name).join(", ")}.`);
      }
      const unit = args.unidad ? resolveOwnUnit(identity, args.unidad, "any") : identity.units.length === 1 ? identity.units[0] : null;
      const priority = args.prioridad ?? "normal";
      const summary =
        `Radicar una ${args.tipo} en la categoría "${category.name}" (prioridad ${PRIORITY_LABELS[priority]})` +
        `${unit ? ` para la unidad ${unit.code}` : ""}: "${args.asunto}". Detalle: ${truncate(args.descripcion, 300)}`;
      return proposeAction(
        ctx,
        "create_pqrs",
        {
          ticket_type: args.tipo,
          category_id: category.id,
          subject: args.asunto,
          description: args.descripcion,
          priority,
          unit_id: unit?.unit_id ?? null,
          person_id: identity.personId
        },
        summary
      );
    })
};

const misPqrsSchema = z.object({ radicado: z.string().max(40).optional() });

const consultarMisPqrs: ToolDefinition<z.infer<typeof misPqrsSchema>> = {
  name: "consultar_mis_pqrs",
  description: "Estado de las PQRS radicadas por el residente (las 5 más recientes, o una por su radicado) y la respuesta si ya existe.",
  parameters: {
    type: "object",
    properties: { radicado: { type: "string", description: "Radicado, ej. PQRS-2026-00012 (opcional)." } }
  },
  schema: misPqrsSchema,
  access: "verified",
  capability: "pqrs",
  execute: (args, ctx) =>
    toToolResult(async () => {
      const identity = requireIdentity(ctx);
      let query = insforgeAdmin.database
        .from("pqrs_tickets")
        .select("radicado, ticket_type, subject, status, created_at, due_at, response, answered_at")
        .eq("organization_id", ctx.organizationId)
        .eq("requester_person_id", identity.personId)
        .order("created_at", { ascending: false })
        .limit(5);
      if (args.radicado) query = query.eq("radicado", args.radicado.trim().toUpperCase());
      const { data, error } = await query;
      if (error) throw new AppError(ErrorCodes.INTERNAL_ERROR, "No se pudieron consultar las PQRS.", 500);
      const rows = (data ?? []) as {
        radicado: string; ticket_type: string; subject: string; status: string; created_at: string; due_at: string;
        response: string | null; answered_at: string | null;
      }[];
      if (args.radicado && rows.length === 0) {
        return fail(ErrorCodes.PQRS_NOT_FOUND, "No encontré una PQRS con ese radicado a nombre de esta persona.");
      }
      return ok(
        rows.map((r) => ({
          radicado: r.radicado,
          tipo: r.ticket_type,
          asunto: r.subject,
          estado: pqrsStatusLabel(r.status),
          radicada: formatDateTimeInZone(r.created_at, ctx.timezone),
          fecha_limite_respuesta: formatDateTimeInZone(r.due_at, ctx.timezone),
          respuesta: r.response ? truncate(r.response, 1200) : null,
          respondida: r.answered_at ? formatDateTimeInZone(r.answered_at, ctx.timezone) : null
        })),
        structuredMeta("Registro de PQRS de la copropiedad", ctx.now)
      );
    })
};

const actualizacionSchema = z.object({
  nombre: z.string().min(3).max(120),
  unidad: z.string().min(1).max(40),
  detalle: z.string().min(5).max(800),
  telefono_contacto: z.string().max(30).optional()
});

async function findOpenDataUpdate(ctx: ToolContext): Promise<string | null> {
  const { data } = await insforgeAdmin.database
    .from("pqrs_tickets")
    .select("radicado")
    .eq("organization_id", ctx.organizationId)
    .eq("conversation_id", ctx.conversationId)
    .not("status", "in", "(answered,closed)")
    .limit(1);
  return (data as { radicado: string }[] | null)?.[0]?.radicado ?? null;
}

const solicitarActualizacionDatos: ToolDefinition<z.infer<typeof actualizacionSchema>> = {
  name: "solicitar_actualizacion_datos",
  description:
    "Para personas NO verificadas: pide a la administración que actualice el censo (por ejemplo, un residente nuevo o " +
    "un número de teléfono cambiado). Crea una solicitud para revisión humana; no da acceso a datos privados.",
  parameters: {
    type: "object",
    properties: {
      nombre: { type: "string", description: "Nombre completo que indica la persona." },
      unidad: { type: "string", description: "Unidad que dice ocupar o poseer." },
      detalle: { type: "string", description: "Qué hay que actualizar (ej. nuevo arrendatario, cambio de celular)." },
      telefono_contacto: { type: "string", description: "Teléfono de contacto que indica la persona, si lo dio." }
    },
    required: ["nombre", "unidad", "detalle"]
  },
  schema: actualizacionSchema,
  access: "public",
  capability: "pqrs",
  isAvailable: (ctx) => ctx.identityStatus !== "verified",
  execute: (args, ctx) =>
    toToolResult(async () => {
      const existing = await findOpenDataUpdate(ctx);
      if (existing) return ok({ radicado: existing, ya_existia: true, mensaje: "Ya hay una solicitud abierta desde este chat." });
      if (ctx.isPreview) return ok({ simulado: true, mensaje: "Vista previa: la solicitud NO se creó." });

      const categories = await loadCategories(ctx.organizationId);
      const category = findByIdOrName(categories, DATA_UPDATE_CATEGORY);
      const { data: conversation } = await insforgeAdmin.database
        .from("conversations")
        .select("external_identity")
        .eq("id", ctx.conversationId)
        .maybeSingle();
      const contact = [args.telefono_contacto, conversation?.external_identity].filter(Boolean).join(" / ");
      const { data, error } = await insforgeAdmin.database.rpc("create_pqrs_ticket", {
        p_organization_id: ctx.organizationId,
        p_ticket_type: "peticion",
        p_category_id: category?.id ?? null,
        p_subject: `Actualización de censo: ${args.nombre} (${args.unidad})`,
        p_description: `${args.detalle}\n\nSolicitud hecha por una persona NO verificada desde ${ctx.channel}. Validar identidad antes de actualizar.`,
        p_priority: "normal",
        p_unit_id: null,
        p_requester_person_id: null,
        p_requester_name: args.nombre,
        p_requester_contact: contact || null,
        p_channel: ctx.channel,
        p_conversation_id: ctx.conversationId,
        p_actor_kind: "agent"
      });
      if (error || !data) throw toAppError(error, "No se pudo crear la solicitud.");
      const ticket = data as { radicado: string };
      notifyOrganization(ctx.organizationId, {
        title: "Solicitud de actualización de censo",
        body: `${args.nombre} · ${args.unidad}`,
        url: "/dashboard/pqrs",
        tag: `data-update-${ticket.radicado}`
      }).catch((err) => logger.warn({ err }, "push_notify_failed"));
      return ok({ radicado: ticket.radicado, mensaje: "La administración validará los datos y actualizará el censo." });
    })
};

export const PQRS_TOOLS = [proponerPqrs, consultarMisPqrs, solicitarActualizacionDatos] as ToolDefinition[];
