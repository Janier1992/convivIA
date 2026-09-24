import { Router } from "express";
import { env } from "../config/env.js";
import { getTelegramPollerHealth } from "../services/telegram/telegramPollingManager.js";
import { BACKGROUND_WORKERS } from "../services/workers.js";

export const healthRouter = Router();

// Si hay copropiedades con Telegram conectado pero ningún poller resolvió
// un getUpdates en este lapso, algo se trabó aunque Express responda (el
// long-poll normal completa cada ~25-30 s).
const TELEGRAM_STALE_THRESHOLD_MS = 2 * 60 * 1000;
// El outbox y la cola de trabajos corren cada pocos segundos.
const FAST_WORKER_STALE_MS = 2 * 60 * 1000;
const FAST_WORKERS = new Set(["outbox", "background_jobs"]);

healthRouter.get("/", (_req, res) => {
  const telegram = getTelegramPollerHealth();
  const telegramStale =
    telegram.activeOrgCount > 0 &&
    (!telegram.lastPollSuccessAt || Date.now() - new Date(telegram.lastPollSuccessAt).getTime() > TELEGRAM_STALE_THRESHOLD_MS);

  const workers = BACKGROUND_WORKERS.map((worker) => worker.health());
  const workersStale =
    env.WORKERS_ENABLED &&
    workers.some(
      (w) => FAST_WORKERS.has(w.name) && w.running && (!w.lastTickAt || Date.now() - new Date(w.lastTickAt).getTime() > FAST_WORKER_STALE_MS)
    );

  const degraded = telegramStale || workersStale;
  res.status(degraded ? 503 : 200).json({
    status: degraded ? "degraded" : "ok",
    telegram,
    workers,
    timestamp: new Date().toISOString()
  });
});
