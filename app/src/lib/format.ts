const COP = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
const NUMBER = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 });
const DEFAULT_TIME_ZONE = "America/Bogota";

/** $ 1.234.567 — las cifras vienen de la base de datos; aquí solo se formatean. */
export function formatMoney(amount: number | string | null | undefined): string {
  if (amount === null || amount === undefined || amount === "") return "—";
  const value = Number(amount);
  return Number.isFinite(value) ? COP.format(value) : "—";
}

export function formatNumber(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  return NUMBER.format(Number(value));
}

/** Fecha sin hora (YYYY-MM-DD) -> "5 oct 2026", sin corrimientos de zona horaria. */
export function formatDate(ymd: string | null | undefined): string {
  if (!ymd) return "—";
  const [y, m, d] = ymd.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("es-CO", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC"
  });
}

export function formatDateTime(iso: string | null | undefined, timeZone = DEFAULT_TIME_ZONE): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("es-CO", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone
  });
}

export function formatTime(iso: string, timeZone = DEFAULT_TIME_ZONE): string {
  return new Date(iso).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit", timeZone });
}

/** "hace 5 min", "en 3 h", "hace 2 días". */
export function formatRelative(iso: string | null | undefined, now = new Date()): string {
  if (!iso) return "—";
  const diffMs = new Date(iso).getTime() - now.getTime();
  const abs = Math.abs(diffMs);
  const rtf = new Intl.RelativeTimeFormat("es-CO", { numeric: "auto" });
  if (abs < 3_600_000) return rtf.format(Math.round(diffMs / 60_000), "minute");
  if (abs < 86_400_000) return rtf.format(Math.round(diffMs / 3_600_000), "hour");
  return rtf.format(Math.round(diffMs / 86_400_000), "day");
}

/** Fecha de hoy (YYYY-MM-DD) en la zona horaria de la copropiedad. */
export function todayIn(timeZone = DEFAULT_TIME_ZONE, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function firstDayOfMonth(ymd: string): string {
  return `${ymd.slice(0, 7)}-01`;
}

export function addMonths(ymd: string, months: number): string {
  const [y, m] = ymd.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1 + months, 1));
  return date.toISOString().slice(0, 10);
}

/** Día `day` del mes de `ymd` (acotado a 28 para evitar meses cortos). */
export function dayOfMonth(ymd: string, day: number): string {
  return `${ymd.slice(0, 7)}-${String(Math.min(Math.max(day, 1), 28)).padStart(2, "0")}`;
}

export function monthLabel(ymd: string): string {
  const [y, m] = ymd.split("-").map(Number);
  const label = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("es-CO", { month: "long", year: "numeric", timeZone: "UTC" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
