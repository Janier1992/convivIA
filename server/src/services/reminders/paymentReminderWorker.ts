import { formatInTimeZone } from "date-fns-tz";
import { env } from "../../config/env.js";
import { insforgeAdmin } from "../../lib/insforge.js";
import { createIntervalWorker } from "../../lib/intervalWorker.js";
import { logger } from "../../lib/logger.js";

const TICK_MS = 30 * 60 * 1000;
// Nadie quiere un recordatorio de cobro a medianoche.
const SEND_FROM_HOUR = 8;
const SEND_UNTIL_HOUR = 19;

export function isWithinReminderHours(now: Date, timeZone = env.DEFAULT_TIMEZONE): boolean {
  const hour = Number(formatInTimeZone(now, timeZone, "H"));
  return hour >= SEND_FROM_HOUR && hour < SEND_UNTIL_HOUR;
}

/**
 * Encola los recordatorios de cobro del día. La selección (unidades, montos,
 * destinatarios con canal vinculado, bajas) y la idempotencia viven en SQL
 * (enqueue_payment_reminders); el outbox se encarga de entregarlos.
 */
export async function enqueueDueReminders(now = new Date()): Promise<number> {
  if (!isWithinReminderHours(now)) return 0;
  const { data, error } = await insforgeAdmin.database.rpc("enqueue_payment_reminders", {});
  if (error) {
    logger.warn({ err: error }, "payment_reminders_enqueue_failed");
    return 0;
  }
  const count = Number(data ?? 0);
  if (count > 0) logger.info({ count }, "payment_reminders_enqueued");
  return count;
}

export const paymentReminderWorker = createIntervalWorker("payment_reminders", TICK_MS, async () => {
  await enqueueDueReminders();
});
