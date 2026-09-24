import { beforeEach, describe, expect, it, vi } from "vitest";
import { callsTo, createInsforgeMock, type InsforgeMock } from "./helpers/insforgeMock.js";
import { toolContext } from "./helpers/fixtures.js";

let db: InsforgeMock = createInsforgeMock({});

vi.mock("../src/lib/insforge.js", () => ({
  get insforgeAdmin() {
    return db;
  }
}));

const { confirmAction, proposeAction } = await import("../src/services/agent/pendingActions.js");

const PAYLOAD = {
  unit_id: "unit-1",
  unit_code: "T1-502",
  person_id: "person-1",
  amount: 350000,
  paid_on: "2026-10-04",
  method: "pse",
  reference: "123"
};

function action(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    action_type: "report_payment",
    payload: PAYLOAD,
    summary: "Reportar un pago de $ 350.000",
    status: "pending",
    created_at: "2026-10-05T14:59:00Z",
    expires_at: "2026-10-05T15:29:00Z",
    ...overrides
  };
}

describe("acciones pendientes: confirmación verificable", () => {
  beforeEach(() => vi.clearAllMocks());

  it("proponer descarta propuestas anteriores y devuelve el resumen generado por el servidor", async () => {
    db = createInsforgeMock({ pending_actions: [{ data: null, error: null }, { data: { id: "a-1", expires_at: "x" }, error: null }] });
    const result = await proposeAction(toolContext(), "report_payment", PAYLOAD, "Resumen del servidor");
    expect(result).toMatchObject({ success: true, data: { accion_id: "a-1", resumen: "Resumen del servidor", requiere_confirmacion: true } });
    expect(callsTo(db, "pending_actions", "update")[0][0]).toMatchObject({ status: "discarded" });
  });

  it("no ejecuta si el residente no respondió después de la propuesta", async () => {
    db = createInsforgeMock({ pending_actions: { data: action(), error: null }, messages: { data: [], error: null } });
    const result = await confirmAction(toolContext(), action().id);
    expect(result).toMatchObject({ success: false, error_code: "CONFIRMATION_REQUIRED" });
    expect(db.database.rpc).not.toHaveBeenCalled();
  });

  it("ejecuta exactamente el payload propuesto, no argumentos nuevos del modelo", async () => {
    db = createInsforgeMock(
      {
        pending_actions: [{ data: action(), error: null }, { data: [{ id: action().id }], error: null }, { data: null, error: null }],
        messages: { data: [{ id: "m-2" }], error: null }
      },
      { report_payment_from_resident: { data: { id: "pay-1", receipt_storage_key: null }, error: null } }
    );
    const result = await confirmAction(toolContext(), action().id);
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ pago_id: "pay-1", estado: expect.stringContaining("pendiente de verificación") });
    expect(db.database.rpc).toHaveBeenCalledWith(
      "report_payment_from_resident",
      expect.objectContaining({ p_amount: 350000, p_unit_id: "unit-1", p_person_id: "person-1", p_paid_on: "2026-10-04" })
    );
  });

  it("en vista previa nunca ejecuta la acción", async () => {
    db = createInsforgeMock({
      pending_actions: [{ data: action(), error: null }, { data: [{ id: action().id }], error: null }, { data: null, error: null }],
      messages: { data: [{ id: "m-2" }], error: null }
    });
    const result = await confirmAction(toolContext({ isPreview: true }), action().id);
    expect(result).toMatchObject({ success: true, data: { simulado: true } });
    expect(db.database.rpc).not.toHaveBeenCalled();
  });

  it("rechaza propuestas vencidas o ya resueltas", async () => {
    db = createInsforgeMock({ pending_actions: { data: action({ expires_at: "2026-10-05T14:00:00Z" }), error: null } });
    expect(await confirmAction(toolContext(), action().id)).toMatchObject({ error_code: "ACTION_EXPIRED" });
    db = createInsforgeMock({ pending_actions: { data: action({ status: "executed" }), error: null } });
    expect(await confirmAction(toolContext(), action().id)).toMatchObject({ error_code: "ACTION_ALREADY_RESOLVED" });
  });

  it("si la base de datos rechaza la acción, devuelve el motivo en lenguaje claro", async () => {
    db = createInsforgeMock(
      {
        pending_actions: [
          { data: action({ action_type: "book_area", payload: { area_id: "a", unit_id: "u", start_at: "s", end_at: "e", guests: 1 } }), error: null },
          { data: [{ id: action().id }], error: null },
          { data: null, error: null }
        ],
        messages: { data: [{ id: "m-2" }], error: null }
      },
      { book_area_reservation: { data: null, error: { message: "UNIT_HAS_OVERDUE_BALANCE" } } }
    );
    const result = await confirmAction(toolContext(), action().id);
    expect(result).toMatchObject({ success: false, error_code: "UNIT_HAS_OVERDUE_BALANCE" });
    expect(result.message).toMatch(/saldo vencido/);
    expect(callsTo(db, "pending_actions", "update").at(-1)?.[0]).toMatchObject({ status: "failed" });
  });
});
