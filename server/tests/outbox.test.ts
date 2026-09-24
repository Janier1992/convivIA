import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OutboundMessage } from "../src/types/domain.js";
import { callsTo, createInsforgeMock, type InsforgeMock } from "./helpers/insforgeMock.js";

let db: InsforgeMock = createInsforgeMock({});
const sendTelegramMock = vi.fn();
const sendWhatsAppMock = vi.fn();
const sendTemplateMock = vi.fn();

vi.mock("../src/lib/insforge.js", () => ({
  get insforgeAdmin() {
    return db;
  }
}));
vi.mock("../src/services/telegram/telegramService.js", () => ({
  loadTelegramBotToken: vi.fn(async () => "bot-token"),
  sendTelegramMessage: (...a: unknown[]) => sendTelegramMock(...a)
}));
vi.mock("../src/services/twilio/twilioService.js", () => ({
  sendWhatsAppMessage: (...a: unknown[]) => sendWhatsAppMock(...a),
  sendWhatsAppTemplate: (...a: unknown[]) => sendTemplateMock(...a)
}));

const { deliverOutbound } = await import("../src/services/outbox/outboxSender.js");
const { processOutboxBatch } = await import("../src/services/outbox/outboxWorker.js");

function outbound(overrides: Partial<OutboundMessage> = {}): OutboundMessage {
  return {
    id: "out-1", organization_id: "org-1", channel: "whatsapp", conversation_id: "conv-1", person_id: "p-1",
    destination: "+573001112233", kind: "payment_reminder", body: "Hola, te recordamos...", template_key: "payment_reminder",
    template_vars: { "1": "Ana" }, status: "sending", attempts: 1, ...overrides
  };
}

describe("entrega del outbox", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendTemplateMock.mockResolvedValue("sent");
  });

  it("dentro de la ventana de 24 h de WhatsApp envía texto libre", async () => {
    db = createInsforgeMock({ conversations: { data: { last_inbound_at: new Date(Date.now() - 3_600_000).toISOString() }, error: null } });
    expect(await deliverOutbound(outbound())).toBe("free_text");
    expect(sendWhatsAppMock).toHaveBeenCalledWith("org-1", "+573001112233", "Hola, te recordamos...");
    expect(sendTemplateMock).not.toHaveBeenCalled();
  });

  it("fuera de la ventana usa la plantilla aprobada, nunca texto libre", async () => {
    db = createInsforgeMock({ conversations: { data: { last_inbound_at: "2026-01-01T00:00:00Z" }, error: null } });
    expect(await deliverOutbound(outbound())).toBe("template");
    expect(sendTemplateMock).toHaveBeenCalledWith("org-1", "+573001112233", "payment_reminder", { "1": "Ana" });
    expect(sendWhatsAppMock).not.toHaveBeenCalled();
  });

  it("una respuesta del equipo fuera de la ventana falla de forma permanente y explicada", async () => {
    db = createInsforgeMock({ conversations: { data: { last_inbound_at: null }, error: null } });
    await expect(deliverOutbound(outbound({ kind: "staff_reply", template_key: null }))).rejects.toThrow(/24 horas/);
  });

  it("Telegram entrega al chat id sin restricciones de ventana", async () => {
    db = createInsforgeMock({});
    expect(await deliverOutbound(outbound({ channel: "telegram", destination: "42" }))).toBe("free_text");
    expect(sendTelegramMock).toHaveBeenCalledWith("bot-token", "42", "Hola, te recordamos...");
  });

  it("el worker reintenta fallas transitorias y abandona las permanentes", async () => {
    db = createInsforgeMock(
      { conversations: { data: { last_inbound_at: null }, error: null }, outbound_messages: { data: null, error: null } },
      {
        claim_outbound_messages: {
          data: [
            outbound({ id: "transient", channel: "telegram", destination: "42" }),
            outbound({ id: "permanent", kind: "staff_reply", template_key: null })
          ],
          error: null
        }
      }
    );
    sendTelegramMock.mockRejectedValueOnce(new Error("socket hang up"));
    await processOutboxBatch();
    const updates = callsTo(db, "outbound_messages", "update").map((args) => (args[0] as { status: string }).status);
    expect(updates).toEqual(["queued", "failed"]);
  });
});
