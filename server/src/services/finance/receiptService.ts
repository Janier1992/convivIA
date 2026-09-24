import { insforgeAdmin } from "../../lib/insforge.js";
import { logger } from "../../lib/logger.js";
import { MAX_RECEIPT_BYTES } from "../../config/env.js";
import { AppError, ErrorCodes, toAppError } from "../../utils/AppError.js";
import type { Conversation } from "../../types/domain.js";
import { notifyOrganization } from "../notifications/pushService.js";
import { persistInboundMessage } from "../conversations/inboundMessageHandler.js";

export const RECEIPTS_BUCKET = "payment-receipts";

const ALLOWED_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf"
};

export interface ReceiptMedia {
  bytes: Uint8Array;
  mimeType: string;
  externalMessageId?: string;
}

export type ReceiptOutcome =
  | { kind: "needs_verification" }
  | { kind: "disabled" }
  | { kind: "unsupported" }
  | { kind: "stored"; hasDetails: boolean };

async function paymentReportsEnabled(organizationId: string): Promise<boolean> {
  const { data } = await insforgeAdmin.database
    .from("agents")
    .select("payment_reports_enabled")
    .eq("organization_id", organizationId)
    .maybeSingle();
  return Boolean(data?.payment_reports_enabled);
}

/**
 * Soporte de pago recibido por el chat. La ingesta es determinista: se
 * guarda en un bucket privado y se adjunta al reporte pendiente del
 * residente (o se crea uno). Solo una persona de la administración
 * confirma el pago después de revisarlo.
 */
export async function handleReceiptMedia(conversation: Conversation, media: ReceiptMedia): Promise<ReceiptOutcome> {
  if (conversation.identity_status !== "verified" || !conversation.person_id) {
    await persistInboundMessage(conversation, { content: "[Archivo recibido sin verificar identidad]", messageType: "image" });
    return { kind: "needs_verification" };
  }
  if (!(await paymentReportsEnabled(conversation.organization_id))) return { kind: "disabled" };
  const extension = ALLOWED_TYPES[media.mimeType];
  if (!extension || media.bytes.byteLength > MAX_RECEIPT_BYTES) return { kind: "unsupported" };

  const key = `${conversation.organization_id}/${conversation.id}/${Date.now()}.${extension}`;
  const { error: uploadError } = await insforgeAdmin.storage
    .from(RECEIPTS_BUCKET)
    .upload(key, new Blob([media.bytes], { type: media.mimeType }));
  if (uploadError) {
    logger.error({ conversationId: conversation.id, err: uploadError }, "receipt_upload_failed");
    throw new AppError(ErrorCodes.INTERNAL_ERROR, "No se pudo guardar el soporte.", 500);
  }

  const { data, error } = await insforgeAdmin.database.rpc("attach_payment_receipt", {
    p_organization_id: conversation.organization_id,
    p_person_id: conversation.person_id,
    p_conversation_id: conversation.id,
    p_storage_key: key
  });
  if (error || !data) throw toAppError(error, "No se pudo registrar el soporte.");
  const result = data as { payment_id: string; has_details: boolean };

  await persistInboundMessage(conversation, {
    content: "[Soporte de pago enviado]",
    messageType: media.mimeType === "application/pdf" ? "document" : "image",
    externalMessageId: media.externalMessageId,
    metadata: { storage_key: key, mime_type: media.mimeType, payment_id: result.payment_id }
  });

  notifyOrganization(conversation.organization_id, {
    title: "Soporte de pago recibido",
    body: "Un residente envió un soporte de pago para revisar.",
    url: "/dashboard/payments",
    tag: `receipt-${result.payment_id}`
  }).catch((err) => logger.warn({ err }, "push_notify_failed"));

  return { kind: "stored", hasDetails: result.has_details };
}

export function receiptReplyText(outcome: ReceiptOutcome, channel: Conversation["channel"]): string {
  switch (outcome.kind) {
    case "needs_verification":
      return channel === "telegram"
        ? "Para recibir soportes de pago primero necesito verificar tu identidad. Toca el botón “Compartir mi número”."
        : "Para recibir soportes de pago tu número debe estar registrado en el censo de la copropiedad. Comunícate con la administración para actualizarlo.";
    case "disabled":
      return "Por ahora no recibimos soportes de pago por este medio. Por favor envíalo directamente a la administración.";
    case "unsupported":
      return "No pude procesar ese archivo. Envía una foto (JPG o PNG) o un PDF de máximo 10 MB.";
    case "stored":
      return outcome.hasDetails
        ? "Recibí tu soporte 🧾 y lo adjunté a tu reporte de pago. La administración lo verificará y te avisaré por aquí."
        : "Recibí tu soporte de pago 🧾. Para registrarlo dime el valor, la fecha y el medio de pago (y la unidad, si tienes varias).";
  }
}
