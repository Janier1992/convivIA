import { insforgeAdmin } from "../../lib/insforge.js";
import { AppError, ErrorCodes } from "../../utils/AppError.js";
import type { OutboundMessage } from "../../types/domain.js";
import { loadTelegramBotToken, sendTelegramMessage } from "../telegram/telegramService.js";
import { sendWhatsAppMessage, sendWhatsAppTemplate } from "../twilio/twilioService.js";

// Margen de seguridad frente a la ventana de 24 h de WhatsApp.
const WHATSAPP_WINDOW_MS = 23.5 * 60 * 60 * 1000;

export type DeliveryMode = "free_text" | "template";

/** Errores que reintentar no arregla (configuración o reglas del canal). */
export class PermanentDeliveryError extends AppError {}

export function isWithinWhatsAppWindow(lastInboundAt: string | null, now = new Date()): boolean {
  if (!lastInboundAt) return false;
  return now.getTime() - new Date(lastInboundAt).getTime() < WHATSAPP_WINDOW_MS;
}

async function lastInboundAt(message: OutboundMessage): Promise<string | null> {
  if (!message.conversation_id) return null;
  const { data } = await insforgeAdmin.database
    .from("conversations")
    .select("last_inbound_at")
    .eq("id", message.conversation_id)
    .maybeSingle();
  return (data?.last_inbound_at as string | null) ?? null;
}

async function deliverTelegram(message: OutboundMessage): Promise<DeliveryMode> {
  const botToken = await loadTelegramBotToken(message.organization_id);
  if (!botToken) throw new PermanentDeliveryError(ErrorCodes.INTEGRATION_NOT_CONNECTED, "Telegram no está conectado.", 409);
  try {
    await sendTelegramMessage(botToken, message.destination, message.body);
  } catch (err) {
    // 4xx de Telegram (bot bloqueado por el residente, chat inexistente).
    if (err instanceof AppError && err.statusCode === 400) throw new PermanentDeliveryError(err.code, err.message, 400);
    throw err;
  }
  return "free_text";
}

async function deliverWhatsApp(message: OutboundMessage): Promise<DeliveryMode> {
  if (isWithinWhatsAppWindow(await lastInboundAt(message))) {
    await sendWhatsAppMessage(message.organization_id, message.destination, message.body);
    return "free_text";
  }
  if (!message.template_key) {
    throw new PermanentDeliveryError(
      ErrorCodes.WHATSAPP_WINDOW_CLOSED,
      "Pasaron más de 24 horas desde el último mensaje del residente: WhatsApp solo permite plantillas aprobadas.",
      409
    );
  }
  const result = await sendWhatsAppTemplate(message.organization_id, message.destination, message.template_key, message.template_vars);
  if (result === "no_template_configured") {
    throw new PermanentDeliveryError(
      ErrorCodes.WHATSAPP_WINDOW_CLOSED,
      `No hay una plantilla aprobada de WhatsApp para "${message.template_key}". Reconecta WhatsApp para crearla.`,
      409
    );
  }
  return "template";
}

export async function deliverOutbound(message: OutboundMessage): Promise<DeliveryMode> {
  return message.channel === "telegram" ? deliverTelegram(message) : deliverWhatsApp(message);
}
