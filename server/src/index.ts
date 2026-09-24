import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { startTelegramPollingManager, stopTelegramPollingManager } from "./services/telegram/telegramPollingManager.js";
import { BACKGROUND_WORKERS } from "./services/workers.js";

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV, workers: env.WORKERS_ENABLED }, "server_started");
  if (!env.WORKERS_ENABLED) return;
  startTelegramPollingManager();
  for (const worker of BACKGROUND_WORKERS) worker.start();
});

function shutdown() {
  stopTelegramPollingManager();
  for (const worker of BACKGROUND_WORKERS) worker.stop();
  server.close(() => process.exit(0));
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
