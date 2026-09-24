import { insforgeAdmin } from "../../lib/insforge.js";
import { logger } from "../../lib/logger.js";
import type { Conversation } from "../../types/domain.js";
import { loadResidentIdentity } from "../agent/agentContext.js";
import type { ResidentIdentity } from "../../types/domain.js";

export type VerificationVia = "whatsapp_phone" | "telegram_contact";

export interface VerificationResult {
  status: "verified" | "not_registered";
  identity: ResidentIdentity | null;
}

/**
 * Verificación determinista (sin LLM): el teléfono lo certifica el canal
 * (el remitente de WhatsApp, o el contacto propio compartido en Telegram)
 * y se cruza con el censo. Nunca se confía en un número escrito en el chat.
 */
export async function verifyConversationByPhone(
  conversation: Conversation,
  phone: string,
  via: VerificationVia
): Promise<VerificationResult> {
  const { data, error } = await insforgeAdmin.database.rpc("find_person_by_phone", {
    p_organization_id: conversation.organization_id,
    p_phone: phone
  });
  if (error) {
    logger.warn({ conversationId: conversation.id, err: error }, "identity_lookup_failed");
    return { status: "not_registered", identity: null };
  }

  const person = (Array.isArray(data) ? data[0] : data) as { person_id: string } | undefined;
  if (!person?.person_id) {
    await insforgeAdmin.database
      .from("conversations")
      .update({ identity_status: "not_registered", person_id: null, verified_at: null, verified_via: null })
      .eq("id", conversation.id);
    return { status: "not_registered", identity: null };
  }

  const now = new Date().toISOString();
  await insforgeAdmin.database
    .from("conversations")
    .update({ person_id: person.person_id, identity_status: "verified", verified_at: now, verified_via: via })
    .eq("id", conversation.id);

  // Compartir el contacto después del aviso de privacidad es un acto
  // afirmativo del titular: se registra como autorización si no existía.
  if (via === "telegram_contact") {
    await insforgeAdmin.database
      .from("persons")
      .update({ data_consent_at: now, data_consent_source: "telegram_contact" })
      .eq("id", person.person_id)
      .is("data_consent_at", null);
  }

  const identity = await loadResidentIdentity(conversation.organization_id, person.person_id);
  return { status: "verified", identity };
}
