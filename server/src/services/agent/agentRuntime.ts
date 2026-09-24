import type OpenAI from "openai";
import { openai, OPENAI_MODEL, IS_OPENROUTER } from "../../lib/openai.js";
import { insforgeAdmin } from "../../lib/insforge.js";
import { logAgentEvent, logger } from "../../lib/logger.js";
import { AGENT_TIMEOUT_MS, MAX_CONVERSATION_HISTORY_MESSAGES, MAX_MESSAGE_LENGTH } from "../../config/env.js";
import type { Message, MessageRole } from "../../types/domain.js";
import { loadAgentContext, type AgentContext } from "./agentContext.js";
import { toOpenAiHistory } from "./conversationHistory.js";
import { MAX_TOOL_ROUNDS } from "./coreRules.js";
import { buildSystemPrompt } from "./promptBuilder.js";
import { executeTool, getAvailableTools, toOpenAiTools } from "./toolRegistry.js";
import type { ChannelAction, ToolContext, ToolDefinition } from "./toolTypes.js";
import { TurnTrace, type TraceOutcome } from "./traces.js";

export const FALLBACK_REPLY =
  "Disculpa, tuve un inconveniente para procesar tu mensaje. Si es urgente, comunícate con la administración; también puedes intentarlo de nuevo en unos minutos.";

// Algunos proveedores de OpenRouter filtran su token interno de "fin de
// turno" en el texto visible: `stop` lo corta cuando se respeta y el regex
// es la red de seguridad cuando no.
const KNOWN_LEAKED_CONTROL_TOKENS = ["<CPA_DONE>"];

function stripLeakedControlTokens(text: string): string {
  return text.replace(/<\/?[A-Z][A-Z0-9_]*>/g, "").trim();
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label}_timeout`)), ms);
    })
  ]);
}

async function persistMessage(input: {
  organizationId: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  metadata?: Record<string, unknown>;
}) {
  await insforgeAdmin.database.from("messages").insert([
    {
      organization_id: input.organizationId,
      conversation_id: input.conversationId,
      role: input.role,
      content: input.content,
      metadata: input.metadata ?? {}
    }
  ]);
}

async function loadHistory(conversationId: string): Promise<Message[] | null> {
  const { data, error } = await insforgeAdmin.database
    .from("messages")
    .select("id, role, content, message_type, metadata, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(MAX_CONVERSATION_HISTORY_MESSAGES);
  if (error) return null;
  return ((data ?? []) as Message[]).slice().reverse();
}

export interface RunAgentTurnParams {
  organizationId: string;
  conversationId: string;
  requestId?: string;
  previewMode?: boolean;
}

export interface RunAgentTurnResult {
  reply: string | null;
  roundsUsed: number;
  channelActions: ChannelAction[];
  outcome: TraceOutcome;
}

function buildToolContext(context: AgentContext, previewMode: boolean, now: Date): ToolContext {
  // Una conversación marcada como verificada cuya persona ya no existe (o
  // quedó sin unidades activas) se trata como no verificada.
  const verified = context.conversation.identity_status === "verified" && context.identity !== null;
  const identityStatus = verified ? "verified" : context.conversation.identity_status === "not_registered" ? "not_registered" : "unverified";
  return {
    organizationId: context.organization.id,
    conversationId: context.conversation.id,
    channel: context.conversation.channel,
    timezone: context.organization.timezone,
    isPreview: previewMode || context.conversation.is_preview,
    identityStatus,
    identity: verified ? context.identity : null,
    propertyName: context.profile.display_name,
    agent: context.agent,
    areas: context.agent.reservations_enabled ? context.areas : [],
    now,
    channelActions: new Set()
  };
}

function skipReason(context: AgentContext): string | null {
  if (context.organization.status !== "active") return "organization_not_active";
  if (!context.agent.enabled) return "agent_disabled";
  if (context.conversation.status === "handoff") return "conversation_in_handoff";
  return null;
}

async function runToolCalls(
  toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[],
  ctx: ToolContext,
  available: ToolDefinition[],
  trace: TurnTrace,
  logCtx: { organizationId: string; conversationId: string; requestId?: string }
) {
  // Las herramientas de una ronda son independientes: se ejecutan en paralelo.
  return Promise.all(
    toolCalls.map(async (toolCall) => {
      const started = Date.now();
      let args: unknown = {};
      try {
        args = toolCall.function.arguments ? JSON.parse(toolCall.function.arguments) : {};
      } catch {
        args = {};
      }
      const result = await executeTool(toolCall.function.name, args, ctx, available);
      trace.addTool(toolCall.function.name, result.success);
      logAgentEvent(logCtx, {
        scope: "agent",
        tool: toolCall.function.name,
        durationMs: Date.now() - started,
        result: result.success ? "success" : "error",
        message: result.success ? undefined : result.error_code
      });
      return { toolCall, result };
    })
  );
}

/**
 * Un turno completo del asistente: contexto -> prompt modular ->
 * herramientas filtradas por identidad/capacidades -> bucle de tool-calling
 * acotado. Supone que el mensaje del residente YA está persistido.
 */
async function runAgentTurnInternal(params: RunAgentTurnParams): Promise<RunAgentTurnResult> {
  const { organizationId, conversationId, requestId, previewMode = false } = params;
  const logCtx = { organizationId, conversationId, requestId };
  const now = new Date();
  const context = await loadAgentContext(organizationId, conversationId);
  const trace = new TurnTrace({
    organizationId,
    conversationId,
    channel: context.conversation.channel,
    isPreview: previewMode || context.conversation.is_preview,
    identityStatus: context.conversation.identity_status,
    model: OPENAI_MODEL
  });

  const skip = skipReason(context);
  if (skip) {
    logAgentEvent(logCtx, { scope: "agent", result: "success", message: skip });
    return { reply: null, roundsUsed: 0, channelActions: [], outcome: "skipped" };
  }

  const history = await loadHistory(conversationId);
  if (!history) {
    await trace.save("error");
    return { reply: FALLBACK_REPLY, roundsUsed: 0, channelActions: [], outcome: "error" };
  }

  const ctx = buildToolContext(context, previewMode, now);
  const available = getAvailableTools(ctx);
  const tools = toOpenAiTools(available);
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: buildSystemPrompt(context, available.map((t) => t.name), now) },
    ...toOpenAiHistory(history)
  ];

  for (let round = 1; round <= MAX_TOOL_ROUNDS; round++) {
    trace.rounds = round;
    let completion: OpenAI.Chat.Completions.ChatCompletion;
    try {
      const body: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
        model: OPENAI_MODEL,
        messages,
        tools: tools.length > 0 ? tools : undefined,
        tool_choice: tools.length > 0 ? "auto" : undefined,
        temperature: 0.3,
        stop: KNOWN_LEAKED_CONTROL_TOKENS
      };
      if (IS_OPENROUTER) {
        (body as unknown as { provider: { sort: string } }).provider = { sort: "throughput" };
      }
      completion = await withTimeout(openai.chat.completions.create(body), AGENT_TIMEOUT_MS, "openai_completion");
      trace.addUsage(completion.usage);
    } catch (err) {
      logger.error({ ...logCtx, err }, "agent_openai_error");
      await trace.save("fallback");
      return { reply: FALLBACK_REPLY, roundsUsed: round, channelActions: [], outcome: "fallback" };
    }

    const responseMessage = completion.choices[0]?.message;
    const toolCalls = responseMessage?.tool_calls ?? [];

    if (toolCalls.length > 0) {
      messages.push({ role: "assistant", content: responseMessage?.content ?? null, tool_calls: toolCalls });
      await persistMessage({
        organizationId,
        conversationId,
        role: "assistant",
        content: stripLeakedControlTokens(responseMessage?.content ?? ""),
        metadata: { tool_calls: toolCalls }
      });

      const results = await runToolCalls(toolCalls, ctx, available, trace, logCtx);
      for (const { toolCall, result } of results) {
        const content = JSON.stringify(result);
        messages.push({ role: "tool", tool_call_id: toolCall.id, content });
        await persistMessage({
          organizationId,
          conversationId,
          role: "tool",
          content,
          metadata: { tool_call_id: toolCall.id, name: toolCall.function.name }
        });
      }
      continue;
    }

    const reply = stripLeakedControlTokens(responseMessage?.content ?? "").slice(0, MAX_MESSAGE_LENGTH) || FALLBACK_REPLY;
    await persistMessage({ organizationId, conversationId, role: "assistant", content: reply });
    const outcome: TraceOutcome = trace.toolsUsed.includes("escalar_a_humano") ? "handoff" : "reply";
    await trace.save(outcome);
    return { reply, roundsUsed: round, channelActions: [...ctx.channelActions], outcome };
  }

  logAgentEvent(logCtx, { scope: "agent", result: "error", message: "max_tool_rounds_exceeded" });
  await persistMessage({ organizationId, conversationId, role: "assistant", content: FALLBACK_REPLY });
  await trace.save("fallback");
  return { reply: FALLBACK_REPLY, roundsUsed: MAX_TOOL_ROUNDS, channelActions: [], outcome: "fallback" };
}

// Dos mensajes seguidos del mismo residente disparan dos turnos: esta cola
// por conversación obliga a que uno termine (y persista su respuesta)
// antes de que arranque el siguiente, sin bloquear otras conversaciones.
const conversationLocks = new Map<string, Promise<void>>();

export function runAgentTurn(params: RunAgentTurnParams): Promise<RunAgentTurnResult> {
  const previous = conversationLocks.get(params.conversationId) ?? Promise.resolve();
  const result = previous.then(() => runAgentTurnInternal(params));
  const lock = result.then(
    () => undefined,
    () => undefined
  );
  conversationLocks.set(params.conversationId, lock);
  lock.then(() => {
    if (conversationLocks.get(params.conversationId) === lock) conversationLocks.delete(params.conversationId);
  });
  return result;
}
