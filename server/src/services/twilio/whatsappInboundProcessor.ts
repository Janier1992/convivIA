import { logger } from "../../lib/logger.js";
import type { Conversation } from "../../types/domain.js";
import { runAgentTurn } from "../agent/agentRuntime.js";
import { verifyConversationByPhone } from "../conversations/identityService.js";
import { findOrCreateConversation, persistAssistantMessage, persistInboundMessage } from "../conversations/inboundMessageHandler.js";
import { applyChannelCommand, detectChannelCommand, withPrivacyNotice } from "../conversations/replyComposer.js";
import { handleReceiptMedia, receiptReplyText } from "../finance/receiptService.js";
import { downloadTwilioMedia, sendWhatsAppMessage, type TwilioCredentials } from "./twilioService.js";

export interface WhatsAppInbound {
  organizationId: string;
  credentials: TwilioCredentials;
  fromPhone: string;
  body: string;
  messageSid?: string;
  profileName?: string;
  media?: { url: string; contentType: string };
}

async function reply(conversation: Conversation, organizationId: string, phone: string, text: string) {
  const finalText = await withPrivacyNotice(conversation, text);
  await persistAssistantMessage(conversation, finalText);
  await sendWhatsAppMessage(organizationId, phone, finalText);
}

/**
 * El número "From" lo autentica WhatsApp: si está en el censo, la
 * conversación queda verificada sin pedir nada más. Se revisa en cada
 * mensaje mientras no esté verificada (la administración puede haber
 * actualizado el censo mientras tanto).
 */
async function ensureIdentity(conversation: Conversation, phone: string): Promise<Conversation> {
  if (conversation.identity_status === "verified" && conversation.person_id) return conversation;
  const result = await verifyConversationByPhone(conversation, phone, "whatsapp_phone");
  return {
    ...conversation,
    identity_status: result.status,
    person_id: result.identity?.personId ?? null
  };
}

export async function processWhatsAppInbound(input: WhatsAppInbound): Promise<void> {
  const { organizationId, fromPhone } = input;
  let conversation = await findOrCreateConversation({
    organizationId,
    channel: "whatsapp",
    externalConversationId: fromPhone,
    externalIdentity: fromPhone,
    contactName: input.profileName
  });
  conversation = await ensureIdentity(conversation, fromPhone);

  if (input.media) {
    try {
      const bytes = await downloadTwilioMedia(input.credentials, input.media.url);
      const outcome = await handleReceiptMedia(conversation, { bytes, mimeType: input.media.contentType, externalMessageId: input.messageSid });
      await reply(conversation, organizationId, fromPhone, receiptReplyText(outcome, "whatsapp"));
    } catch (err) {
      logger.error({ organizationId, err }, "whatsapp_receipt_processing_failed");
      await reply(conversation, organizationId, fromPhone, "No pude procesar el archivo. Por favor intenta enviarlo de nuevo.");
    }
    if (!input.body.trim()) return;
  }

  await persistInboundMessage(conversation, { content: input.body, externalMessageId: input.messageSid });

  const command = detectChannelCommand(input.body);
  if (command) {
    await reply(conversation, organizationId, fromPhone, await applyChannelCommand(conversation, command));
    return;
  }

  const result = await runAgentTurn({ organizationId, conversationId: conversation.id, requestId: input.messageSid });
  if (!result.reply) return;
  const finalText = await withPrivacyNotice(conversation, result.reply);
  await sendWhatsAppMessage(organizationId, fromPhone, finalText);
}
