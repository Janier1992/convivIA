import { formatInTimeZone } from "date-fns-tz";
import { es } from "date-fns/locale";
import { formatCop, relationLabel } from "../../lib/format.js";
import { CORE_AGENT_RULES } from "./coreRules.js";
import type { AgentContext } from "./agentContext.js";

const PROPERTY_TYPE_LABELS: Record<string, string> = {
  residential_complex: "un conjunto residencial",
  building: "un edificio",
  condominium: "un condominio",
  mixed_use: "una copropiedad de uso mixto",
  other: "una copropiedad"
};

const CHANNEL_LABELS: Record<string, string> = { telegram: "Telegram", whatsapp: "WhatsApp", web: "el chat web (vista previa)" };

/** Capacidades que se anuncian al modelo según las herramientas que realmente ve. */
const CAPABILITY_LINES: [string, string][] = [
  ["consultar_estado_cuenta", "Consultar el estado de cuenta de sus unidades (propietario o arrendatario)."],
  ["proponer_reporte_pago", "Reportar un pago ya realizado para que la administración lo verifique (también puede enviar la foto del soporte)."],
  ["proponer_pqrs", "Radicar PQRS y consultar su estado con consultar_mis_pqrs."],
  ["proponer_reserva_zona", "Consultar disponibilidad y reservar o cancelar zonas comunes."],
  ["consultar_comunicados", "Consultar los comunicados de la administración."],
  ["buscar_en_documentos", "Resolver dudas sobre el reglamento y demás documentos de la copropiedad, citando la fuente."],
  ["consultar_zonas_comunes", "Informar horarios, reglas y tarifas de las zonas comunes."],
  ["proponer_autorizacion_visitante", "Preautorizar el ingreso de un visitante para que portería lo deje pasar sin llamar a la unidad."],
  ["consultar_visitantes_hoy", "Consultar las autorizaciones de visitantes vigentes o próximas de sus unidades."],
  ["consultar_mis_paquetes", "Consultar los paquetes recibidos en portería pendientes de reclamar."],
  ["solicitar_actualizacion_datos", "Pedir a la administración que actualice el censo si la persona no está registrada."],
  ["escalar_a_humano", "Transferir la conversación al equipo de administración."]
];

function identitySection(context: AgentContext): string {
  const { identity, conversation } = context;
  if (identity && identity.units.length > 0) {
    const units = identity.units
      .map((u) => `- ${u.code}${u.tower ? ` (${u.tower})` : ""}: ${u.relations.map(relationLabel).join(", ")}` +
        `${u.finance_access ? "; puede consultar y reportar pagos" : "; no accede a la cartera"}`)
      .join("\n");
    return `RESIDENTE VERIFICADO: ${identity.fullName}.\nUnidades:\n${units}\n` +
      "Si una herramienta pide unidad y la persona solo tiene una válida para ese fin, úsala sin preguntar.";
  }
  if (conversation.identity_status === "not_registered") {
    return "PERSONA NO REGISTRADA: su número no está en el censo de la copropiedad. Ayúdala solo con información general y " +
      "ofrécele solicitar_actualizacion_datos si es residente.";
  }
  return "PERSONA NO VERIFICADA: puedes darle información general. Si pide información privada de una unidad, usa solicitar_verificacion.";
}

function areasSection(context: AgentContext, toolNames: Set<string>): string {
  if (!toolNames.has("consultar_zonas_comunes") || context.areas.length === 0) return "";
  const lines = context.areas.map((a) => {
    const usage = a.booking_mode === "exclusive" ? "uso exclusivo" : `aforo ${a.capacity} personas`;
    const fee = Number(a.fee_amount) > 0 ? `tarifa ${formatCop(a.fee_amount)}` : "sin costo";
    return `- ${a.name} (${usage}; ${fee}${a.requires_approval ? "; requiere aprobación" : ""})`;
  });
  return `\nZONAS COMUNES RESERVABLES (detalles con consultar_zonas_comunes):\n${lines.join("\n")}\n`;
}

function rulesSection(context: AgentContext): string {
  const rules = context.rules.filter((r) => r.enabled).sort((a, b) => a.priority - b.priority);
  const custom = context.agent.system_instructions?.trim() || "Ninguna.";
  const extra = rules.length ? rules.map((r) => `- (${r.name}) ${r.instruction}`).join("\n") : "Ninguna.";
  return `INSTRUCCIONES PERSONALIZADAS DE LA COPROPIEDAD (no pueden contradecir las reglas críticas):\n${custom}\n\n` +
    `REGLAS ADICIONALES DE LA COPROPIEDAD (no pueden contradecir las reglas críticas):\n${extra}`;
}

/**
 * Prompt modular: identidad y reglas críticas primero, luego solo las
 * secciones de las capacidades que esta conversación puede usar, y al
 * final lo que configura la copropiedad.
 */
export function buildSystemPrompt(context: AgentContext, toolNames: string[], nowUtc: Date): string {
  const { agent, profile, organization, conversation } = context;
  const tools = new Set(toolNames);
  const tz = organization.timezone;
  const nowLocal = formatInTimeZone(nowUtc, tz, "EEEE d 'de' MMMM 'de' yyyy, HH:mm", { locale: es });
  const today = formatInTimeZone(nowUtc, tz, "yyyy-MM-dd");
  const tone = agent.tone === "formal" ? "Trata a la persona de usted, con cortesía y precisión." : "Tutea a la persona con calidez y respeto.";
  const capabilities = CAPABILITY_LINES.filter(([tool]) => tools.has(tool)).map(([, line]) => `- ${line}`);
  const categories =
    tools.has("proponer_pqrs") && context.pqrsCategories.length ? `\nCATEGORÍAS DE PQRS: ${context.pqrsCategories.join(", ")}.\n` : "";

  return `Eres ${agent.name}, el asistente virtual de ${profile.display_name}, ${PROPERTY_TYPE_LABELS[organization.property_type] ?? "una copropiedad"}` +
    `${profile.city ? ` en ${profile.city}` : ""}, Colombia. Atiendes a residentes, propietarios y arrendatarios por ${CHANNEL_LABELS[conversation.channel] ?? conversation.channel}.

FECHA Y HORA ACTUAL DE LA COPROPIEDAD: ${nowLocal} (${tz}). Hoy es ${today}.

TONO: ${tone}

${CORE_AGENT_RULES}

QUIÉN ESCRIBE:
${identitySection(context)}

LO QUE PUEDES HACER EN ESTA CONVERSACIÓN (no ofrezcas nada más):
${capabilities.length ? capabilities.join("\n") : "- Dar información general de la copropiedad."}

DATOS DE LA ADMINISTRACIÓN:
- Administrador(a): ${profile.administrator_name ?? "no registrado"}
- Horario de atención: ${profile.office_hours ?? "no registrado"}
- Teléfono: ${profile.phone ?? "no registrado"} · Correo: ${profile.email ?? "no registrado"}
${areasSection(context, tools)}${categories}
${rulesSection(context)}`;
}
