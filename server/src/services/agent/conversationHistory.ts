import type OpenAI from "openai";
import type { Message } from "../../types/domain.js";

type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;
type ToolCall = OpenAI.Chat.Completions.ChatCompletionMessageToolCall;

const MAX_TOOL_CONTENT = 6000;

/**
 * Convierte el historial persistido al formato de OpenAI garantizando que
 * cada mensaje 'tool' siga a su llamada: al recortar el historial a los
 * últimos N mensajes puede quedar un resultado de herramienta huérfano (o
 * una llamada sin resultados), y la API rechaza el turno completo con 400.
 * Los intercambios incompletos se descartan en bloque.
 */
export function toOpenAiHistory(rows: Message[]): ChatMessage[] {
  const out: ChatMessage[] = [];

  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];

    if (row.role === "user") {
      out.push({ role: "user", content: row.content });
      continue;
    }

    if (row.role === "staff") {
      out.push({ role: "assistant", content: `(Respuesta del equipo de administración) ${row.content}` });
      continue;
    }

    if (row.role !== "assistant") continue;

    const toolCalls = (row.metadata?.tool_calls as ToolCall[] | undefined) ?? [];
    if (toolCalls.length === 0) {
      if (row.content) out.push({ role: "assistant", content: row.content });
      continue;
    }

    const expected = new Set(toolCalls.map((call) => call.id));
    const results: Message[] = [];
    let next = index + 1;
    while (next < rows.length && rows[next].role === "tool") {
      const callId = rows[next].metadata?.tool_call_id as string | undefined;
      if (callId && expected.has(callId)) results.push(rows[next]);
      next++;
    }

    if (results.length === toolCalls.length) {
      out.push({ role: "assistant", content: row.content || null, tool_calls: toolCalls });
      for (const result of results) {
        out.push({
          role: "tool",
          tool_call_id: result.metadata?.tool_call_id as string,
          content: result.content.slice(0, MAX_TOOL_CONTENT)
        });
      }
    }
    index = next - 1;
  }

  return out;
}
