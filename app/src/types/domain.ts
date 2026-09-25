// Tipos del dominio de ConvivIA tal como llegan de InsForge (snake_case).

export type OrganizationRole = "owner" | "admin" | "assistant" | "accountant" | "council" | "auditor";

export type Permission =
  | "residents.read" | "residents.write" | "finance.read" | "finance.write" | "pqrs.read" | "pqrs.write"
  | "reservations.read" | "reservations.write" | "communications.read" | "communications.send" | "inbox.read"
  | "inbox.reply" | "documents.read" | "documents.write" | "agent.manage" | "integrations.manage" | "team.manage"
  | "settings.manage" | "audit.read" | "data.export" | "porteria.read" | "porteria.write"
  | "assembly.read" | "assembly.write" | "maintenance.read" | "maintenance.write" | "maintenance.approve";

export type ModuleKey =
  | "portfolio" | "inbox" | "pqrs" | "reservations" | "porteria" | "maintenance" | "communications"
  | "finance" | "units" | "residents" | "assembly" | "documents" | "agent" | "integrations" | "team"
  | "audit" | "settings";

export interface Organization {
  id: string;
  name: string;
  slug: string;
  property_type: string;
  status: "active" | "suspended" | "cancelled";
  timezone: string;
  subscription_expires_at: string | null;
  enabled_modules: ModuleKey[];
  created_at: string;
}

export interface OrganizationMembership {
  organization_id: string;
  role: OrganizationRole;
  organizations: Organization;
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
  logo_url: string | null;
  description: string | null;
  administrator_name: string | null;
  office_hours: string | null;
  privacy_policy_url: string | null;
  payment_instructions: string | null;
  currency: string;
  due_day: number;
  late_interest_monthly_rate: number;
  rounding_unit: number;
  payment_reminder_days_before: number;
  payment_reminder_days_after: number;
  max_proxies_per_attorney: number | null;
}

export interface Tower {
  id: string;
  organization_id: string;
  name: string;
  sort_order: number;
}

export type UnitType = "apartment" | "house" | "commercial" | "office" | "parking" | "storage" | "other";

export interface Unit {
  id: string;
  organization_id: string;
  tower_id: string | null;
  code: string;
  unit_type: UnitType;
  floor: string | null;
  area_m2: number | null;
  coefficient_pct: number;
  is_active: boolean;
  notes: string | null;
  towers?: { name: string } | null;
}

export type UnitRelation = "owner" | "tenant" | "resident" | "authorized";

export interface Person {
  id: string;
  organization_id: string;
  full_name: string;
  document_type: string | null;
  document_number: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  data_consent_at: string | null;
  created_at: string;
}

export interface UnitPerson {
  id: string;
  organization_id: string;
  unit_id: string;
  person_id: string;
  relation: UnitRelation;
  is_primary_contact: boolean;
  starts_on: string | null;
  ends_on: string | null;
  units?: Pick<Unit, "id" | "code"> | null;
  persons?: Pick<Person, "id" | "full_name" | "phone"> | null;
}

export interface ChargeConcept {
  id: string;
  organization_id: string;
  name: string;
  kind: "ordinary" | "extraordinary" | "fine" | "interest" | "common_area" | "opening_balance" | "other";
  calculation: "fixed" | "coefficient" | "manual";
  amount: number;
  applies_to_unit_types: UnitType[] | null;
  is_active: boolean;
  is_system: boolean;
}

export interface PortfolioRow {
  unit_id: string;
  unit_code: string;
  tower_name: string | null;
  unit_type: UnitType;
  balance: number;
  overdue_amount: number;
  not_due: number;
  d1_30: number;
  d31_60: number;
  d61_90: number;
  d90_plus: number;
  oldest_overdue_date: string | null;
  last_payment_on: string | null;
  owner_names: string | null;
}

export interface OpenItem {
  charge_id: string;
  concept: string;
  kind: string;
  description: string | null;
  period: string | null;
  due_date: string;
  amount: number;
  unpaid: number;
  days_overdue: number;
}

export interface UnitStatement {
  unit: { id: string; code: string; tower: string | null; unit_type: string };
  as_of: string;
  today: string;
  currency: string;
  total_charged: number;
  total_paid: number;
  balance: number;
  credit: number;
  overdue_amount: number;
  current_amount: number;
  oldest_overdue_due_date: string | null;
  next_due_date: string | null;
  aging: { not_due: number; d1_30: number; d31_60: number; d61_90: number; d90_plus: number };
  open_items: OpenItem[];
  recent_payments: { id: string; paid_on: string; amount: number; method: string | null; reference: string | null }[];
  pending_reports: number;
}

export interface Charge {
  id: string;
  unit_id: string;
  concept_id: string;
  period: string | null;
  description: string | null;
  amount: number;
  due_date: string;
  status: "active" | "voided";
  void_reason: string | null;
  source: string;
  created_at: string;
  charge_concepts?: { name: string } | null;
}

export type PaymentStatus = "pending_review" | "confirmed" | "rejected" | "reversed";
export type PaymentMethod = "bank_transfer" | "pse" | "cash" | "nequi" | "daviplata" | "card" | "consignment" | "other";

export interface Payment {
  id: string;
  organization_id: string;
  unit_id: string | null;
  person_id: string | null;
  amount: number | null;
  paid_on: string | null;
  method: PaymentMethod | null;
  reference: string | null;
  receipt_storage_key: string | null;
  status: PaymentStatus;
  source: "dashboard" | "agent" | "import";
  reported_note: string | null;
  review_note: string | null;
  reversal_reason: string | null;
  created_at: string;
  units?: { code: string } | null;
  persons?: { full_name: string } | null;
}

export type PqrsStatus = "received" | "classified" | "assigned" | "in_progress" | "waiting_info" | "answered" | "closed";
export type PqrsType = "peticion" | "queja" | "reclamo" | "sugerencia" | "felicitacion";
export type PqrsPriority = "low" | "normal" | "high" | "urgent";

export interface PqrsCategory {
  id: string;
  name: string;
  sla_hours: number;
  is_active: boolean;
  sort_order: number;
}

export interface PqrsTicket {
  id: string;
  organization_id: string;
  radicado: string;
  ticket_type: PqrsType;
  category_id: string | null;
  subject: string;
  description: string;
  priority: PqrsPriority;
  status: PqrsStatus;
  unit_id: string | null;
  requester_person_id: string | null;
  requester_name: string | null;
  requester_contact: string | null;
  requester_verified: boolean;
  channel: string;
  conversation_id: string | null;
  assigned_to: string | null;
  due_at: string | null;
  answered_at: string | null;
  closed_at: string | null;
  response: string | null;
  created_at: string;
  pqrs_categories?: { name: string } | null;
  units?: { code: string } | null;
}

export interface PqrsEvent {
  id: string;
  event_type: string;
  from_status: string | null;
  to_status: string | null;
  body: string | null;
  actor_kind: "staff" | "resident" | "agent" | "system";
  actor_user_id: string | null;
  created_at: string;
}

export interface CommonArea {
  id: string;
  organization_id: string;
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
  max_active_per_unit: number;
  block_if_overdue: boolean;
  is_active: boolean;
}

export interface CommonAreaHour {
  id: string;
  area_id: string;
  day_of_week: number;
  opens_at: string;
  closes_at: string;
}

export type ReservationStatus = "pending_approval" | "confirmed" | "rejected" | "cancelled" | "completed" | "no_show";

export interface AreaReservation {
  id: string;
  organization_id: string;
  area_id: string;
  unit_id: string;
  person_id: string | null;
  start_at: string;
  end_at: string;
  guests: number;
  status: ReservationStatus;
  fee_amount: number;
  deposit_amount: number;
  charge_id: string | null;
  notes: string | null;
  source: "agent" | "dashboard";
  decision_reason: string | null;
  cancel_reason: string | null;
  created_at: string;
  common_areas?: { name: string } | null;
  units?: { code: string } | null;
  persons?: { full_name: string } | null;
}

export type AudienceType = "all" | "towers" | "units" | "owners" | "residents" | "debtors";

export interface Announcement {
  id: string;
  organization_id: string;
  title: string;
  body: string;
  audience_type: AudienceType;
  audience_tower_ids: string[];
  audience_unit_ids: string[];
  status: "draft" | "sent" | "cancelled";
  recipients_count: number;
  without_channel_count: number;
  sent_at: string | null;
  created_at: string;
}

export interface Conversation {
  id: string;
  organization_id: string;
  channel: "telegram" | "whatsapp" | "web";
  external_identity: string | null;
  contact_name: string | null;
  person_id: string | null;
  identity_status: "unverified" | "verified" | "not_registered";
  status: "active" | "handoff" | "closed";
  handoff_reason: string | null;
  notifications_opt_out: boolean;
  is_preview: boolean;
  last_inbound_at: string | null;
  last_message_at: string | null;
  persons?: Pick<Person, "full_name" | "phone"> | null;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "system" | "tool" | "staff";
  content: string;
  message_type: "text" | "image" | "contact" | "document";
  metadata: Record<string, unknown> | null;
  created_at: string;
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
  assembly_enabled: boolean;
}

export interface AgentRule {
  id: string;
  organization_id: string;
  name: string;
  instruction: string;
  priority: number;
  enabled: boolean;
}

export type DocumentType =
  | "bylaws" | "coexistence_manual" | "assembly_minutes" | "council_minutes" | "contract" | "insurance_policy"
  | "circular" | "procedure" | "faq" | "report" | "other";

export interface DocumentRow {
  id: string;
  organization_id: string;
  title: string;
  doc_type: DocumentType;
  visibility: "public" | "residents" | "staff";
  version: string | null;
  effective_date: string | null;
  storage_key: string | null;
  file_name: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  sha256: string | null;
  status: "pending" | "processing" | "ready" | "failed";
  error: string | null;
  ai_enabled: boolean;
  chunk_count: number;
  created_at: string;
}

export interface AuditEvent {
  id: number;
  actor_user_id: string | null;
  actor_kind: "staff" | "agent" | "system" | "resident";
  action: "insert" | "update" | "delete";
  entity_type: string;
  entity_id: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  changed_fields: string[] | null;
  client_ip: string | null;
  created_at: string;
}

export interface TeamMember {
  member_id: string;
  user_id: string;
  role: OrganizationRole;
  email: string;
  full_name: string | null;
  created_at: string;
}

export interface AdminDashboard {
  as_of: string;
  finance: {
    collected_this_month: number;
    collected_prev_month: number;
    billed_this_month: number;
    portfolio_total: number;
    overdue_total: number;
    units_overdue: number;
    units_overdue_90: number;
    payments_pending_review: number;
  } | null;
  units_total: number;
  pqrs: { open: number; overdue: number; due_soon: number; created_7d: number };
  reservations: { today: number; pending_approval: number };
  conversations: { handoff: number; active_7d: number; verified_residents: number };
  announcements_30d: number;
}

export interface SubscriptionPayment {
  id: string;
  organization_id: string;
  submitted_by: string;
  receipt_storage_path: string;
  amount: number | null;
  note: string | null;
  status: "pending" | "confirmed" | "rejected";
  reviewed_at: string | null;
  created_at: string;
}

export type VisitorAuthStatus = "pending" | "used" | "expired" | "revoked";
export type VisitorLogKind = "visitor" | "service" | "delivery" | "other";
export type PackageStatus = "received" | "delivered" | "returned";
export type GateNoteCategory = "security" | "maintenance" | "general" | "incident";

export interface VisitorAuthorization {
  id: string;
  organization_id: string;
  unit_id: string;
  requested_by_person_id: string | null;
  visitor_name: string;
  visitor_document: string | null;
  visitor_phone: string | null;
  vehicle_plate: string | null;
  valid_from: string;
  valid_until: string;
  status: VisitorAuthStatus;
  notes: string | null;
  source: "dashboard" | "agent";
  created_at: string;
  units?: { code: string } | null;
}

export interface VisitorLog {
  id: string;
  organization_id: string;
  unit_id: string | null;
  authorization_id: string | null;
  visitor_name: string;
  visitor_document: string | null;
  visitor_phone: string | null;
  vehicle_plate: string | null;
  kind: VisitorLogKind;
  entry_at: string;
  exit_at: string | null;
  notes: string | null;
  units?: { code: string } | null;
}

export interface PackageRow {
  id: string;
  organization_id: string;
  unit_id: string;
  courier: string | null;
  description: string | null;
  status: PackageStatus;
  received_at: string;
  delivered_at: string | null;
  delivered_to_name: string | null;
  notes: string | null;
  units?: { code: string } | null;
}

export interface GateNote {
  id: string;
  organization_id: string;
  category: GateNoteCategory;
  note: string;
  shift: string | null;
  created_at: string;
}

export type AssemblyType = "ordinaria" | "extraordinaria";
export type AssemblyStatus = "draft" | "in_progress" | "closed" | "cancelled";
export type AgendaItemStatus = "pending" | "voting" | "closed";
export type ProxyStatus = "accepted" | "revoked";
export type VoteChoice = "a_favor" | "en_contra" | "abstencion";

export interface Assembly {
  id: string;
  organization_id: string;
  title: string;
  assembly_type: AssemblyType;
  status: AssemblyStatus;
  scheduled_at: string;
  location: string | null;
  first_call_quorum_pct: number;
  second_call_quorum_pct: number | null;
  agenda_notes: string | null;
  convened_at: string | null;
  closed_at: string | null;
  minutes_document_id: string | null;
  created_at: string;
}

export interface AssemblyAgendaItem {
  id: string;
  organization_id: string;
  assembly_id: string;
  position: number;
  title: string;
  description: string | null;
  requires_vote: boolean;
  status: AgendaItemStatus;
}

export interface Proxy {
  id: string;
  organization_id: string;
  assembly_id: string;
  unit_id: string;
  grantor_person_id: string;
  attorney_person_id: string;
  status: ProxyStatus;
  created_at: string;
  units?: { code: string } | null;
}

export interface AssemblyAttendee {
  id: string;
  organization_id: string;
  assembly_id: string;
  unit_id: string;
  person_id: string;
  proxy_id: string | null;
  coefficient_pct: number;
  checked_in_at: string;
  units?: { code: string } | null;
}

export interface Vote {
  id: string;
  organization_id: string;
  assembly_id: string;
  agenda_item_id: string;
  unit_id: string;
  choice: VoteChoice;
  coefficient_pct: number;
  cast_at: string;
}

export interface AssemblyQuorum {
  assembly_id: string;
  total_units: number;
  total_coefficient_pct: number;
  present_units: number;
  present_coefficient_pct: number;
  first_call_quorum_pct: number;
  second_call_quorum_pct: number | null;
  reached_first_call: boolean;
  reached_second_call: boolean;
}

export interface VoteResults {
  agenda_item_id: string;
  a_favor_pct: number;
  en_contra_pct: number;
  abstencion_pct: number;
  a_favor_count: number;
  en_contra_count: number;
  abstencion_count: number;
  total_coefficient_voted_pct: number;
}

export interface UnitPersonOption {
  person_id: string;
  full_name: string;
  relation: UnitRelation;
}

export type AssetCategory =
  | "elevator" | "water_pump" | "generator" | "gate" | "pool_equipment" | "fire_safety" | "electrical" | "other";
export type AssetStatus = "active" | "retired";
export type WorkOrderPriority = "low" | "normal" | "high" | "urgent";
export type WorkOrderStatus =
  | "reported" | "diagnosed" | "approved" | "assigned" | "in_progress" | "pending_validation" | "closed" | "cancelled";
export type WorkOrderEventType =
  | "created" | "diagnosed" | "approved" | "rejected" | "assigned" | "started" | "evidence_added" | "validated"
  | "validation_rejected" | "closed" | "cancelled";

export interface Vendor {
  id: string;
  organization_id: string;
  name: string;
  specialty: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
}

export interface Asset {
  id: string;
  organization_id: string;
  name: string;
  category: AssetCategory;
  location: string | null;
  installed_on: string | null;
  warranty_expires_on: string | null;
  status: AssetStatus;
  notes: string | null;
  created_at: string;
}

export interface MaintenanceSchedule {
  id: string;
  organization_id: string;
  asset_id: string | null;
  title: string;
  frequency_months: number;
  next_due_on: string;
  last_done_on: string | null;
  is_active: boolean;
  notes: string | null;
  assets?: { name: string } | null;
}

export interface WorkOrder {
  id: string;
  organization_id: string;
  code: string;
  asset_id: string | null;
  pqrs_ticket_id: string | null;
  title: string;
  description: string;
  priority: WorkOrderPriority;
  status: WorkOrderStatus;
  vendor_id: string | null;
  assigned_to: string | null;
  cost_estimate: number | null;
  cost_final: number | null;
  scheduled_at: string | null;
  started_at: string | null;
  closed_at: string | null;
  created_at: string;
  assets?: { name: string } | null;
  vendors?: { name: string } | null;
  pqrs_tickets?: { radicado: string } | null;
}

export interface PortfolioOrgSummary {
  organization_id: string;
  organization_name: string;
  role: OrganizationRole;
  units_total: number;
  overdue_total: number | null;
  units_overdue: number | null;
  pqrs_open: number | null;
  pqrs_overdue: number | null;
  work_orders_open: number | null;
  work_orders_pending_approval: number | null;
}

export interface WorkOrderEvent {
  id: string;
  event_type: WorkOrderEventType;
  from_status: string | null;
  to_status: string | null;
  body: string | null;
  cost: number | null;
  actor_kind: "staff" | "system";
  created_at: string;
}
