import type OpenAI from "openai";
import { ErrorCodes } from "../../utils/AppError.js";
import type { AgentConfig } from "../../types/domain.js";
import { AREA_TOOLS } from "./tools/areaTools.js";
import { CONVERSATION_TOOLS } from "./tools/conversationTools.js";
import { FINANCE_TOOLS } from "./tools/financeTools.js";
import { INFO_TOOLS } from "./tools/infoTools.js";
import { PORTERIA_TOOLS } from "./tools/porteriaTools.js";
import { PQRS_TOOLS } from "./tools/pqrsTools.js";
import { fail, type Capability, type ToolContext, type ToolDefinition, type ToolResult } from "./toolTypes.js";

export const ALL_TOOLS: ToolDefinition[] = [
  ...INFO_TOOLS, ...FINANCE_TOOLS, ...PQRS_TOOLS, ...AREA_TOOLS, ...PORTERIA_TOOLS, ...CONVERSATION_TOOLS
];

const CAPABILITY_FLAGS: Record<Exclude<Capability, "core">, keyof AgentConfig> = {
  finance: "finance_enabled",
  payment_reports: "payment_reports_enabled",
  pqrs: "pqrs_enabled",
  reservations: "reservations_enabled",
  documents: "documents_enabled",
  handoff: "handoff_enabled",
  visitors: "visitors_enabled"
};

export function isCapabilityEnabled(agent: AgentConfig, capability: Capability): boolean {
  return capability === "core" || Boolean(agent[CAPABILITY_FLAGS[capability]]);
}

/**
 * Router por exposición mínima: el modelo solo ve las herramientas que
 * aplican a esta conversación. Las privadas exigen un residente
 * verificado con unidades activas; las capacidades apagadas desaparecen.
 * Así, una intención no autorizada no tiene herramienta que la ejecute.
 */
export function getAvailableTools(ctx: ToolContext): ToolDefinition[] {
  const verified = ctx.identityStatus === "verified" && (ctx.identity?.units.length ?? 0) > 0;
  return ALL_TOOLS.filter((tool) => {
    if (!isCapabilityEnabled(ctx.agent, tool.capability)) return false;
    if (tool.access === "verified" && !verified) return false;
    if (tool.capability === "reservations" && ctx.areas.length === 0) return false;
    return tool.isAvailable ? tool.isAvailable(ctx) : true;
  });
}

export function toOpenAiTools(tools: ToolDefinition[]): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return tools.map((tool) => ({
    type: "function",
    function: { name: tool.name, description: tool.description, parameters: tool.parameters }
  }));
}

/**
 * Ejecuta una herramienta solicitada por el modelo, revalidando que esté
 * disponible para ESTE contexto (el modelo podría "inventar" el nombre de
 * una herramienta que no se le ofreció) y validando argumentos con Zod.
 */
export async function executeTool(name: string, rawArgs: unknown, ctx: ToolContext, available: ToolDefinition[]): Promise<ToolResult> {
  const tool = available.find((t) => t.name === name);
  if (!tool) {
    return fail("TOOL_NOT_AVAILABLE", `La herramienta ${name} no está disponible en esta conversación.`);
  }
  const parsed = tool.schema.safeParse(rawArgs ?? {});
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "argumentos"}: ${i.message}`).join("; ");
    return fail(ErrorCodes.VALIDATION_ERROR, `Argumentos inválidos para ${name}: ${issues}`);
  }
  try {
    return await tool.execute(parsed.data, ctx);
  } catch {
    return fail(ErrorCodes.INTERNAL_ERROR, "Ocurrió un error interno al ejecutar la herramienta.");
  }
}
