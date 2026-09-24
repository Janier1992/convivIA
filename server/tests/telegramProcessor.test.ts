import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Conversation } from "../src/types/domain.js";
import { RESIDENT } from "./helpers/fixtures.js";

const sent: { text: string; markup?: Record<string, unknown> }[] = [];
let conversation: Conversation;

const runAgentTurnMock = vi.fn();
const verifyMock = vi.fn();
const updateConversationMock = vi.fn();

vi.mock("../src/services/agent/agentRuntime.js", () => ({ runAgentTurn: (...a: unknown[]) => runAgentTurnMock(...a) }));
vi.mock("../src/services/conversations/identityService.js", () => ({
  verifyConversationByPhone: (...a: unknown[]) => verifyMock(...a)
}));
vi.mock("../src/services/conversations/inboundMessageHandler.js", () => ({
  findOrCreateConversation: vi.fn(async () => conversation),
  persistInboundMessage: vi.fn(),
  persistAssistantMessage: vi.fn(),
  updateConversation: (...a: unknown[]) => updateConversationMock(...a)
}));
vi.mock("../src/services/finance/receiptService.js", () => ({ handleReceiptMedia: vi.fn(), receiptReplyText: vi.fn() }));
vi.mock("../src/lib/insforge.js", () => ({
  insforgeAdmin: {
    database: {
      from: () => {
        const q: Record<string, unknown> = {};
        for (const m of ["select", "eq", "update"]) q[m] = () => q;
        q.maybeSingle = async () => ({ data: { display_name: "Conjunto Los Almendros", name: "Clara", privacy_policy_url: null }, error: null });
        q.then = (fn: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(fn);
        return q;
      }
    }
  }
}));
vi.mock("../src/services/telegram/telegramService.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/services/telegram/telegramService.js")>();
  return {
    ...actual,
    sendTelegramMessage: vi.fn(async (_token: string, _chat: number, text: string, options?: { replyMarkup?: Record<string, unknown> }) => {
      sent.push({ text, markup: options?.replyMarkup });
    }),
    sendTelegramTypingAction: vi.fn(),
    downloadTelegramFile: vi.fn()
  };
});

const { processUpdate } = await import("../src/services/telegram/telegramUpdateProcessor.js");

function baseConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: "conv-1", organization_id: "org-1", channel: "telegram", external_conversation_id: "42", external_identity: "telegram:42",
    contact_name: null, person_id: null, identity_status: "unverified", verified_at: null, verified_via: null, status: "active",
    notifications_opt_out: false, is_preview: false, privacy_notice_sent_at: null, contact_requested_at: null,
    last_inbound_at: null, last_message_at: null, ...overrides
  };
}

function update(message: Record<string, unknown>) {
  return { update_id: 7, message: { message_id: 1, date: 0, chat: { id: 42, type: "private" }, from: { id: 42, first_name: "Ana" }, ...message } };
}

describe("procesador de Telegram", () => {
  beforeEach(() => {
    sent.length = 0;
    vi.clearAllMocks();
    conversation = baseConversation();
  });

  it("/start saluda, muestra el aviso de privacidad y pide compartir el número", async () => {
    await processUpdate("org-1", "token", update({ text: "/start" }));
    expect(sent[0].text).toContain("Conjunto Los Almendros");
    expect(sent[0].text).toMatch(/datos personales/);
    expect(JSON.stringify(sent[0].markup)).toContain("request_contact");
    expect(runAgentTurnMock).not.toHaveBeenCalled();
  });

  it("rechaza el contacto de otra persona", async () => {
    await processUpdate("org-1", "token", update({ contact: { phone_number: "573001112233", user_id: 999 } }));
    expect(verifyMock).not.toHaveBeenCalled();
    expect(sent[0].text).toMatch(/solo puedo verificar tu propio número/);
  });

  it("verifica con el contacto propio y quita el teclado", async () => {
    verifyMock.mockResolvedValueOnce({ status: "verified", identity: RESIDENT });
    await processUpdate("org-1", "token", update({ contact: { phone_number: "573001112233", user_id: 42 } }));
    expect(verifyMock).toHaveBeenCalledWith(conversation, "573001112233", "telegram_contact");
    expect(sent[0].text).toMatch(/Gracias, Ana! Verifiqué tu identidad: T1-502 \(propietario\)/);
    expect(sent[0].markup).toEqual({ remove_keyboard: true });
  });

  it("pasa el texto al asistente y agrega el aviso de privacidad en la primera respuesta", async () => {
    runAgentTurnMock.mockResolvedValueOnce({ reply: "Tu saldo es $ 0.", channelActions: [], roundsUsed: 1, outcome: "reply" });
    await processUpdate("org-1", "token", update({ text: "¿cuánto debo?" }));
    expect(runAgentTurnMock).toHaveBeenCalledWith(expect.objectContaining({ conversationId: "conv-1" }));
    expect(sent[0].text).toMatch(/^Tu saldo es \$ 0\.\n\nℹ️/);
  });

  it("muestra el botón de contacto cuando el asistente pide verificación", async () => {
    conversation = baseConversation({ privacy_notice_sent_at: "2026-01-01T00:00:00Z" });
    runAgentTurnMock.mockResolvedValueOnce({ reply: "Toca el botón", channelActions: ["request_contact"], roundsUsed: 2, outcome: "reply" });
    await processUpdate("org-1", "token", update({ text: "quiero mi saldo" }));
    expect(sent[0]).toEqual({ text: "Toca el botón", markup: expect.objectContaining({ keyboard: expect.any(Array) }) });
  });

  it("la baja de comunicados es determinista y no llama al asistente", async () => {
    await processUpdate("org-1", "token", update({ text: "BAJA" }));
    expect(runAgentTurnMock).not.toHaveBeenCalled();
    expect(updateConversationMock).toHaveBeenCalledWith("conv-1", { notifications_opt_out: true });
  });

  it("ignora chats grupales para no exponer información privada", async () => {
    await processUpdate("org-1", "token", { update_id: 1, message: { message_id: 1, date: 0, chat: { id: -5, type: "group" }, text: "hola" } });
    expect(sent).toHaveLength(0);
    expect(runAgentTurnMock).not.toHaveBeenCalled();
  });
});
