import { logger } from "../../lib/logger.js";
import { relationLabel } from "../../lib/format.js";
import { firstName } from "../../lib/text.js";
import type { Conversation } from "../../types/domain.js";
import { runAgentTurn } from "../agent/agentRuntime.js";
import { verifyConversationByPhone } from "../conversations/identityService.js";
import {
  findOrCreateConversation,
  persistAssistantMessage,
  persistInboundMessage,
  updateConversation
} from "../conversations/inboundMessageHandler.js";
import { applyChannelCommand, detectChannelCommand, loadPropertyBranding, privacyNotice, withPrivacyNotice } from "../conversations/replyComposer.js";
import { handleReceiptMedia, receiptReplyText } from "../finance/receiptService.js";
import {
  downloadTelegramFile,
  mimeTypeFromPath,
  REMOVE_KEYBOARD,
  REQUEST_CONTACT_KEYBOARD,
  sendTelegramMessage,
  sendTelegramTypingAction,
  type TelegramMessage,
  type TelegramUpdate
} from "./telegramService.js";

const TYPING_REFRESH_MS = 4_000;

async function withTypingIndicator<T>(botToken: string, chatId: number, task: Promise<T>): Promise<T> {
  void sendTelegramTypingAction(botToken, chatId);
  const interval = setInterval(() => void sendTelegramTypingAction(botToken, chatId), TYPING_REFRESH_MS);
  try {
    return await task;
  } finally {
    clearInterval(interval);
  }
}

function displayName(from: TelegramMessage["from"]): string | undefined {
  const name = [from?.first_name, from?.last_name].filter(Boolean).join(" ").trim();
  return name || undefined;
}

interface Session {
  organizationId: string;
  botToken: string;
  chatId: number;
  conversation: Conversation;
}

/** Envía y deja constancia en el historial (lo que ve el Inbox). */
async function reply(session: Session, text: string, replyMarkup?: Record<string, unknown>) {
  await persistAssistantMessage(session.conversation, text);
  await sendTelegramMessage(session.botToken, session.chatId, text, { replyMarkup });
}

async function handleStart(session: Session) {
  await persistInboundMessage(session.conversation, { content: "/start" });
  const branding = await loadPropertyBranding(session.organizationId);
  const verified = session.conversation.identity_status === "verified";
  const text =
    `¡Hola! 👋 Soy ${branding.agentName}, el asistente virtual de ${branding.name}. Te ayudo con tu estado de cuenta, ` +
    "reportes de pago, PQRS, reservas de zonas comunes, comunicados y dudas del reglamento.\n\n" +
    (verified ? "¿En qué te puedo ayudar?" : "Para consultar la información de tu unidad necesito verificar tu identidad: toca el botón “Compartir mi número”.") +
    `\n\n${privacyNotice(branding)}`;
  await updateConversation(session.conversation.id, {
    privacy_notice_sent_at: new Date().toISOString(),
    ...(verified ? {} : { contact_requested_at: new Date().toISOString() })
  });
  await reply(session, text, verified ? undefined : REQUEST_CONTACT_KEYBOARD);
}

async function handleContact(session: Session, message: TelegramMessage) {
  const contact = message.contact!;
  await persistInboundMessage(session.conversation, { content: "[Compartió su número de contacto]", messageType: "contact" });
  // Solo vale el contacto PROPIO: Telegram certifica user_id == remitente.
  if (!contact.user_id || contact.user_id !== message.from?.id) {
    await reply(session, "Por seguridad solo puedo verificar tu propio número. Toca el botón “Compartir mi número”.", REQUEST_CONTACT_KEYBOARD);
    return;
  }
  const result = await verifyConversationByPhone(session.conversation, contact.phone_number, "telegram_contact");
  const branding = await loadPropertyBranding(session.organizationId);
  if (result.status === "verified" && result.identity && result.identity.units.length > 0) {
    const units = result.identity.units.map((u) => `${u.code} (${u.relations.map(relationLabel).join(", ")})`).join(", ");
    await reply(session, `¡Gracias, ${firstName(result.identity.fullName)}! Verifiqué tu identidad: ${units}. ¿En qué te ayudo?`, REMOVE_KEYBOARD);
    return;
  }
  await reply(
    session,
    `No encontré tu número en el censo de ${branding.name}. Puedo ayudarte con información general o pedir a la administración que actualice tus datos.`,
    REMOVE_KEYBOARD
  );
}

async function handleMedia(session: Session, message: TelegramMessage) {
  const fileId = message.photo?.length ? message.photo[message.photo.length - 1].file_id : message.document?.file_id;
  if (!fileId) return;
  try {
    const { bytes, filePath } = await downloadTelegramFile(session.botToken, fileId);
    const mimeType = message.document?.mime_type ?? mimeTypeFromPath(filePath);
    const outcome = await handleReceiptMedia(session.conversation, { bytes, mimeType, externalMessageId: String(message.message_id) });
    await reply(session, receiptReplyText(outcome, "telegram"), outcome.kind === "needs_verification" ? REQUEST_CONTACT_KEYBOARD : undefined);
  } catch (err) {
    logger.error({ organizationId: session.organizationId, err }, "telegram_receipt_processing_failed");
    await reply(session, "No pude procesar el archivo. Por favor intenta enviarlo de nuevo.");
  }
}

async function handleText(session: Session, message: TelegramMessage, updateId: number) {
  const text = message.text!;
  await persistInboundMessage(session.conversation, { content: text, externalMessageId: String(message.message_id) });

  const command = detectChannelCommand(text);
  if (command) {
    await reply(session, await applyChannelCommand(session.conversation, command));
    return;
  }

  const result = await withTypingIndicator(
    session.botToken,
    session.chatId,
    runAgentTurn({ organizationId: session.organizationId, conversationId: session.conversation.id, requestId: `telegram:${updateId}` })
  );
  if (!result.reply) return;
  const finalText = await withPrivacyNotice(session.conversation, result.reply);
  const replyMarkup = result.channelActions.includes("request_contact") ? REQUEST_CONTACT_KEYBOARD : undefined;
  await sendTelegramMessage(session.botToken, session.chatId, finalText, { replyMarkup });
}

export async function processUpdate(organizationId: string, botToken: string, update: TelegramUpdate): Promise<void> {
  const message = update.message;
  if (!message?.chat?.id || message.chat.type !== "private") return;

  const chatId = message.chat.id;
  const conversation = await findOrCreateConversation({
    organizationId,
    channel: "telegram",
    externalConversationId: String(chatId),
    externalIdentity: `telegram:${chatId}`,
    contactName: displayName(message.from)
  });
  const session: Session = { organizationId, botToken, chatId, conversation };

  if (message.contact) return handleContact(session, message);
  if (message.photo?.length || message.document) return handleMedia(session, message);
  if (!message.text) return;
  if (message.text.trim().startsWith("/start")) return handleStart(session);
  return handleText(session, message, update.update_id);
}
