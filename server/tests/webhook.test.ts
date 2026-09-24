import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

const routingMock = vi.fn();
const validateSignatureMock = vi.fn();
const processInboundMock = vi.fn();

vi.mock("../src/services/twilio/twilioService.js", () => ({
  resolveOrganizationForIncomingNumber: (...args: unknown[]) => routingMock(...args),
  validateTwilioSignature: (...args: unknown[]) => validateSignatureMock(...args),
  stripWhatsAppPrefix: (value: string) => value.replace(/^whatsapp:/, "")
}));

vi.mock("../src/services/twilio/whatsappInboundProcessor.js", () => ({
  processWhatsAppInbound: (...args: unknown[]) => processInboundMock(...args)
}));

const { createApp } = await import("../src/app.js");

function post(body: Record<string, string>) {
  return request(createApp()).post("/api/webhooks/twilio/whatsapp").type("form").send(body);
}

describe("POST /api/webhooks/twilio/whatsapp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    routingMock.mockResolvedValue({ organizationId: "org-1", credentials: { account_sid: "AC", auth_token: "token" } });
    validateSignatureMock.mockReturnValue(true);
    processInboundMock.mockResolvedValue(undefined);
  });

  it("rechaza un payload sin remitente", async () => {
    const res = await post({ To: "whatsapp:+10000000000", Body: "hola" });
    expect(res.status).toBe(400);
  });

  it("rechaza un mensaje vacío sin adjuntos", async () => {
    const res = await post({ From: "whatsapp:+573001112233", To: "whatsapp:+10000000000", Body: "  " });
    expect(res.status).toBe(400);
  });

  it("devuelve 404 si el número no pertenece a ninguna copropiedad", async () => {
    routingMock.mockResolvedValueOnce(null);
    const res = await post({ From: "whatsapp:+573001112233", To: "whatsapp:+19999999999", Body: "hola" });
    expect(res.status).toBe(404);
    expect(processInboundMock).not.toHaveBeenCalled();
  });

  it("devuelve 403 con una firma inválida", async () => {
    validateSignatureMock.mockReturnValueOnce(false);
    const res = await post({ From: "whatsapp:+573001112233", To: "whatsapp:+10000000000", Body: "hola" });
    expect(res.status).toBe(403);
    expect(processInboundMock).not.toHaveBeenCalled();
  });

  it("responde de inmediato y procesa el mensaje en segundo plano", async () => {
    const res = await post({ From: "whatsapp:+573001112233", To: "whatsapp:+10000000000", Body: "hola", ProfileName: "Ana", MessageSid: "SM1" });
    expect(res.status).toBe(200);
    expect(res.text).toContain("<Response>");
    expect(processInboundMock).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-1", fromPhone: "+573001112233", body: "hola", profileName: "Ana", media: undefined })
    );
  });

  it("acepta un soporte adjunto sin texto", async () => {
    const res = await post({
      From: "whatsapp:+573001112233",
      To: "whatsapp:+10000000000",
      NumMedia: "1",
      MediaUrl0: "https://api.twilio.com/media/ME1",
      MediaContentType0: "image/jpeg"
    });
    expect(res.status).toBe(200);
    expect(processInboundMock).toHaveBeenCalledWith(
      expect.objectContaining({ body: "", media: { url: "https://api.twilio.com/media/ME1", contentType: "image/jpeg" } })
    );
  });
});
