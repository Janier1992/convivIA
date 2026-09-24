/**
 * Códigos que lanzan las funciones SQL y su mensaje para el equipo. Nunca
 * se muestra el error técnico de Postgres en pantalla.
 */
const FRIENDLY_ERRORS: Record<string, string> = {
  FORBIDDEN: "No tienes permiso para realizar esta acción.",
  TENANT_MISMATCH: "El dato seleccionado no pertenece a esta copropiedad.",
  UNIT_NOT_FOUND: "La unidad no existe o no está activa.",
  AREA_NOT_FOUND: "La zona común no existe o no está habilitada.",
  AREA_NOT_AVAILABLE: "Ese horario ya está ocupado para la zona común.",
  AREA_CLOSED: "La zona común no está abierta en ese horario.",
  RESERVATION_INVALID_RANGE: "El horario de la reserva no es válido.",
  RESERVATION_INVALID_DURATION: "La duración está fuera de lo permitido para esa zona.",
  RESERVATION_IN_PAST: "No se puede reservar en el pasado.",
  OUTSIDE_BOOKING_WINDOW: "La fecha está fuera de la anticipación permitida.",
  GUESTS_EXCEED_CAPACITY: "La cantidad de personas supera el aforo.",
  UNIT_RESERVATION_LIMIT: "La unidad ya tiene el máximo de reservas activas en esa zona.",
  UNIT_HAS_OVERDUE_BALANCE: "La unidad tiene saldo vencido y esta zona no se puede reservar en mora.",
  RESERVATION_NOT_PENDING: "La reserva ya fue gestionada.",
  RESERVATION_NOT_MODIFIABLE: "La reserva ya no se puede modificar.",
  CHARGE_ALREADY_VOIDED: "El cargo ya estaba anulado.",
  CHARGE_IMMUTABLE: "Un cargo no se edita: anúlalo y crea uno nuevo.",
  CONCEPT_NOT_FOUND: "El concepto de cobro no existe o no está activo.",
  PAYMENT_NOT_PENDING: "El pago ya fue revisado.",
  PAYMENT_NOT_CONFIRMED: "Solo se reversan pagos confirmados.",
  PAYMENT_IMMUTABLE: "Un pago confirmado solo se puede reversar.",
  PQRS_CLOSED: "La PQRS está cerrada; solo se puede reabrir a 'En gestión'.",
  ANNOUNCEMENT_ALREADY_SENT: "El comunicado ya fue enviado.",
  IMPORT_ALREADY_ROLLED_BACK: "Esta importación ya fue revertida.",
  IMPORT_HAS_DEPENDENT_DATA: "No se puede revertir: hay movimientos posteriores sobre las unidades importadas.",
  INVITE_NOT_PENDING: "La invitación ya no está vigente.",
  CATEGORY_NOT_FOUND: "La categoría no existe o está inactiva."
};

export class RpcError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
  }
}

export function friendlyError(raw: string | undefined | null): RpcError {
  const message = raw ?? "";
  const validation = message.match(/VALIDATION_ERROR:\s*(.+)/);
  if (validation) return new RpcError("VALIDATION_ERROR", validation[1].trim());
  for (const [code, friendly] of Object.entries(FRIENDLY_ERRORS)) {
    if (message.includes(code)) return new RpcError(code, friendly);
  }
  if (/duplicate key|23505/.test(message)) return new RpcError("DUPLICATE", "Ya existe un registro con esos datos.");
  if (/row-level security|permission denied/.test(message)) return new RpcError("FORBIDDEN", FRIENDLY_ERRORS.FORBIDDEN);
  if (/violates foreign key/.test(message)) {
    return new RpcError("IN_USE", "No se puede eliminar: tiene información relacionada (cargos, pagos, reservas...).");
  }
  return new RpcError("UNKNOWN", "No se pudo completar la operación. Intenta de nuevo.");
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Ocurrió un error inesperado.";
}
