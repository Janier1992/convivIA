import { insforgeAdmin } from "../../lib/insforge.js";
import type { Conversation } from "../../types/domain.js";
import { updateConversation } from "./inboundMessageHandler.js";

export interface PropertyBranding {
  name: string;
  agentName: string;
  privacyPolicyUrl: string | null;
}

export async function loadPropertyBranding(organizationId: string): Promise<PropertyBranding> {
  const [{ data: profile }, { data: agent }] = await Promise.all([
    insforgeAdmin.database
      .from("property_profiles")
      .select("display_name, privacy_policy_url")
      .eq("organization_id", organizationId)
      .maybeSingle(),
    insforgeAdmin.database.from("agents").select("name").eq("organization_id", organizationId).maybeSingle()
  ]);
  return {
    name: profile?.display_name ?? "tu copropiedad",
    agentName: agent?.name ?? "el asistente",
    privacyPolicyUrl: profile?.privacy_policy_url ?? null
  };
}

export function privacyNotice(branding: PropertyBranding): string {
  return (
    `ℹ️ ${branding.name} trata tus datos personales para atender tus solicitudes como residente` +
    (branding.privacyPolicyUrl ? `, según su política de tratamiento de datos: ${branding.privacyPolicyUrl}.` : ".") +
    " Escribe BAJA si no quieres recibir comunicados por este medio."
  );
}

/**
 * El primer mensaje que la plataforma envía en una conversación lleva el
 * aviso de privacidad (Ley 1581). Se marca en la conversación para no
 * repetirlo.
 */
export async function withPrivacyNotice(conversation: Conversation, reply: string): Promise<string> {
  if (conversation.privacy_notice_sent_at || conversation.is_preview) return reply;
  const branding = await loadPropertyBranding(conversation.organization_id);
  await updateConversation(conversation.id, { privacy_notice_sent_at: new Date().toISOString() });
  conversation.privacy_notice_sent_at = new Date().toISOString();
  return `${reply}\n\n${privacyNotice(branding)}`;
}

const OPT_OUT = new Set(["baja", "stop", "/stop", "cancelar suscripcion", "no mas mensajes"]);
const OPT_IN = new Set(["alta", "/alta", "start comunicados"]);

function normalizeCommand(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[.!¡¿?]/g, "")
    .trim();
}

export type ChannelCommand = "opt_out" | "opt_in" | null;

export function detectChannelCommand(text: string): ChannelCommand {
  const normalized = normalizeCommand(text);
  if (OPT_OUT.has(normalized)) return "opt_out";
  if (OPT_IN.has(normalized)) return "opt_in";
  return null;
}

/** Baja/alta de comunicados: determinista, sin pasar por el asistente. */
export async function applyChannelCommand(conversation: Conversation, command: Exclude<ChannelCommand, null>): Promise<string> {
  const optOut = command === "opt_out";
  await updateConversation(conversation.id, { notifications_opt_out: optOut });
  return optOut
    ? "Listo, no te enviaremos más comunicados ni recordatorios por este medio. Puedes seguir escribiéndome cuando lo necesites. Escribe ALTA para volver a recibirlos."
    : "Listo, volverás a recibir comunicados y recordatorios por este medio.";
}
