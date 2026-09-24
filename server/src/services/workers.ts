import type { IntervalWorker } from "../lib/intervalWorker.js";
import { jobWorker } from "./jobs/jobWorker.js";
import { outboxWorker } from "./outbox/outboxWorker.js";
import { paymentReminderWorker } from "./reminders/paymentReminderWorker.js";
import { subscriptionWorker } from "./subscription/subscriptionScheduler.js";

/** Procesos periódicos del compute service (además del poller de Telegram). */
export const BACKGROUND_WORKERS: IntervalWorker[] = [outboxWorker, jobWorker, paymentReminderWorker, subscriptionWorker];
