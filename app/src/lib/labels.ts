import type {
  AudienceType,
  DocumentType,
  OrganizationRole,
  PaymentMethod,
  PaymentStatus,
  PqrsPriority,
  PqrsStatus,
  PqrsType,
  ReservationStatus,
  UnitRelation,
  UnitType
} from "@/types/domain";

export type BadgeVariant = "default" | "accent" | "success" | "warning" | "destructive" | "muted";

export const ROLE_LABELS: Record<OrganizationRole, string> = {
  owner: "Titular de la cuenta",
  admin: "Administrador(a)",
  assistant: "Auxiliar administrativo",
  accountant: "Contador(a) / tesorería",
  council: "Consejo de administración",
  auditor: "Revisor(a) fiscal"
};

export const ROLE_DESCRIPTIONS: Record<OrganizationRole, string> = {
  owner: "Acceso total, incluida la eliminación de la copropiedad.",
  admin: "Gestiona toda la operación, el equipo y la configuración.",
  assistant: "Censo, PQRS, reservas, comunicados y conversaciones. Ve la cartera sin modificarla.",
  accountant: "Cartera, pagos y exportaciones. Consulta el censo.",
  council: "Supervisa cartera, PQRS y reservas sin acceder a datos personales del censo.",
  auditor: "Lectura amplia y acceso a la auditoría."
};

export const INVITABLE_ROLES: OrganizationRole[] = ["admin", "assistant", "accountant", "council", "auditor"];

export const PROPERTY_TYPE_LABELS: Record<string, string> = {
  residential_complex: "Conjunto residencial",
  building: "Edificio",
  condominium: "Condominio",
  mixed_use: "Uso mixto",
  other: "Otro"
};

export const UNIT_TYPE_LABELS: Record<UnitType, string> = {
  apartment: "Apartamento",
  house: "Casa",
  commercial: "Local comercial",
  office: "Oficina",
  parking: "Parqueadero",
  storage: "Depósito",
  other: "Otro"
};

export const RELATION_LABELS: Record<UnitRelation, string> = {
  owner: "Propietario(a)",
  tenant: "Arrendatario(a)",
  resident: "Residente",
  authorized: "Autorizado(a)"
};

export const DOCUMENT_TYPE_OPTIONS = ["CC", "CE", "NIT", "PAS", "TI", "PPT", "OTRO"] as const;

export const PAYMENT_STATUS: Record<PaymentStatus, { label: string; variant: BadgeVariant }> = {
  pending_review: { label: "Por revisar", variant: "warning" },
  confirmed: { label: "Confirmado", variant: "success" },
  rejected: { label: "Rechazado", variant: "destructive" },
  reversed: { label: "Reversado", variant: "muted" }
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  bank_transfer: "Transferencia",
  pse: "PSE",
  cash: "Efectivo",
  nequi: "Nequi",
  daviplata: "Daviplata",
  card: "Tarjeta",
  consignment: "Consignación",
  other: "Otro"
};

export const PQRS_STATUS: Record<PqrsStatus, { label: string; variant: BadgeVariant }> = {
  received: { label: "Recibida", variant: "default" },
  classified: { label: "Clasificada", variant: "default" },
  assigned: { label: "Asignada", variant: "accent" },
  in_progress: { label: "En gestión", variant: "accent" },
  waiting_info: { label: "Esperando información", variant: "warning" },
  answered: { label: "Respondida", variant: "success" },
  closed: { label: "Cerrada", variant: "muted" }
};

export const PQRS_TYPE_LABELS: Record<PqrsType, string> = {
  peticion: "Petición",
  queja: "Queja",
  reclamo: "Reclamo",
  sugerencia: "Sugerencia",
  felicitacion: "Felicitación"
};

export const PQRS_PRIORITY: Record<PqrsPriority, { label: string; variant: BadgeVariant }> = {
  low: { label: "Baja", variant: "muted" },
  normal: { label: "Normal", variant: "default" },
  high: { label: "Alta", variant: "warning" },
  urgent: { label: "Urgente", variant: "destructive" }
};

export const RESERVATION_STATUS: Record<ReservationStatus, { label: string; variant: BadgeVariant }> = {
  pending_approval: { label: "Por aprobar", variant: "warning" },
  confirmed: { label: "Confirmada", variant: "success" },
  rejected: { label: "Rechazada", variant: "destructive" },
  cancelled: { label: "Cancelada", variant: "muted" },
  completed: { label: "Cumplida", variant: "default" },
  no_show: { label: "No asistió", variant: "destructive" }
};

export const AUDIENCE_LABELS: Record<AudienceType, string> = {
  all: "Toda la copropiedad",
  towers: "Torres específicas",
  units: "Unidades específicas",
  owners: "Solo propietarios",
  residents: "Solo ocupantes (arrendatarios y residentes)",
  debtors: "Unidades en mora (mensaje privado a cada una)"
};

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  bylaws: "Reglamento de propiedad horizontal",
  coexistence_manual: "Manual de convivencia",
  assembly_minutes: "Acta de asamblea",
  council_minutes: "Acta de consejo",
  contract: "Contrato",
  insurance_policy: "Póliza",
  circular: "Circular",
  procedure: "Procedimiento",
  faq: "Preguntas frecuentes",
  report: "Informe",
  other: "Otro"
};

export const VISIBILITY_LABELS: Record<"public" | "residents" | "staff", string> = {
  public: "Pública (cualquiera que escriba al asistente)",
  residents: "Residentes verificados",
  staff: "Solo el equipo (el asistente no la usa)"
};

export const CHANNEL_LABELS: Record<string, string> = {
  telegram: "Telegram",
  whatsapp: "WhatsApp",
  web: "Vista previa",
  dashboard: "Panel",
  email: "Correo",
  in_person: "Presencial",
  phone: "Teléfono"
};

export function labelOf<T extends string>(map: Record<T, string>, value: T | null | undefined): string {
  return value ? map[value] ?? value : "—";
}
