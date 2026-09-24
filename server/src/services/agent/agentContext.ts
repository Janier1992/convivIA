import { insforgeAdmin } from "../../lib/insforge.js";
import { AppError, ErrorCodes } from "../../utils/AppError.js";
import type {
  AgentConfig,
  AgentRule,
  CommonAreaSummary,
  Conversation,
  IdentityUnit,
  Organization,
  PropertyProfile,
  ResidentIdentity
} from "../../types/domain.js";

export interface AgentContext {
  organization: Organization;
  profile: PropertyProfile;
  agent: AgentConfig;
  rules: AgentRule[];
  areas: CommonAreaSummary[];
  pqrsCategories: string[];
  conversation: Conversation;
  identity: ResidentIdentity | null;
}

const AREA_COLUMNS =
  "id, name, description, rules, booking_mode, capacity, max_guests, requires_approval, fee_amount, deposit_amount, " +
  "slot_minutes, min_duration_minutes, max_duration_minutes, advance_min_hours, advance_max_days";

export async function loadResidentIdentity(organizationId: string, personId: string): Promise<ResidentIdentity | null> {
  const { data, error } = await insforgeAdmin.database.rpc("get_person_identity", {
    p_organization_id: organizationId,
    p_person_id: personId
  });
  if (error || !data) return null;
  const raw = data as { person_id: string; full_name: string; units: IdentityUnit[] };
  return { personId: raw.person_id, fullName: raw.full_name, units: raw.units ?? [] };
}

/**
 * Carga en paralelo todo lo que el asistente necesita para un turno. La
 * identidad se toma de la conversación (verificada por el canal), nunca
 * de lo que diga la persona en el chat.
 */
export async function loadAgentContext(organizationId: string, conversationId: string): Promise<AgentContext> {
  const [org, profile, agent, rules, areas, categories, conversation] = await Promise.all([
    insforgeAdmin.database.from("organizations").select("id, name, property_type, status, timezone").eq("id", organizationId).maybeSingle(),
    insforgeAdmin.database.from("property_profiles").select("*").eq("organization_id", organizationId).maybeSingle(),
    insforgeAdmin.database.from("agents").select("*").eq("organization_id", organizationId).maybeSingle(),
    insforgeAdmin.database.from("agent_rules").select("*").eq("organization_id", organizationId).eq("enabled", true)
      .order("priority", { ascending: true }),
    insforgeAdmin.database.from("common_areas").select(AREA_COLUMNS).eq("organization_id", organizationId).eq("is_active", true)
      .order("name", { ascending: true }),
    insforgeAdmin.database.from("pqrs_categories").select("name").eq("organization_id", organizationId).eq("is_active", true)
      .order("sort_order", { ascending: true }),
    insforgeAdmin.database.from("conversations").select("*").eq("id", conversationId).eq("organization_id", organizationId).maybeSingle()
  ]);

  if (!org.data || !profile.data || !agent.data) {
    throw new AppError(ErrorCodes.ORGANIZATION_NOT_FOUND, "La copropiedad no está completamente configurada.", 404);
  }
  if (!conversation.data) {
    throw new AppError(ErrorCodes.CONVERSATION_NOT_FOUND, "La conversación no existe.", 404);
  }

  const conv = conversation.data as Conversation;
  const identity =
    conv.identity_status === "verified" && conv.person_id ? await loadResidentIdentity(organizationId, conv.person_id) : null;

  return {
    organization: org.data as Organization,
    profile: profile.data as PropertyProfile,
    agent: agent.data as AgentConfig,
    rules: (rules.data ?? []) as AgentRule[],
    areas: (areas.data ?? []) as unknown as CommonAreaSummary[],
    pqrsCategories: ((categories.data ?? []) as { name: string }[]).map((c) => c.name),
    conversation: conv,
    identity
  };
}
