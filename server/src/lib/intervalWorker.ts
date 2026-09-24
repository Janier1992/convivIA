import { logger } from "./logger.js";

export interface WorkerHealth {
  name: string;
  running: boolean;
  lastTickAt: string | null;
  lastErrorAt: string | null;
}

export interface IntervalWorker {
  start(): void;
  stop(): void;
  health(): WorkerHealth;
  /** Ejecuta un ciclo inmediatamente (útil en tests). */
  tick(): Promise<void>;
}

/**
 * Proceso periódico sin solapamiento: si un ciclo tarda más que el
 * intervalo, el siguiente espera a que termine (nunca corren dos a la vez).
 * Un error en un ciclo se registra y no detiene al worker.
 */
export function createIntervalWorker(name: string, intervalMs: number, task: () => Promise<void>): IntervalWorker {
  let timer: NodeJS.Timeout | null = null;
  let busy = false;
  let lastTickAt: number | null = null;
  let lastErrorAt: number | null = null;

  async function tick() {
    if (busy) return;
    busy = true;
    try {
      await task();
      lastTickAt = Date.now();
    } catch (err) {
      lastErrorAt = Date.now();
      logger.error({ err, worker: name }, "worker_tick_failed");
    } finally {
      busy = false;
    }
  }

  return {
    start() {
      if (timer) return;
      void tick();
      timer = setInterval(() => void tick(), intervalMs);
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
    health: () => ({
      name,
      running: timer !== null,
      lastTickAt: lastTickAt ? new Date(lastTickAt).toISOString() : null,
      lastErrorAt: lastErrorAt ? new Date(lastErrorAt).toISOString() : null
    }),
    tick
  };
}
