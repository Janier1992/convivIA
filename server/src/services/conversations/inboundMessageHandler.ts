import { insforgeAdmin } from "../../lib/insforge.js";
import { AppError, ErrorCodes } from "../../utils/AppError.js";
import { MAX_MESSAGE_LENGTH } from "../../config/env.js";
import type { Conversation, ConversationChannel, Message } from "../../types/domain.js";

export interface ConversationKey {
  organizationId: string;
  channel: ConversationChannel;
  /** chat_id de Telegram o teléfono E.164 de WhatsApp. */
  externalConversationId: string;
  /** 'telegram:<chat_id>' o el teléfono E.164. */
  externalIdentity: string;
  contactName?: string;
}

/**
 * La unicidad real en la base es (organization_id, channel,
 * external_conversation_id): se busca por esa misma combinación. Una
 * conversación cerrada se reabre cuando el residente vuelve a escribir;
 * una en traspaso a humano se conserva así.
 */
export async function findOrCreateConversation(key: ConversationKey): Promise<Conversation> {
  const { data: existing } = await insforgeAdmin.database
    .from("conversations")
    .select("*")
    .eq("organization_id", key.organizationId)
    .eq("channel", key.channel)
    .eq("external_conversation_id", key.externalConversationId)
    .maybeSingle();

  if (existing) {
    const conversation = existing as Conversation;
    const patch: Record<string, unknown> = {};
    if (conversation.status === "closed") patch.status = "active";
    if (key.contactName && !conversation.contact_name) patch.contact_name = key.contactName;
    if (Object.keys(patch).length === 0) return conversation;
    const { data: updated, error } = await insforgeAdmin.database
      .from("conversations")
      .update(patch)
      .eq("id", conversation.id)
      .select("*")
      .single();
    if (error || !updated) throw new AppError(ErrorCodes.INTERNAL_ERROR, "No se pudo reabrir la conversación.", 500);
    return updated as Conversation;
  }

  const { data: created, error } = await insforgeAdmin.database
    .from("conversations")
    .insert([
      {
        organization_id: key.organizationId,
        channel: key.channel,
        external_conversation_id: key.externalConversationId,
        external_identity: key.externalIdentity,
        contact_name: key.contactName ?? null
      }
    ])
    .select("*")
    .single();

  if (!error && created) return created as Conversation;

  // Dos mensajes simultáneos del mismo chat: el segundo INSERT choca con
  // el índice único; se relee la fila ganadora.
  if (error?.code === "23505") {
    const { data: winner } = await insforgeAdmin.database
      .from("conversations")
      .select("*")
      .eq("organization_id", key.organizationId)
      .eq("channel", key.channel)
      .eq("external_conversation_id", key.externalConversationId)
      .single();
    if (winner) return winner as Conversation;
  }
  throw new AppError(ErrorCodes.INTERNAL_ERROR, "No se pudo crear la conversación.", 500);
}

export async function persistInboundMessage(
  conversation: Conversation,
  input: { content: string; messageType?: Message["message_type"]; externalMessageId?: string; metadata?: Record<string, unknown> }
): Promise<void> {
  const { error } = await insforgeAdmin.database.from("messages").insert([
    {
      organization_id: conversation.organization_id,
      conversation_id: conversation.id,
      role: "user",
      content: input.content.slice(0, MAX_MESSAGE_LENGTH),
      message_type: input.messageType ?? "text",
      external_message_id: input.externalMessageId ?? null,
      metadata: input.metadata ?? {}
    }
  ]);
  if (error) throw new AppError(ErrorCodes.INTERNAL_ERROR, "No se pudo guardar el mensaje.", 500);
}

export async function persistAssistantMessage(conversation: Conversation, content: string, metadata?: Record<string, unknown>) {
  await insforgeAdmin.database.from("messages").insert([
    {
      organization_id: conversation.organization_id,
      conversation_id: conversation.id,
      role: "assistant",
      content: content.slice(0, MAX_MESSAGE_LENGTH),
      metadata: metadata ?? {}
    }
  ]);
}

export async function updateConversation(conversationId: string, patch: Record<string, unknown>): Promise<void> {
  await insforgeAdmin.database.from("conversations").update(patch).eq("id", conversationId);
}
