import express from "express";
import helmet from "helmet";
import cors from "cors";
import { pinoHttp } from "pino-http";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { apiRouter } from "./routes/index.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";

export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  app.use(helmet());
  app.use(
    cors({
      origin: env.APP_URL,
      credentials: true
    })
  );
  app.use(pinoHttp({ logger, autoLogging: env.NODE_ENV !== "test" }));

  // application/json global; las rutas de webhooks que necesitan
  // application/x-www-form-urlencoded (Twilio) registran su propio parser.
  app.use(express.json({ limit: "1mb" }));

  app.use("/api", apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
