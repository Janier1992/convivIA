import type { z } from "zod";
import type OpenAI from "openai";
import { AppError, ErrorCodes } from "../../utils/AppError.js";
import type { AgentConfig, CommonAreaSummary, ConversationChannel, IdentityStatus, ResidentIdentity } from "../../types/domain.js";

/** Acciones que el canal ejecuta junto con la respuesta (p. ej. botón de contacto en Telegram). */
export type ChannelAction = "request_contact";

export type ToolAccess = "public" | "verified";

export type Capability = "core" | "finance" | "payment_reports" | "pqrs" | "reservations" | "documents" | "handoff" | "visitors";

/** Clasificación de veracidad (sección 11 del prompt maestro). */
export type DataType = "DATO_ESTRUCTURADO" | "DOCUMENTAL" | "CALCULO" | "ACCION";

export interface ToolMeta {
  tipo_dato: DataType;
  fuente: string;
  fecha_datos: string;
}

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error_code?: string;
  message?: string;
  meta?: ToolMeta;
}

export interface ToolContext {
  organizationId: string;
  conversationId: string;
  channel: ConversationChannel;
  timezone: string;
  isPreview: boolean;
  identityStatus: IdentityStatus;
  identity: ResidentIdentity | null;
  propertyName: string;
  agent: AgentConfig;
  areas: CommonAreaSummary[];
  now: Date;
  channelActions: Set<ChannelAction>;
}

export interface ToolDefinition<TArgs = unknown> {
  name: string;
  description: string;
  parameters: OpenAI.FunctionParameters;
  schema: z.ZodType<TArgs>;
  access: ToolAccess;
  capability: Capability;
  /** Si existe, decide si la herramienta aplica para este contexto (además de acceso/capacidad). */
  isAvailable?: (ctx: ToolContext) => boolean;
  execute(args: TArgs, ctx: ToolContext): Promise<ToolResult>;
}

export function ok(data: unknown, meta?: ToolMeta): ToolResult {
  return meta ? { success: true, data, meta } : { success: true, data };
}

export function fail(code: string, message: string): ToolResult {
  return { success: false, error_code: code, message };
}

export function structuredMeta(fuente: string, fecha: Date | string = new Date()): ToolMeta {
  return { tipo_dato: "DATO_ESTRUCTURADO", fuente, fecha_datos: typeof fecha === "string" ? fecha : fecha.toISOString() };
}

/** Exige un residente verificado con al menos una unidad activa. */
export function requireIdentity(ctx: ToolContext): ResidentIdentity {
  if (ctx.identityStatus !== "verified" || !ctx.identity || ctx.identity.units.length === 0) {
    throw new AppError(ErrorCodes.NOT_VERIFIED, "La persona no está verificada como residente de una unidad activa.", 403);
  }
  return ctx.identity;
}

/** Envuelve a una función en el formato estándar de resultado. */
export async function toToolResult(fn: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AppError) return fail(err.code, err.message);
    return fail(ErrorCodes.INTERNAL_ERROR, "Ocurrió un error interno al consultar la información.");
  }
}
