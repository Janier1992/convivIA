import rateLimit from "express-rate-limit";
import { ErrorCodes } from "../utils/AppError.js";

function jsonRateLimitHandler(_req: unknown, res: import("express").Response) {
  res.status(429).json({
    error: { code: ErrorCodes.RATE_LIMITED, message: "Demasiadas solicitudes. Intentá de nuevo en unos minutos." }
  });
}

/** Webhooks entrantes (Twilio). Un cliente/número no debería enviar cientos de mensajes por minuto. */
export const webhookRateLimiter = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonRateLimitHandler
});

/** Endpoints sensibles de autenticación/integraciones. */
export const authSensitiveRateLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonRateLimitHandler
});

/** Endpoints que disparan llamadas a OpenAI: protección de costos (punto 47). */
export const aiRateLimiter = rateLimit({
  windowMs: 60_000,
  limit: 15,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonRateLimitHandler
});

/** API pública general del dashboard. */
export const publicApiRateLimiter = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonRateLimitHandler
});
