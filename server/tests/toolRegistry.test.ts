import { describe, expect, it } from "vitest";
import { executeTool, getAvailableTools } from "../src/services/agent/toolRegistry.js";
import { resolveOwnUnit } from "../src/services/agent/unitResolver.js";
import { AGENT, RESIDENT, toolContext } from "./helpers/fixtures.js";

const PRIVATE_TOOLS = [
  "consultar_estado_cuenta",
  "proponer_reporte_pago",
  "proponer_pqrs",
  "consultar_mis_pqrs",
  "consultar_disponibilidad_zona",
  "proponer_reserva_zona",
  "consultar_mis_reservas",
  "proponer_cancelacion_reserva",
  "consultar_comunicados",
  "confirmar_accion",
  "descartar_accion"
];

function names(ctx = toolContext()) {
  return getAvailableTools(ctx).map((t) => t.name);
}

describe("exposición de herramientas", () => {
  it("una persona no verificada solo ve herramientas públicas", () => {
    const available = names(toolContext({ identityStatus: "unverified", identity: null }));
    for (const tool of PRIVATE_TOOLS) expect(available).not.toContain(tool);
    expect(available).toEqual(
      expect.arrayContaining(["obtener_info_copropiedad", "buscar_en_documentos", "solicitar_verificacion", "escalar_a_humano"])
    );
  });

  it("un residente verificado ve las privadas, pero ya no la de verificarse", () => {
    const available = names();
    for (const tool of PRIVATE_TOOLS) expect(available).toContain(tool);
    expect(available).not.toContain("solicitar_verificacion");
    expect(available).not.toContain("solicitar_actualizacion_datos");
  });

  it("verificado pero sin unidades activas se trata como no verificado", () => {
    const available = names(toolContext({ identity: { ...RESIDENT, units: [] } }));
    expect(available).not.toContain("consultar_estado_cuenta");
  });

  it("apagar una capacidad elimina sus herramientas", () => {
    const available = names(toolContext({ agent: { ...AGENT, finance_enabled: false, reservations_enabled: false } }));
    expect(available).not.toContain("consultar_estado_cuenta");
    expect(available).not.toContain("proponer_reserva_zona");
    expect(available).toContain("proponer_reporte_pago");
  });

  it("sin zonas comunes configuradas no se ofrecen reservas", () => {
    expect(names(toolContext({ areas: [] }))).not.toContain("proponer_reserva_zona");
  });

  it("rechaza una herramienta que no se le ofreció al modelo", async () => {
    const ctx = toolContext({ identityStatus: "unverified", identity: null });
    const result = await executeTool("consultar_estado_cuenta", {}, ctx, getAvailableTools(ctx));
    expect(result).toMatchObject({ success: false, error_code: "TOOL_NOT_AVAILABLE" });
  });

  it("valida argumentos con un mensaje útil para el modelo", async () => {
    const ctx = toolContext();
    const result = await executeTool("proponer_reserva_zona", { zona: "Salón", fecha: "mañana" }, ctx, getAvailableTools(ctx));
    expect(result.success).toBe(false);
    expect(result.error_code).toBe("VALIDATION_ERROR");
    expect(result.message).toMatch(/fecha/);
  });
});

describe("resolución autorizada de unidades", () => {
  it("usa la única unidad con acceso financiero si no se indica", () => {
    expect(resolveOwnUnit(RESIDENT, undefined, "finance").code).toBe("T1-502");
  });

  it("acepta el código sin importar mayúsculas", () => {
    expect(resolveOwnUnit(RESIDENT, "t1-502", "finance").unit_id).toBe("unit-1");
  });

  it("niega la cartera de una unidad donde solo es residente", () => {
    expect(() => resolveOwnUnit(RESIDENT, "P-12", "finance")).toThrow(/propietario o el arrendatario/);
  });

  it("nunca autoriza una unidad ajena aunque el modelo la repita", () => {
    expect(() => resolveOwnUnit(RESIDENT, "T9-901", "any")).toThrow(/no está entre las unidades verificadas/);
  });

  it("pide aclarar cuando hay varias unidades válidas", () => {
    expect(() => resolveOwnUnit(RESIDENT, undefined, "booking")).toThrow(/varias unidades/);
  });
});
