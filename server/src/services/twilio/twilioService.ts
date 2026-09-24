import twilio from "twilio";
import { env } from "../../config/env.js";
import { insforgeAdmin } from "../../lib/insforge.js";
import { AppError, ErrorCodes } from "../../utils/AppError.js";
import type { WhatsAppTemplateKey } from "../../types/domain.js";

export interface TwilioCredentials {
  account_sid: string;
  auth_token: string;
}

interface TwilioIntegration {
  credentials: TwilioCredentials;
  whatsappNumber: string;
  templates: Partial<Record<WhatsAppTemplateKey, string>>;
}

const MEDIA_TIMEOUT_MS = 20_000;

export function normalizeWhatsAppAddress(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith("whatsapp:") ? trimmed : `whatsapp:${trimmed}`;
}

export function stripWhatsAppPrefix(value: string): string {
  return value.replace(/^whatsapp:/, "");
}

/**
 * Un único webhook recibe mensajes de muchos números: el enrutamiento se
 * hace por el número "To" (el WhatsApp de la copropiedad), nunca asumiendo
 * un tenant fijo.
 */
export async function resolveOrganizationForIncomingNumber(
  toAddress: string
): Promise<{ organizationId: string; credentials: TwilioCredentials } | null> {
  const { data, error } = await insforgeAdmin.database
    .from("integrations")
    .select("organization_id, credentials")
    .eq("provider", "twilio")
    .eq("status", "connected")
    .eq("metadata->>whatsapp_number", normalizeWhatsAppAddress(toAddress));
  if (error) throw new AppError(ErrorCodes.INTERNAL_ERROR, "No se pudo resolver la copropiedad destino.", 500);
  if (!data || data.length === 0) return null;
  const row = data[0] as { organization_id: string; credentials: TwilioCredentials };
  return { organizationId: row.organization_id, credentials: row.credentials };
}

export function validateTwilioSignature(authToken: string, signature: string | undefined, fullUrl: string, params: Record<string, unknown>): boolean {
  if (!env.TWILIO_VALIDATE_SIGNATURE) return true;
  if (!signature) return false;
  return twilio.validateRequest(authToken, signature, fullUrl, params as Record<string, string>);
}

async function loadTwilioIntegration(organizationId: string): Promise<TwilioIntegration> {
  const { data, error } = await insforgeAdmin.database
    .from("integrations")
    .select("credentials, metadata, status")
    .eq("organization_id", organizationId)
    .eq("provider", "twilio")
    .maybeSingle();
  if (error || !data || data.status !== "connected") {
    throw new AppError(ErrorCodes.INTEGRATION_NOT_CONNECTED, "WhatsApp no está conectado para esta copropiedad.", 409);
  }
  const metadata = (data.metadata ?? {}) as { whatsapp_number?: string; templates?: Partial<Record<WhatsAppTemplateKey, string>> };
  return {
    credentials: data.credentials as TwilioCredentials,
    whatsappNumber: metadata.whatsapp_number ?? "",
    templates: metadata.templates ?? {}
  };
}

/** Texto libre: solo válido dentro de las 24 h posteriores al último mensaje del residente. */
export async function sendWhatsAppMessage(organizationId: string, toPhone: string, body: string): Promise<void> {
  const integration = await loadTwilioIntegration(organizationId);
  const client = twilio(integration.credentials.account_sid, integration.credentials.auth_token);
  await client.messages.create({ from: integration.whatsappNumber, to: normalizeWhatsAppAddress(toPhone), body });
}

/**
 * Fuera de la ventana de 24 h Meta exige una plantilla aprobada. Las
 * plantillas se crean al conectar WhatsApp (functions/twilio-connect.ts).
 * Si la del tipo pedido no existe, el llamador NO debe caer a texto libre.
 */
export async function sendWhatsAppTemplate(
  organizationId: string,
  toPhone: string,
  templateKey: WhatsAppTemplateKey,
  variables: Record<string, string>
): Promise<"sent" | "no_template_configured"> {
  const integration = await loadTwilioIntegration(organizationId);
  const contentSid = integration.templates[templateKey];
  if (!contentSid) return "no_template_configured";
  const client = twilio(integration.credentials.account_sid, integration.credentials.auth_token);
  await client.messages.create({
    from: integration.whatsappNumber,
    to: normalizeWhatsAppAddress(toPhone),
    contentSid,
    contentVariables: JSON.stringify(variables)
  });
  return "sent";
}

/** Los adjuntos de Twilio requieren autenticación básica con la cuenta de la copropiedad. */
export async function downloadTwilioMedia(credentials: TwilioCredentials, mediaUrl: string): Promise<Uint8Array> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MEDIA_TIMEOUT_MS);
  try {
    const auth = Buffer.from(`${credentials.account_sid}:${credentials.auth_token}`).toString("base64");
    const res = await fetch(mediaUrl, { headers: { Authorization: `Basic ${auth}` }, signal: controller.signal, redirect: "follow" });
    if (!res.ok) throw new AppError(ErrorCodes.INTERNAL_ERROR, `Descarga de adjunto de Twilio falló (${res.status})`, 502);
    return new Uint8Array(await res.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}
