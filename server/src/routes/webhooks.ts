import { Router } from "express";
import express from "express";
import { z } from "zod";
import { logger } from "../lib/logger.js";
import { AppError, ErrorCodes } from "../utils/AppError.js";
import { resolveOrganizationForIncomingNumber, stripWhatsAppPrefix, validateTwilioSignature } from "../services/twilio/twilioService.js";
import { processWhatsAppInbound } from "../services/twilio/whatsappInboundProcessor.js";
import { webhookRateLimiter } from "../middleware/rateLimit.js";

export const webhooksRouter = Router();

const twilioPayloadSchema = z
  .object({
    From: z.string().min(1, "From es requerido"),
    To: z.string().min(1, "To es requerido"),
    Body: z.string().optional().default(""),
    MessageSid: z.string().optional(),
    ProfileName: z.string().optional(),
    NumMedia: z.coerce.number().int().min(0).optional().default(0),
    MediaUrl0: z.string().url().optional(),
    MediaContentType0: z.string().optional()
  })
  .refine((p) => p.Body.trim().length > 0 || (p.NumMedia > 0 && p.MediaUrl0), { message: "Mensaje vacío" });

/**
 * Webhook público de Twilio (WhatsApp). Enruta por el número "To", valida
 * la firma, responde de inmediato (<15 s) y procesa en segundo plano: el
 * turno del agente puede tomar varias rondas de herramientas.
 */
webhooksRouter.post("/twilio/whatsapp", webhookRateLimiter, express.urlencoded({ extended: false }), async (req, res, next) => {
  try {
    const parsed = twilioPayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(ErrorCodes.WEBHOOK_INVALID_PAYLOAD, "Payload de Twilio inválido o incompleto.", 400);
    }
    const payload = parsed.data;

    const routing = await resolveOrganizationForIncomingNumber(payload.To);
    if (!routing) {
      throw new AppError(ErrorCodes.ORGANIZATION_NOT_FOUND, "No hay una copropiedad con este número de WhatsApp.", 404);
    }

    const fullUrl = `${req.protocol}://${req.get("host")}${req.originalUrl}`;
    const signature = req.headers["x-twilio-signature"] as string | undefined;
    if (!validateTwilioSignature(routing.credentials.auth_token, signature, fullUrl, req.body)) {
      throw new AppError(ErrorCodes.WEBHOOK_INVALID_SIGNATURE, "Firma de Twilio inválida.", 403);
    }

    res.status(200).type("text/xml").send("<Response></Response>");

    processWhatsAppInbound({
      organizationId: routing.organizationId,
      credentials: routing.credentials,
      fromPhone: stripWhatsAppPrefix(payload.From),
      body: payload.Body,
      messageSid: payload.MessageSid,
      profileName: payload.ProfileName,
      media:
        payload.NumMedia > 0 && payload.MediaUrl0
          ? { url: payload.MediaUrl0, contentType: payload.MediaContentType0 ?? "application/octet-stream" }
          : undefined
    }).catch((err) => logger.error({ organizationId: routing.organizationId, err }, "whatsapp_inbound_failed"));
  } catch (err) {
    next(err);
  }
});
