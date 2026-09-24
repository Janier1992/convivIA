import pino from "pino";
import { env } from "../config/env.js";

const REDACT_PATHS = [
  "*.apiKey",
  "*.api_key",
  "*.accessToken",
  "*.access_token",
  "*.refreshToken",
  "*.refresh_token",
  "*.authToken",
  "*.auth_token",
  "*.credentials",
  "*.password",
  "*.secret",
  "req.headers.authorization",
  "req.headers[\"x-twilio-signature\"]"
];

export const logger = pino({
  level: env.NODE_ENV === "test" ? "silent" : "info",
  redact: { paths: REDACT_PATHS, censor: "[REDACTED]" }
});

export interface AgentLogContext {
  organizationId: string;
  conversationId?: string;
  requestId?: string;
  userId?: string;
}

export function logAgentEvent(
  context: AgentLogContext,
  event: {
    scope: "agent";
    tool?: string;
    durationMs?: number;
    result: "success" | "error";
    message?: string;
  }
) {
  logger.info({
    scope: event.scope,
    organization_id: context.organizationId,
    conversation_id: context.conversationId,
    request_id: context.requestId,
    tool: event.tool,
    duration_ms: event.durationMs,
    result: event.result,
    message: event.message
  });
}
