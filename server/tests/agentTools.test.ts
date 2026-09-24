import { beforeEach, describe, expect, it, vi } from "vitest";
import { callsTo, createInsforgeMock, type InsforgeMock } from "./helpers/insforgeMock.js";
import { toolContext } from "./helpers/fixtures.js";

let db: InsforgeMock = createInsforgeMock({});

vi.mock("../src/lib/insforge.js", () => ({
  get insforgeAdmin() {
    return db;
  }
}));

const { executeTool, getAvailableTools } = await import("../src/services/agent/toolRegistry.js");

async function run(name: string, args: unknown, ctx = toolContext()) {
  return executeTool(name, args, ctx, getAvailableTools(ctx));
}

const STATEMENT = {
  as_of: "2026-10-05T15:00:00Z",
  today: "2026-10-05",
  unit: { code: "T1-502" },
  balance: 700000,
  credit: 0,
  overdue_amount: 350000,
  current_amount: 350000,
  oldest_overdue_due_date: "2026-09-10",
  next_due_date: "2026-10-10",
  open_items: [
    { concept: "Cuota", description: "Cuota de administración 09/2026", period: "2026-09-01", due_date: "2026-09-10", unpaid: 350000, days_overdue: 25 }
  ],
  recent_payments: [{ paid_on: "2026-08-09", amount: 350000, method: "pse" }],
  pending_reports: 1
};

describe("herramientas del asistente", () => {
  beforeEach(() => vi.clearAllMocks());

  it("el estado de cuenta devuelve cifras formateadas, fuente y fecha de corte", async () => {
    db = createInsforgeMock(
      { property_profiles: { data: { payment_instructions: "Cuenta de ahorros 123" }, error: null } },
      { get_unit_statement: { data: STATEMENT, error: null } }
    );
    const result = await run("consultar_estado_cuenta", {});
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      unidad: "T1-502", saldo_total: "$ 700.000", valor_vencido: "$ 350.000", al_dia: false,
      vencido_desde: "10/09/2026", reportes_de_pago_en_revision: 1, instrucciones_de_pago: "Cuenta de ahorros 123"
    });
    expect(result.meta).toEqual({ tipo_dato: "DATO_ESTRUCTURADO", fuente: "Estado de cuenta de la unidad T1-502", fecha_datos: STATEMENT.as_of });
    expect(db.database.rpc).toHaveBeenCalledWith("get_unit_statement", { p_unit_id: "unit-1" });
  });

  it("nunca consulta la cartera de una unidad sin acceso financiero", async () => {
    db = createInsforgeMock({});
    const result = await run("consultar_estado_cuenta", { unidad: "P-12" });
    expect(result).toMatchObject({ success: false, error_code: "UNIT_ACCESS_DENIED" });
    expect(db.database.rpc).not.toHaveBeenCalled();
  });

  it("solo propone reservas en franjas disponibles del motor de reservas", async () => {
    db = createInsforgeMock(
      { pending_actions: [{ data: null, error: null }, { data: { id: "act-1", expires_at: "x" }, error: null }] },
      {
        get_area_slots: {
          data: [
            { start_at: "2026-10-10T19:00:00.000Z", end_at: "2026-10-10T23:00:00.000Z", available: true, remaining_capacity: 1 },
            { start_at: "2026-10-10T20:00:00.000Z", end_at: "2026-10-11T00:00:00.000Z", available: false, remaining_capacity: 0 }
          ],
          error: null
        }
      }
    );
    const ok = await run("proponer_reserva_zona", {
      zona: "salon social", fecha: "2026-10-10", hora_inicio: "14:00", duracion_minutos: 240, unidad: "T1-502", invitados: 30
    });
    expect(ok.success).toBe(true);
    expect((ok.data as { resumen: string }).resumen).toBe(
      "Reservar Salón social el 10/10/2026 de 14:00 a 18:00 para la unidad T1-502 (30 personas). Tarifa $ 80.000, que se carga a la cuenta de la unidad. Queda confirmada de inmediato."
    );
    const inserted = callsTo(db, "pending_actions", "insert")[0][0] as { payload: Record<string, unknown> }[];
    expect(inserted[0].payload).toMatchObject({ area_id: "area-1", unit_id: "unit-1", start_at: "2026-10-10T19:00:00.000Z", guests: 30 });

    const busy = await run("proponer_reserva_zona", {
      zona: "Salón social", fecha: "2026-10-10", hora_inicio: "15:00", duracion_minutos: 240, unidad: "T1-502"
    });
    expect(busy).toMatchObject({ success: false, error_code: "AREA_NOT_AVAILABLE" });
  });

  it("si los documentos no tienen evidencia, lo dice en vez de inventar", async () => {
    db = createInsforgeMock({}, { search_document_chunks: { data: [], error: null } });
    const result = await run("buscar_en_documentos", { consulta: "¿Se permiten piscinas inflables en el balcón?" });
    expect(result).toMatchObject({ success: true, data: { encontrado: false } });
    expect(db.database.rpc).toHaveBeenCalledWith("search_document_chunks", expect.objectContaining({ p_visibilities: ["public", "residents"] }));
  });

  it("una persona no verificada solo busca en documentos públicos", async () => {
    db = createInsforgeMock({}, { search_document_chunks: { data: [], error: null } });
    await run("buscar_en_documentos", { consulta: "horario de la piscina" }, toolContext({ identityStatus: "unverified", identity: null }));
    expect(db.database.rpc).toHaveBeenCalledWith("search_document_chunks", expect.objectContaining({ p_visibilities: ["public"] }));
  });

  it("no duplica solicitudes de actualización de datos desde el mismo chat", async () => {
    db = createInsforgeMock({ pqrs_tickets: { data: [{ radicado: "PQRS-2026-00007" }], error: null } });
    const result = await run(
      "solicitar_actualizacion_datos",
      { nombre: "Carlos Ruiz", unidad: "T2-301", detalle: "Soy el nuevo arrendatario" },
      toolContext({ identityStatus: "not_registered", identity: null })
    );
    expect(result).toMatchObject({ success: true, data: { radicado: "PQRS-2026-00007", ya_existia: true } });
    expect(db.database.rpc).not.toHaveBeenCalled();
  });

  it("proponer PQRS exige una categoría existente", async () => {
    db = createInsforgeMock({ pqrs_categories: { data: [{ id: "c1", name: "Mantenimiento" }], error: null } });
    const result = await run("proponer_pqrs", {
      tipo: "queja", categoria: "Parqueaderos", asunto: "Carro mal parqueado", descripcion: "Un carro ocupa mi parqueadero desde ayer."
    });
    expect(result).toMatchObject({ success: false, error_code: "CATEGORY_NOT_FOUND" });
    expect(result.message).toContain("Mantenimiento");
  });
});
