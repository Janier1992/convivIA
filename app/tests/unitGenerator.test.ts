import { describe, expect, it } from "vitest";
import { generateUnits, MAX_GENERATED_UNITS } from "../src/lib/unitGenerator";

describe("generateUnits", () => {
  it("usa la convención piso + número con prefijo de torre", () => {
    const units = generateUnits({ prefix: "t1", floorFrom: 1, floorTo: 2, unitsPerFloor: 3, unitType: "apartment" });
    expect(units.map((u) => u.code)).toEqual(["T1-101", "T1-102", "T1-103", "T1-201", "T1-202", "T1-203"]);
    expect(units[4]).toMatchObject({ floor: "2", unit_type: "apartment" });
  });

  it("soporta pisos de dos dígitos y códigos sin prefijo", () => {
    const units = generateUnits({ prefix: "", floorFrom: 12, floorTo: 12, unitsPerFloor: 4, unitType: "apartment" });
    expect(units.map((u) => u.code)).toEqual(["1201", "1202", "1203", "1204"]);
  });

  it("rechaza rangos inválidos o demasiado grandes", () => {
    expect(generateUnits({ prefix: "A", floorFrom: 5, floorTo: 2, unitsPerFloor: 2, unitType: "apartment" })).toEqual([]);
    expect(generateUnits({ prefix: "A", floorFrom: 1, floorTo: MAX_GENERATED_UNITS, unitsPerFloor: 2, unitType: "apartment" })).toEqual([]);
  });
});
