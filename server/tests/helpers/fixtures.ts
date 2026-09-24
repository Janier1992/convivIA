import type { ToolContext } from "../../src/services/agent/toolTypes.js";
import type { AgentConfig, CommonAreaSummary, ResidentIdentity } from "../../src/types/domain.js";

export const AGENT: AgentConfig = {
  id: "agent-1",
  organization_id: "org-1",
  name: "Clara",
  enabled: true,
  tone: "friendly",
  system_instructions: null,
  finance_enabled: true,
  payment_reports_enabled: true,
  pqrs_enabled: true,
  reservations_enabled: true,
  documents_enabled: true,
  handoff_enabled: true
};

export const RESIDENT: ResidentIdentity = {
  personId: "person-1",
  fullName: "Ana María Pérez",
  units: [
    { unit_id: "unit-1", code: "T1-502", tower: "Torre 1", relations: ["owner"], finance_access: true },
    { unit_id: "unit-2", code: "P-12", tower: null, relations: ["resident"], finance_access: false }
  ]
};

export const SALON: CommonAreaSummary = {
  id: "area-1",
  name: "Salón social",
  description: null,
  rules: null,
  booking_mode: "exclusive",
  capacity: null,
  max_guests: 60,
  requires_approval: false,
  fee_amount: 80000,
  deposit_amount: 0,
  slot_minutes: 60,
  min_duration_minutes: 60,
  max_duration_minutes: 360,
  advance_min_hours: 24,
  advance_max_days: 60
};

export function toolContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    organizationId: "org-1",
    conversationId: "conv-1",
    channel: "telegram",
    timezone: "America/Bogota",
    isPreview: false,
    identityStatus: "verified",
    identity: RESIDENT,
    propertyName: "Conjunto Los Almendros",
    agent: AGENT,
    areas: [SALON],
    now: new Date("2026-10-05T15:00:00Z"),
    channelActions: new Set(),
    ...overrides
  };
}
