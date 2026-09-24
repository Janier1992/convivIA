import { insforgeAdmin } from "../../lib/insforge.js";
import { logger } from "../../lib/logger.js";

export type TraceOutcome = "reply" | "fallback" | "skipped" | "handoff" | "error";

/**
 * Acumula métricas de un turno del asistente (sin contenido de mensajes)
 * para ai_traces: rondas, herramientas, errores, latencia y tokens.
 */
export class TurnTrace {
  private readonly startedAt = Date.now();
  rounds = 0;
  readonly toolsUsed: string[] = [];
  toolErrors = 0;
  promptTokens = 0;
  completionTokens = 0;

  constructor(
    private readonly base: {
      organizationId: string;
      conversationId: string;
      channel: string | null;
      isPreview: boolean;
      identityStatus: string | null;
      model: string;
    }
  ) {}

  addUsage(usage: { prompt_tokens?: number; completion_tokens?: number } | undefined) {
    this.promptTokens += usage?.prompt_tokens ?? 0;
    this.completionTokens += usage?.completion_tokens ?? 0;
  }

  addTool(name: string, success: boolean) {
    this.toolsUsed.push(name);
    if (!success) this.toolErrors++;
  }

  async save(outcome: TraceOutcome): Promise<void> {
    try {
      await insforgeAdmin.database.from("ai_traces").insert([
        {
          organization_id: this.base.organizationId,
          conversation_id: this.base.conversationId,
          channel: this.base.channel,
          is_preview: this.base.isPreview,
          identity_status: this.base.identityStatus,
          rounds: this.rounds,
          tools_used: this.toolsUsed,
          tool_errors: this.toolErrors,
          outcome,
          latency_ms: Date.now() - this.startedAt,
          prompt_tokens: this.promptTokens || null,
          completion_tokens: this.completionTokens || null,
          model: this.base.model
        }
      ]);
    } catch (err) {
      logger.warn({ err, conversationId: this.base.conversationId }, "ai_trace_save_failed");
    }
  }
}
