import { insforgeAdmin } from "../../lib/insforge.js";
import { logger } from "../../lib/logger.js";
import { AppError, ErrorCodes } from "../../utils/AppError.js";
import { ACTION_EXECUTORS, type ActionType } from "./actionExecutors.js";
import { fail, ok, type ToolContext, type ToolResult } from "./toolTypes.js";

interface PendingActionRow {
  id: string;
  action_type: ActionType;
  payload: Record<string, unknown>;
  summary: string;
  status: string;
  created_at: string;
  expires_at: string;
}

const CONFIRM_INSTRUCTION =
  "Muestra este resumen al residente tal cual y pregúntale si confirma. Solo si responde que sí en un mensaje nuevo, " +
  "llama confirmar_accion con este accion_id. Si cambia algún dato, llama descartar_accion y vuelve a proponer.";

/**
 * Registra una acción validada y pendiente de confirmación. Solo puede
 * haber una por conversación: una propuesta nueva descarta las anteriores.
 */
export async function proposeAction(
  ctx: ToolContext,
  actionType: ActionType,
  payload: Record<string, unknown>,
  summary: string
): Promise<ToolResult> {
  await insforgeAdmin.database
    .from("pending_actions")
    .update({ status: "discarded", resolved_at: new Date().toISOString() })
    .eq("conversation_id", ctx.conversationId)
    .eq("status", "pending");

  const { data, error } = await insforgeAdmin.database
    .from("pending_actions")
    .insert([{ organization_id: ctx.organizationId, conversation_id: ctx.conversationId, action_type: actionType, payload, summary }])
    .select("id, expires_at")
    .single();

  if (error || !data) {
    throw new AppError(ErrorCodes.INTERNAL_ERROR, "No se pudo registrar la propuesta.", 500);
  }

  return ok(
    { accion_id: data.id, resumen: summary, requiere_confirmacion: true, instruccion: CONFIRM_INSTRUCTION, vence: data.expires_at },
    { tipo_dato: "ACCION", fuente: "Propuesta validada por el sistema, pendiente de confirmación", fecha_datos: ctx.now.toISOString() }
  );
}

async function loadAction(ctx: ToolContext, actionId: string): Promise<PendingActionRow | null> {
  const { data } = await insforgeAdmin.database
    .from("pending_actions")
    .select("id, action_type, payload, summary, status, created_at, expires_at")
    .eq("id", actionId)
    .eq("conversation_id", ctx.conversationId)
    .maybeSingle();
  return (data as PendingActionRow | null) ?? null;
}

async function residentRepliedAfter(ctx: ToolContext, since: string): Promise<boolean> {
  const { data } = await insforgeAdmin.database
    .from("messages")
    .select("id")
    .eq("conversation_id", ctx.conversationId)
    .eq("role", "user")
    .gt("created_at", since)
    .limit(1);
  return Array.isArray(data) && data.length > 0;
}

async function resolveAction(actionId: string, status: string, result: unknown) {
  await insforgeAdmin.database
    .from("pending_actions")
    .update({ status, result, resolved_at: new Date().toISOString() })
    .eq("id", actionId);
}

/**
 * Ejecuta una acción propuesta SOLO si el residente escribió después de
 * la propuesta, y ejecuta exactamente el payload validado (el modelo no
 * puede cambiar datos al confirmar). En vista previa no ejecuta nada.
 */
export async function confirmAction(ctx: ToolContext, actionId: string): Promise<ToolResult> {
  const action = await loadAction(ctx, actionId);
  if (!action) return fail(ErrorCodes.ACTION_NOT_FOUND, "No existe una propuesta con ese accion_id en esta conversación.");
  if (action.status !== "pending") {
    return fail(ErrorCodes.ACTION_ALREADY_RESOLVED, `La propuesta ya fue resuelta (estado: ${action.status}).`);
  }
  if (new Date(action.expires_at).getTime() < ctx.now.getTime()) {
    await resolveAction(action.id, "expired", null);
    return fail(ErrorCodes.ACTION_EXPIRED, "La propuesta venció. Vuelve a proponerla con los datos actualizados.");
  }
  if (!(await residentRepliedAfter(ctx, action.created_at))) {
    return fail(
      ErrorCodes.CONFIRMATION_REQUIRED,
      "El residente todavía no ha respondido a la propuesta. Muéstrale el resumen y espera su confirmación."
    );
  }

  const { data: claimed } = await insforgeAdmin.database
    .from("pending_actions")
    .update({ status: "executed", resolved_at: new Date().toISOString() })
    .eq("id", action.id)
    .eq("status", "pending")
    .select("id");
  if (!Array.isArray(claimed) || claimed.length === 0) {
    return fail(ErrorCodes.ACTION_ALREADY_RESOLVED, "La propuesta ya fue resuelta.");
  }

  if (ctx.isPreview) {
    await resolveAction(action.id, "executed", { simulated: true });
    return ok({
      simulado: true,
      resumen: action.summary,
      mensaje: "Vista previa: la acción NO se ejecutó. En WhatsApp o Telegram se registraría de verdad."
    });
  }

  try {
    const result = await ACTION_EXECUTORS[action.action_type](action.payload, ctx);
    await resolveAction(action.id, "executed", result);
    return ok(result, { tipo_dato: "ACCION", fuente: "Registro confirmado en el sistema", fecha_datos: new Date().toISOString() });
  } catch (err) {
    const appError = err instanceof AppError ? err : new AppError(ErrorCodes.INTERNAL_ERROR, "No se pudo completar la acción.", 500);
    if (!(err instanceof AppError)) logger.error({ err, actionId: action.id }, "pending_action_execution_failed");
    await resolveAction(action.id, "failed", { error_code: appError.code, message: appError.message });
    return fail(appError.code, appError.message);
  }
}

export async function discardAction(ctx: ToolContext, actionId: string): Promise<ToolResult> {
  const { data } = await insforgeAdmin.database
    .from("pending_actions")
    .update({ status: "discarded", resolved_at: new Date().toISOString() })
    .eq("id", actionId)
    .eq("conversation_id", ctx.conversationId)
    .eq("status", "pending")
    .select("id");
  if (!Array.isArray(data) || data.length === 0) {
    return fail(ErrorCodes.ACTION_NOT_FOUND, "No hay una propuesta pendiente con ese accion_id.");
  }
  return ok({ descartada: true });
}
