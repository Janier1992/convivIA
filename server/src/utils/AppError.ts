export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const ErrorCodes = {
  UNAUTHENTICATED: "UNAUTHENTICATED",
  FORBIDDEN: "FORBIDDEN",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  ORGANIZATION_NOT_FOUND: "ORGANIZATION_NOT_FOUND",
  CONVERSATION_NOT_FOUND: "CONVERSATION_NOT_FOUND",
  INTEGRATION_NOT_CONNECTED: "INTEGRATION_NOT_CONNECTED",
  WEBHOOK_INVALID_SIGNATURE: "WEBHOOK_INVALID_SIGNATURE",
  WEBHOOK_INVALID_PAYLOAD: "WEBHOOK_INVALID_PAYLOAD",
  RATE_LIMITED: "RATE_LIMITED",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  // Agente
  NOT_VERIFIED: "NOT_VERIFIED",
  UNIT_NOT_FOUND: "UNIT_NOT_FOUND",
  AMBIGUOUS_UNIT: "AMBIGUOUS_UNIT",
  UNIT_ACCESS_DENIED: "UNIT_ACCESS_DENIED",
  AREA_NOT_FOUND: "AREA_NOT_FOUND",
  CATEGORY_NOT_FOUND: "CATEGORY_NOT_FOUND",
  ACTION_NOT_FOUND: "ACTION_NOT_FOUND",
  ACTION_ALREADY_RESOLVED: "ACTION_ALREADY_RESOLVED",
  ACTION_EXPIRED: "ACTION_EXPIRED",
  CONFIRMATION_REQUIRED: "CONFIRMATION_REQUIRED",
  RESERVATION_NOT_FOUND: "RESERVATION_NOT_FOUND",
  PQRS_NOT_FOUND: "PQRS_NOT_FOUND",
  // Canales
  WHATSAPP_WINDOW_CLOSED: "WHATSAPP_WINDOW_CLOSED",
  CHANNEL_SEND_FAILED: "CHANNEL_SEND_FAILED"
} as const;

/**
 * Códigos que lanzan las funciones SQL (RAISE EXCEPTION 'CODIGO...') y su
 * traducción a un mensaje claro para el residente o el equipo. El LLM
 * recibe este mensaje, nunca el error técnico de Postgres.
 */
const POSTGRES_ERRORS: Record<string, { status: number; friendly: string }> = {
  FORBIDDEN: { status: 403, friendly: "No tienes permiso para realizar esta acción." },
  TENANT_MISMATCH: { status: 422, friendly: "El dato indicado no pertenece a esta copropiedad." },
  UNIT_NOT_FOUND: { status: 404, friendly: "La unidad indicada no existe o no está activa." },
  AREA_NOT_FOUND: { status: 404, friendly: "La zona común indicada no existe o no está habilitada." },
  AREA_NOT_AVAILABLE: { status: 409, friendly: "Ese horario ya no está disponible para la zona común." },
  AREA_CLOSED: { status: 422, friendly: "La zona común no está abierta en ese horario." },
  RESERVATION_INVALID_RANGE: { status: 422, friendly: "El rango de horario no es válido." },
  RESERVATION_INVALID_DURATION: { status: 422, friendly: "La duración está fuera de lo permitido para esa zona." },
  RESERVATION_IN_PAST: { status: 422, friendly: "No se puede reservar en el pasado." },
  OUTSIDE_BOOKING_WINDOW: { status: 422, friendly: "La fecha está fuera de la ventana de anticipación permitida para esa zona." },
  GUESTS_EXCEED_CAPACITY: { status: 422, friendly: "La cantidad de personas supera el aforo permitido." },
  UNIT_RESERVATION_LIMIT: { status: 422, friendly: "La unidad ya alcanzó el máximo de reservas activas para esa zona." },
  UNIT_HAS_OVERDUE_BALANCE: {
    status: 422,
    friendly: "Según el reglamento configurado, esta zona no se puede reservar mientras la unidad tenga saldo vencido."
  },
  RESERVATION_NOT_FOUND: { status: 404, friendly: "La reserva no existe." },
  RESERVATION_NOT_MODIFIABLE: { status: 422, friendly: "La reserva ya no se puede modificar." },
  RESERVATION_NOT_PENDING: { status: 422, friendly: "La reserva ya fue gestionada." },
  CATEGORY_NOT_FOUND: { status: 422, friendly: "La categoría indicada no existe." },
  PQRS_NOT_FOUND: { status: 404, friendly: "La PQRS no existe." },
  PQRS_CLOSED: { status: 422, friendly: "La PQRS está cerrada." },
  PAYMENT_NOT_FOUND: { status: 404, friendly: "El pago no existe." },
  PERSON_NOT_FOUND: { status: 404, friendly: "La persona no existe." },
  CONVERSATION_NOT_FOUND: { status: 404, friendly: "La conversación no existe." },
  VALIDATION_ERROR: { status: 422, friendly: "Los datos enviados no son válidos." }
};

export function mapPostgresErrorMessage(message: string): AppError | null {
  for (const [code, entry] of Object.entries(POSTGRES_ERRORS)) {
    if (message.includes(code)) {
      // "VALIDATION_ERROR: detalle" -> se conserva el detalle en español.
      const detail = code === "VALIDATION_ERROR" ? message.split("VALIDATION_ERROR:")[1]?.trim() : undefined;
      return new AppError(code, detail || entry.friendly, entry.status);
    }
  }
  return null;
}

/** Convierte el error de un RPC de InsForge en AppError (nunca filtra el mensaje crudo). */
export function toAppError(error: { message?: string } | null | undefined, fallback: string): AppError {
  const mapped = error?.message ? mapPostgresErrorMessage(error.message) : null;
  return mapped ?? new AppError(ErrorCodes.INTERNAL_ERROR, fallback, 500);
}
