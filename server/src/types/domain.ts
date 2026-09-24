// Tipos del dominio de ConvivIA tal como vienen de la base de datos
// (snake_case, igual que las columnas). Ver migrations/.

export type ConversationChannel = "telegram" | "whatsapp" | "web";
export type IdentityStatus = "unverified" | "verified" | "not_registered";
export type ConversationStatus = "active" | "handoff" | "closed";
export type MessageRole = "user" | "assistant" | "system" | "tool" | "staff";
export type UnitRelation = "owner" | "tenant" | "resident" | "authorized";

export interface Organization {
  id: string;
  name: string;
  property_type: string;
  status: "active" | "suspended" | "cancelled";
  timezone: string;
}

export interface PropertyProfile {
  organization_id: string;
  display_name: string;
  legal_name: string | null;
  nit: string | null;
  address: string | null;
  city: string | null;
  department: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  administrator_name: string | null;
  office_hours: string | null;
  privacy_policy_url: string | null;
  payment_instructions: string | null;
  currency: string;
  due_day: number;
}

export interface AgentConfig {
  id: string;
  organization_id: string;
  name: string;
  enabled: boolean;
  tone: "friendly" | "formal";
  system_instructions: string | null;
  finance_enabled: boolean;
  payment_reports_enabled: boolean;
  pqrs_enabled: boolean;
  reservations_enabled: boolean;
  documents_enabled: boolean;
  handoff_enabled: boolean;
  visitors_enabled: boolean;
}

export interface AgentRule {
  id: string;
  organization_id: string;
  name: string;
  instruction: string;
  priority: number;
  enabled: boolean;
}

export interface Conversation {
  id: string;
  organization_id: string;
  channel: ConversationChannel;
  external_conversation_id: string;
  external_identity: string | null;
  contact_name: string | null;
  person_id: string | null;
  identity_status: IdentityStatus;
  verified_at: string | null;
  verified_via: string | null;
  status: ConversationStatus;
  notifications_opt_out: boolean;
  is_preview: boolean;
  privacy_notice_sent_at: string | null;
  contact_requested_at: string | null;
  last_inbound_at: string | null;
  last_message_at: string | null;
}

export interface Message {
  id: string;
  organization_id: string;
  conversation_id: string;
  role: MessageRole;
  content: string;
  message_type: "text" | "image" | "contact" | "document";
  external_message_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface IdentityUnit {
  unit_id: string;
  code: string;
  tower: string | null;
  relations: UnitRelation[];
  finance_access: boolean;
}

export interface ResidentIdentity {
  personId: string;
  fullName: string;
  units: IdentityUnit[];
}

export interface CommonAreaSummary {
  id: string;
  name: string;
  description: string | null;
  rules: string | null;
  booking_mode: "exclusive" | "shared";
  capacity: number | null;
  max_guests: number | null;
  requires_approval: boolean;
  fee_amount: number;
  deposit_amount: number;
  slot_minutes: number;
  min_duration_minutes: number;
  max_duration_minutes: number;
  advance_min_hours: number;
  advance_max_days: number;
}

export interface Integration {
  id: string;
  organization_id: string;
  provider: "telegram" | "twilio";
  status: "disconnected" | "connected" | "error";
  credentials: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

export type OutboundKind = "staff_reply" | "announcement" | "payment_reminder" | "pqrs_update" | "reservation_update" | "system";
export type WhatsAppTemplateKey = "announcement" | "payment_reminder" | "pqrs_update" | "reservation_update";

export interface OutboundMessage {
  id: string;
  organization_id: string;
  channel: "telegram" | "whatsapp";
  conversation_id: string | null;
  person_id: string | null;
  destination: string;
  kind: OutboundKind;
  body: string;
  template_key: WhatsAppTemplateKey | null;
  template_vars: Record<string, string>;
  status: "queued" | "sending" | "sent" | "failed" | "cancelled";
  attempts: number;
}

export interface BackgroundJob {
  id: string;
  organization_id: string;
  job_type: "agent_turn" | "document_ingest";
  payload: Record<string, unknown>;
  attempts: number;
}

export interface DocumentRow {
  id: string;
  organization_id: string;
  title: string;
  storage_key: string | null;
  mime_type: string | null;
  file_name: string | null;
  source_text: string | null;
}
