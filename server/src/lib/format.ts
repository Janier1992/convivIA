import { formatInTimeZone } from "date-fns-tz";

/** $ 1.234.567 — mismo formato que public.format_cop() en SQL. */
export function formatCop(amount: number | string | null | undefined): string {
  const value = Math.round(Number(amount ?? 0));
  const sign = value < 0 ? "-" : "";
  const digits = Math.abs(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `$ ${sign}${digits}`;
}

/** 2026-10-05 -> 05/10/2026 (sin conversiones de zona horaria). */
export function formatDateYmd(ymd: string | null | undefined): string | null {
  if (!ymd) return null;
  const [y, m, d] = ymd.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

export function formatDateTimeInZone(iso: string, timeZone: string): string {
  return formatInTimeZone(new Date(iso), timeZone, "dd/MM/yyyy HH:mm");
}

export function formatTimeInZone(iso: string, timeZone: string): string {
  return formatInTimeZone(new Date(iso), timeZone, "HH:mm");
}

export function todayInZone(timeZone: string, now = new Date()): string {
  return formatInTimeZone(now, timeZone, "yyyy-MM-dd");
}

const RELATION_LABELS: Record<string, string> = {
  owner: "propietario",
  tenant: "arrendatario",
  resident: "residente",
  authorized: "autorizado"
};

export function relationLabel(relation: string): string {
  return RELATION_LABELS[relation] ?? relation;
}

const PQRS_STATUS_LABELS: Record<string, string> = {
  received: "recibida",
  classified: "clasificada",
  assigned: "asignada",
  in_progress: "en gestión",
  waiting_info: "esperando información",
  answered: "respondida",
  closed: "cerrada"
};

export function pqrsStatusLabel(status: string): string {
  return PQRS_STATUS_LABELS[status] ?? status;
}

const RESERVATION_STATUS_LABELS: Record<string, string> = {
  pending_approval: "pendiente de aprobación",
  confirmed: "confirmada",
  rejected: "rechazada",
  cancelled: "cancelada",
  completed: "cumplida",
  no_show: "no asistió"
};

export function reservationStatusLabel(status: string): string {
  return RESERVATION_STATUS_LABELS[status] ?? status;
}
