import { beforeEach, describe, expect, it, vi } from "vitest";
import { callsTo, createInsforgeMock, type InsforgeMock } from "./helpers/insforgeMock.js";
import { AGENT, toolContext } from "./helpers/fixtures.js";

/**
 * Suite de evaluación adversaria (sección 16 del prompt maestro): no
 * confía en que "el código se ve bien" — ejercita el runtime real como lo
 * haría un modelo comprometido o una fuga entre copropiedades, y verifica
 * que las barreras deterministas (no las reglas del prompt, que no son
 * verificables por código) sostengan la garantía en cada caso.
 *
 * Lo que SÍ es verificable acá: qué puede controlar el modelo (nombres de
 * argumento expuestos), y qué filtro usa cada consulta con datos privados.
 * Lo que NO es verificable por código (resistencia a texto de jailbreak
 * dentro de PQRS/documentos, extracción del system prompt) queda fuera a
 * propósito — es responsabilidad de red-teaming humano periódico, no de
 * esta suite; documentado en el reporte de observabilidad, no fingido acá.
 */

let db: InsforgeMock = createInsforgeMock({});

vi.mock("../src/lib/insforge.js", () => ({
  get insforgeAdmin() {
    return db;
  }
}));

const { ALL_TOOLS, executeTool, getAvailableTools } = await import("../src/services/agent/toolRegistry.js");
const { confirmAction, discardAction, proposeAction } = await import("../src/services/agent/pendingActions.js");

async function run(name: string, args: unknown, ctx = toolContext()) {
  return executeTool(name, args, ctx, getAvailableTools(ctx));
}

describe("superficie de ataque: qué puede controlar el modelo", () => {
  it("ninguna herramienta expone un identificador de copropiedad/tenant/conversación como argumento del modelo", () => {
    const forbidden = ["organization_id", "organizationid", "org_id", "orgid", "tenant_id", "tenantid", "conversation_id", "conversationid"];
    const offenders: string[] = [];
    for (const tool of ALL_TOOLS) {
      const props = (tool.parameters as { properties?: Record<string, unknown> }).properties ?? {};
      for (const key of Object.keys(props)) {
        if (forbidden.includes(key.toLowerCase())) offenders.push(`${tool.name}.${key}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("cada herramienta declara acceso 'public' o 'verified' explícitamente (nada queda en un default implícito)", () => {
    for (const tool of ALL_TOOLS) {
      expect(["public", "verified"]).toContain(tool.access);
    }
  });
});

describe("fuga entre copropiedades: la consulta usa SIEMPRE la organización real del contexto, nunca una fija", () => {
  beforeEach(() => vi.clearAllMocks());

  const STATEMENT = {
    as_of: "2026-10-05T15:00:00Z",
    today: "2026-10-05",
    unit: { code: "T1-502" },
    balance: 0,
    credit: 0,
    overdue_amount: 0,
    current_amount: 0,
    oldest_overdue_due_date: null,
    next_due_date: null,
    open_items: [],
    recent_payments: [],
    pending_reports: 0
  };

  it("consultar_estado_cuenta", async () => {
    db = createInsforgeMock(
      { property_profiles: { data: null, error: null } },
      { get_unit_statement: { data: STATEMENT, error: null } }
    );
    await run("consultar_estado_cuenta", {}, toolContext({ organizationId: "org-victima" }));
    expect(callsTo(db, "property_profiles", "eq")).toContainEqual(["organization_id", "org-victima"]);
  });

  it("proponer_pqrs (lectura de categorías)", async () => {
    db = createInsforgeMock({ pqrs_categories: { data: [], error: null } });
    await run(
      "proponer_pqrs",
      { tipo: "queja", categoria: "Mantenimiento", asunto: "Asunto de prueba", descripcion: "Descripción de prueba con largo suficiente." },
      toolContext({ organizationId: "org-victima" })
    );
    expect(callsTo(db, "pqrs_categories", "eq")).toContainEqual(["organization_id", "org-victima"]);
  });

  it("consultar_mis_paquetes (portería)", async () => {
    db = createInsforgeMock({ packages: { data: [], error: null } });
    await run("consultar_mis_paquetes", {}, toolContext({ organizationId: "org-victima", agent: { ...AGENT, visitors_enabled: true } }));
    expect(callsTo(db, "packages", "eq")).toContainEqual(["organization_id", "org-victima"]);
  });

  it("consultar_visitantes_hoy (portería)", async () => {
    db = createInsforgeMock({ visitor_authorizations: { data: [], error: null } });
    await run("consultar_visitantes_hoy", {}, toolContext({ organizationId: "org-victima", agent: { ...AGENT, visitors_enabled: true } }));
    expect(callsTo(db, "visitor_authorizations", "eq")).toContainEqual(["organization_id", "org-victima"]);
  });

  it("buscar_en_documentos (RPC, no query directa)", async () => {
    db = createInsforgeMock({}, { search_document_chunks: { data: [], error: null } });
    await run("buscar_en_documentos", { consulta: "reglamento" }, toolContext({ organizationId: "org-victima" }));
    expect(db.database.rpc).toHaveBeenCalledWith("search_document_chunks", expect.objectContaining({ p_organization_id: "org-victima" }));
  });
});

describe("techo de identidad: la herramienta se protege sola, no solo el enrutador", () => {
  it("consultar_estado_cuenta rechaza identidad no verificada aunque se llame directo (sin pasar por el filtro de disponibilidad)", async () => {
    const tool = ALL_TOOLS.find((t) => t.name === "consultar_estado_cuenta")!;
    const result = await tool.execute({}, toolContext({ identityStatus: "unverified", identity: null }));
    expect(result).toMatchObject({ success: false, error_code: "NOT_VERIFIED" });
  });

  it("proponer_reporte_pago rechaza identidad no verificada aunque se llame directo", async () => {
    const tool = ALL_TOOLS.find((t) => t.name === "proponer_reporte_pago")!;
    const result = await tool.execute(
      { valor: 100_000, fecha_pago: "2026-10-01", medio: "pse" },
      toolContext({ identityStatus: "unverified", identity: null })
    );
    expect(result).toMatchObject({ success: false, error_code: "NOT_VERIFIED" });
  });
});

describe("fuga entre conversaciones al confirmar una acción: el id solo no basta, siempre se exige la conversación real", () => {
  beforeEach(() => vi.clearAllMocks());

  it("confirmar_accion siempre filtra pending_actions por la conversación del contexto, no solo por el id", async () => {
    db = createInsforgeMock({ pending_actions: { data: null, error: null } });
    await confirmAction(toolContext({ conversationId: "conv-victima" }), "cualquier-id-adivinado");
    expect(callsTo(db, "pending_actions", "eq")).toContainEqual(["conversation_id", "conv-victima"]);
  });

  it("descartar_accion también filtra por conversación y por estado pendiente", async () => {
    db = createInsforgeMock({ pending_actions: { data: [], error: null } });
    await discardAction(toolContext({ conversationId: "conv-victima" }), "cualquier-id-adivinado");
    const eqCalls = callsTo(db, "pending_actions", "eq");
    expect(eqCalls).toContainEqual(["conversation_id", "conv-victima"]);
    expect(eqCalls).toContainEqual(["status", "pending"]);
  });

  it("proponer_accion siempre guarda la propuesta bajo la organización y conversación reales del contexto", async () => {
    db = createInsforgeMock({ pending_actions: [{ data: null, error: null }, { data: { id: "a-1", expires_at: "x" }, error: null }] });
    await proposeAction(toolContext({ organizationId: "org-victima", conversationId: "conv-victima" }), "report_payment", {}, "resumen");
    const inserted = callsTo(db, "pending_actions", "insert")[0][0] as { organization_id: string; conversation_id: string }[];
    expect(inserted[0]).toMatchObject({ organization_id: "org-victima", conversation_id: "conv-victima" });
  });
});
