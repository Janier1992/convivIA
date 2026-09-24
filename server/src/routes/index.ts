import { Router } from "express";
import { healthRouter } from "./health.js";
import { webhooksRouter } from "./webhooks.js";

export const apiRouter = Router();

apiRouter.use("/health", healthRouter);
apiRouter.use("/webhooks", webhooksRouter);
