import { describe, expect, it } from "vitest";
import { mapCensusSheet, mapHeader, normalizeDate, normalizeNumber } from "../src/lib/censusImport";

describe("importación del censo", () => {
  it("reconoce encabezados con o sin tildes y sinónimos frecuentes", () => {
    expect(mapHeader("Coeficiente %")).toBe("coefficient_pct");
    expect(mapHeader("ÁREA m2")).toBe("area_m2");
    expect(mapHeader("Apto")).toBe("unit_code");
    expect(mapHeader("Cédula propietario")).toBe("owner_document_number");
    expect(mapHeader("Color favorito")).toBeNull();
  });

  it("normaliza números en formato colombiano", () => {
    expect(normalizeNumber("$ 450.000")).toBe("450000");
    expect(normalizeNumber("1.234.567,89")).toBe("1234567.89");
    expect(normalizeNumber("0,8523")).toBe("0.8523");
    expect(normalizeNumber("72.5")).toBe("72.5");
  });

  it("normaliza fechas dd/mm/aaaa", () => {
    expect(normalizeDate("5/9/2026")).toBe("2026-09-05");
    expect(normalizeDate("2026-09-30")).toBe("2026-09-30");
  });

  it("mapea filas, traduce tipos y relaciones, y omite filas vacías", () => {
    const parsed = mapCensusSheet([
      { Torre: "Torre 1", Unidad: "T1-502", Tipo: "Apartamento", "Coeficiente %": "0,85", Propietario: "Ana", "Relación ocupante": "Arrendatario", Extra: "x" },
      { Torre: "", Unidad: "", Tipo: "" },
      { Torre: "Torre 1", Unidad: "P-12", Tipo: "Garaje", "Coeficiente %": 0.1 }
    ]);
    expect(parsed.missingRequired).toBe(false);
    expect(parsed.unknownHeaders).toEqual(["Extra"]);
    expect(parsed.rows).toEqual([
      { row_number: 2, tower: "Torre 1", unit_code: "T1-502", unit_type: "apartment", coefficient_pct: "0.85", owner_name: "Ana", occupant_relation: "tenant" },
      { row_number: 4, tower: "Torre 1", unit_code: "P-12", unit_type: "parking", coefficient_pct: "0.1" }
    ]);
  });

  it("avisa si falta la columna de unidad", () => {
    expect(mapCensusSheet([{ Propietario: "Ana" }]).missingRequired).toBe(true);
  });
});
