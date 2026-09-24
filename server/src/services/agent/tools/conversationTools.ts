import { z } from "zod";
import { insforgeAdmin } from "../../../lib/insforge.js";
import { logger } from "../../../lib/logger.js";
import { notifyOrganization } from "../../notifications/pushService.js";
import { confirmAction, discardAction } from "../pendingActions.js";
import { ok, toToolResult, type ToolDefinition } from "../toolTypes.js";

const accionSchema = z.object({ accion_id: z.string().uuid() });

const confirmarAccion: ToolDefinition<z.infer<typeof accionSchema>> = {
  name: "confirmar_accion",
  description:
    "Ejecuta una acción propuesta (PQRS, reserva, cancelación o reporte de pago) SOLO después de que el residente " +
    "respondió afirmativamente al resumen. Nunca la llames en la misma respuesta en que propones.",
  parameters: {
    type: "object",
    properties: { accion_id: { type: "string", description: "accion_id devuelto por la herramienta proponer_*." } },
    required: ["accion_id"]
  },
  schema: accionSchema,
  access: "verified",
  capability: "core",
  execute: (args, ctx) => toToolResult(() => confirmAction(ctx, args.accion_id))
};

const descartarAccion: ToolDefinition<z.infer<typeof accionSchema>> = {
  name: "descartar_accion",
  description: "Descarta una acción propuesta cuando el residente dice que no o quiere cambiar datos.",
  parameters: {
    type: "object",
    properties: { accion_id: { type: "string" } },
    required: ["accion_id"]
  },
  schema: accionSchema,
  access: "verified",
  capability: "core",
  execute: (args, ctx) => toToolResult(() => discardAction(ctx, args.accion_id))
};

const solicitarVerificacion: ToolDefinition<Record<string, unknown>> = {
  name: "solicitar_verificacion",
  description:
    "Inicia la verificación de identidad cuando una persona no verificada pide información privada (saldo, PQRS, " +
    "reservas, comunicados). En Telegram le muestra un botón para compartir su número.",
  parameters: { type: "object", properties: {} },
  schema: z.object({}).passthrough(),
  access: "public",
  capability: "core",
  isAvailable: (ctx) => ctx.identityStatus !== "verified",
  execute: (_args, ctx) =>
    toToolResult(async () => {
      if (ctx.channel === "telegram") {
        ctx.channelActions.add("request_contact");
        await insforgeAdmin.database
          .from("conversations")
          .update({ contact_requested_at: ctx.now.toISOString() })
          .eq("id", ctx.conversationId);
        return ok({
          boton_mostrado: true,
          instruccion: "Pídele que toque el botón 'Compartir mi número' que aparece debajo del chat para verificar su identidad."
        });
      }
      if (ctx.channel === "whatsapp") {
        return ok({
          boton_mostrado: false,
          instruccion:
            "El número de WhatsApp desde el que escribe no está registrado en el censo de la copropiedad. " +
            "Ofrece solicitar_actualizacion_datos para que la administración actualice sus datos."
        });
      }
      return ok({ boton_mostrado: false, instruccion: "En la vista previa la identidad se simula desde el panel." });
    })
};

const escalarSchema = z.object({ motivo: z.string().min(3).max(300) });

const escalarAHumano: ToolDefinition<z.infer<typeof escalarSchema>> = {
  name: "escalar_a_humano",
  description:
    "Transfiere la conversación al equipo de administración (el asistente deja de responder en este chat hasta que el " +
    "equipo la devuelva). Úsala si la persona lo pide, está molesta, o el caso requiere criterio humano.",
  parameters: {
    type: "object",
    properties: { motivo: { type: "string", description: "Resumen breve del motivo para el equipo." } },
    required: ["motivo"]
  },
  schema: escalarSchema,
  access: "public",
  capability: "handoff",
  execute: (args, ctx) =>
    toToolResult(async () => {
      if (ctx.isPreview) return ok({ simulado: true, mensaje: "Vista previa: la conversación NO se transfirió." });
      await insforgeAdmin.database
        .from("conversations")
        .update({ status: "handoff", handoff_reason: args.motivo, handoff_at: ctx.now.toISOString() })
        .eq("id", ctx.conversationId);
      notifyOrganization(ctx.organizationId, {
        title: "Un residente pide atención humana",
        body: args.motivo,
        url: "/dashboard/inbox",
        tag: `handoff-${ctx.conversationId}`
      }).catch((err) => logger.warn({ err }, "push_notify_failed"));
      return ok({
        transferida: true,
        instruccion: "Avísale que un miembro del equipo de administración continuará la conversación por este mismo chat."
      });
    })
};

export const CONVERSATION_TOOLS = [confirmarAccion, descartarAccion, solicitarVerificacion, escalarAHumano] as ToolDefinition[];
