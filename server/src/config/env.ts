import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3011),

  INSFORGE_URL: z.string().url(),
  INSFORGE_API_KEY: z.string().min(1),

  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL: z.string().min(1).default("gpt-4o-mini"),
  OPENAI_BASE_URL: z.string().optional().default(""),

  TWILIO_VALIDATE_SIGNATURE: z
    .string()
    .optional()
    .default("true")
    .transform((v) => v !== "false"),

  VAPID_PUBLIC_KEY: z.string().optional().default(""),
  VAPID_PRIVATE_KEY: z.string().optional().default(""),
  VAPID_SUBJECT: z.string().optional().default("mailto:soporte@convivia.app"),

  APP_URL: z.string().url().default("http://localhost:5173"),
  DEFAULT_TIMEZONE: z.string().default("America/Bogota"),

  // Permite apagar los workers en procesos auxiliares (p. ej. un segundo
  // réplica solo para webhooks). Por defecto todo corre en un proceso.
  WORKERS_ENABLED: z
    .string()
    .optional()
    .default("true")
    .transform((v) => v !== "false")
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  throw new Error("Invalid environment configuration. Check your .env file against .env.example.");
}

export const env = parsed.data;

export const MAX_MESSAGE_LENGTH = 4000;
export const MAX_CONVERSATION_HISTORY_MESSAGES = 24;
export const AGENT_TIMEOUT_MS = 25_000;
export const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;
