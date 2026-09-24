import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentContext } from "../src/services/agent/agentContext.js";

// Dos mensajes seguidos disparan dos turnos en paralelo para la misma
// conversación. Sin serializar por conversationId, el turno más rápido
// persistiría su respuesta primero y el residente las recibiría fuera de orden.
const log: string[] = [];

function makeContext(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    organization: { id: "org-1", name: "Conjunto", property_type: "residential_complex", status: "active", timezone: "America/Bogota" },
    profile: { organization_id: "org-1", display_name: "Conjunto Los Almendros" } as AgentContext["profile"],
    agent: {
      id: "agent-1", organization_id: "org-1", name: "Clara", enabled: true, tone: "friendly", system_instructions: null,
      finance_enabled: true, payment_reports_enabled: true, pqrs_enabled: true, reservations_enabled: true,
      documents_enabled: true, handoff_enabled: true
    },
    rules: [],
    areas: [],
    pqrsCategories: [],
    conversation: {
      id: "conv", organization_id: "org-1", channel: "telegram", external_conversation_id: "1", external_identity: "telegram:1",
      contact_name: null, person_id: null, identity_status: "unverified", verified_at: null, verified_via: null, status: "active",
      notifications_opt_out: false, is_preview: false, privacy_notice_sent_at: null, contact_requested_at: null,
      last_inbound_at: null, last_message_at: null
    },
    identity: null,
    ...overrides
  };
}

const loadAgentContextMock = vi.fn(async (_org: string, conversationId: string) => {
  log.push(`loadContext:${conversationId}`);
  return makeContext();
});

vi.mock("../src/services/agent/agentContext.js", () => ({
  loadAgentContext: (org: string, conv: string) => loadAgentContextMock(org, conv),
  loadResidentIdentity: vi.fn()
}));

vi.mock("../src/services/agent/toolRegistry.js", () => ({
  getAvailableTools: () => [],
  toOpenAiTools: () => [],
  executeTool: vi.fn()
}));

function makeQuery(table: string) {
  const obj: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order"]) obj[m] = vi.fn(() => obj);
  obj.limit = vi.fn(async () => ({ data: [], error: null }));
  obj.insert = vi.fn(async (records: Array<{ role: string; content: string }>) => {
    if (table === "messages") log.push(`persist:${records[0].role}:${records[0].content}`);
    if (table === "ai_traces") log.push(`trace:${(records[0] as unknown as { outcome: string }).outcome}`);
    return { data: null, error: null };
  });
  return obj;
}

vi.mock("../src/lib/insforge.js", () => ({
  insforgeAdmin: { database: { from: vi.fn((table: string) => makeQuery(table)) } }
}));

const createMock = vi.fn();

vi.mock("../src/lib/openai.js", () => ({
  openai: { chat: { completions: { create: (...args: unknown[]) => createMock(...args) } } },
  OPENAI_MODEL: "test-model",
  IS_OPENROUTER: false
}));

const { runAgentTurn, FALLBACK_REPLY } = await import("../src/services/agent/agentRuntime.js");

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("runAgentTurn", () => {
  beforeEach(() => {
    log.length = 0;
    vi.clearAllMocks();
  });

  it("serializa turnos concurrentes de la misma conversación aunque el segundo responda más rápido", async () => {
    let call = 0;
    createMock.mockImplementation(async () => {
      call += 1;
      const label = call === 1 ? "A" : "B";
      await delay(call === 1 ? 40 : 5);
      return { choices: [{ message: { content: `respuesta ${label}` } }] };
    });

    const [a, b] = await Promise.all([
      runAgentTurn({ organizationId: "org-1", conversationId: "conv-shared" }),
      runAgentTurn({ organizationId: "org-1", conversationId: "conv-shared" })
    ]);

    expect([a.reply, b.reply]).toEqual(["respuesta A", "respuesta B"]);
    expect(log).toEqual([
      "loadContext:conv-shared",
      "persist:assistant:respuesta A",
      "trace:reply",
      "loadContext:conv-shared",
      "persist:assistant:respuesta B",
      "trace:reply"
    ]);
  });

  it("no serializa conversaciones distintas", async () => {
    createMock.mockImplementation(async () => {
      await delay(5);
      return { choices: [{ message: { content: "ok" } }] };
    });
    await Promise.all([
      runAgentTurn({ organizationId: "org-1", conversationId: "conv-1" }),
      runAgentTurn({ organizationId: "org-1", conversationId: "conv-2" })
    ]);
    expect(log.slice(0, 2)).toEqual(["loadContext:conv-1", "loadContext:conv-2"]);
  });

  it.each([
    ["copropiedad suspendida", makeContext({ organization: { ...makeContext().organization, status: "suspended" } })],
    ["asistente desactivado", makeContext({ agent: { ...makeContext().agent, enabled: false } })],
    ["conversación atendida por humano", makeContext({ conversation: { ...makeContext().conversation, status: "handoff" } })]
  ])("no llama al modelo si hay %s", async (_label, context) => {
    loadAgentContextMock.mockResolvedValueOnce(context);
    const result = await runAgentTurn({ organizationId: "org-1", conversationId: "conv-skip" });
    expect(result).toMatchObject({ reply: null, outcome: "skipped" });
    expect(createMock).not.toHaveBeenCalled();
  });

  it("limpia tokens de control filtrados por el proveedor", async () => {
    createMock.mockResolvedValueOnce({ choices: [{ message: { content: "Con gusto te ayudo. <CPA_DONE>" } }] });
    const result = await runAgentTurn({ organizationId: "org-1", conversationId: "conv-sanitize" });
    expect(result.reply).toBe("Con gusto te ayudo.");
  });

  it("responde con el mensaje de respaldo si el modelo falla", async () => {
    createMock.mockRejectedValueOnce(new Error("proveedor caído"));
    const result = await runAgentTurn({ organizationId: "org-1", conversationId: "conv-fail" });
    expect(result).toMatchObject({ reply: FALLBACK_REPLY, outcome: "fallback" });
    expect(log).toContain("trace:fallback");
  });
});
