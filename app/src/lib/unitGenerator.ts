import type { UnitType } from "@/types/domain";

export interface UnitGeneratorInput {
  /** Prefijo del código, p. ej. "T1" -> "T1-101". Vacío -> "101". */
  prefix: string;
  floorFrom: number;
  floorTo: number;
  unitsPerFloor: number;
  unitType: UnitType;
}

export interface GeneratedUnit {
  code: string;
  floor: string;
  unit_type: UnitType;
}

export const MAX_GENERATED_UNITS = 2000;

/**
 * Genera códigos de unidad con la convención colombiana piso + número
 * (piso 5, apto 2 -> 502; piso 12, apto 4 -> 1204). Evita digitar cientos
 * de unidades a mano.
 */
export function generateUnits(input: UnitGeneratorInput): GeneratedUnit[] {
  const { floorFrom, floorTo, unitsPerFloor } = input;
  if (!Number.isInteger(floorFrom) || !Number.isInteger(floorTo) || !Number.isInteger(unitsPerFloor)) return [];
  if (floorFrom < 0 || floorTo < floorFrom || unitsPerFloor < 1) return [];
  if ((floorTo - floorFrom + 1) * unitsPerFloor > MAX_GENERATED_UNITS) return [];

  const prefix = input.prefix.trim().toUpperCase();
  const numberWidth = unitsPerFloor >= 100 ? 3 : 2;
  const units: GeneratedUnit[] = [];
  for (let floor = floorFrom; floor <= floorTo; floor++) {
    for (let n = 1; n <= unitsPerFloor; n++) {
      const number = `${floor}${String(n).padStart(numberWidth, "0")}`;
      units.push({ code: prefix ? `${prefix}-${number}` : number, floor: String(floor), unit_type: input.unitType });
    }
  }
  return units;
}
