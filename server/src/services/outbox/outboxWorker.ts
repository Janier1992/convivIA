import { insforgeAdmin } from "../../lib/insforge.js";
import { createIntervalWorker } from "../../lib/intervalWorker.js";
import { logger } from "../../lib/logger.js";
import type { OutboundMessage } from "../../types/domain.js";
import { deliverOutbound, PermanentDeliveryError } from "./outboxSender.js";

const TICK_MS = 2_000;
const BATCH_SIZE = 20;
export const MAX_ATTEMPTS = 3;
const PAUSE_BETWEEN_SENDS_MS = 120;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function markSent(message: OutboundMessage, mode: string) {
  const sentAt = new Date().toISOString();
  await insforgeAdmin.database.from("outbound_messages").update({ status: "sent", sent_at: sentAt, last_error: null }).eq("id", message.id);
  // Los avisos proactivos quedan en el historial de la conversación: el
  // Inbox los muestra y el asistente tiene contexto si el residente responde.
  if (message.conversation_id && message.kind !== "staff_reply") {
    await insforgeAdmin.database.from("messages").insert([
      {
        organization_id: message.organization_id,
        conversation_id: message.conversation_id,
        role: "assistant",
        content: message.body,
        metadata: { outbound_id: message.id, kind: message.kind, delivery: mode }
      }
    ]);
  }
}

async function markFailure(message: OutboundMessage, err: unknown) {
  const reason = err instanceof Error ? err.message : "Error desconocido";
  const permanent = err instanceof PermanentDeliveryError;
  // Nunca se reintenta indefinidamente: máximo MAX_ATTEMPTS con espera creciente.
  const retry = !permanent && message.attempts < MAX_ATTEMPTS;
  await insforgeAdmin.database
    .from("outbound_messages")
    .update({
      status: retry ? "queued" : "failed",
      last_error: reason.slice(0, 500),
      scheduled_at: new Date(Date.now() + message.attempts * 30_000).toISOString()
    })
    .eq("id", message.id);
  logger.warn({ outboundId: message.id, kind: message.kind, permanent, retry, reason }, "outbound_delivery_failed");
}

export async function processOutboxBatch(): Promise<number> {
  const { data, error } = await insforgeAdmin.database.rpc("claim_outbound_messages", { p_limit: BATCH_SIZE });
  if (error) {
    logger.warn({ err: error }, "outbox_claim_failed");
    return 0;
  }
  const messages = (data ?? []) as OutboundMessage[];
  for (const message of messages) {
    try {
      const mode = await deliverOutbound(message);
      await markSent(message, mode);
    } catch (err) {
      await markFailure(message, err);
    }
    await sleep(PAUSE_BETWEEN_SENDS_MS);
  }
  return messages.length;
}

export const outboxWorker = createIntervalWorker("outbox", TICK_MS, async () => {
  await processOutboxBatch();
});
