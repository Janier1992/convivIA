import type { UnitType } from "@/types/domain";

/**
 * Mapeo del archivo del censo (XLSX/CSV) al formato que espera el RPC
 * import_units_residents. El frontend solo normaliza encabezados y
 * formatos; la validación definitiva (y la simulación) ocurre en SQL.
 */

export interface CensusRow {
  row_number: number;
  tower?: string;
  unit_code?: string;
  unit_type?: string;
  area_m2?: string;
  coefficient_pct?: string;
  owner_name?: string;
  owner_document_type?: string;
  owner_document_number?: string;
  owner_phone?: string;
  owner_email?: string;
  occupant_name?: string;
  occupant_document_type?: string;
  occupant_document_number?: string;
  occupant_phone?: string;
  occupant_email?: string;
  occupant_relation?: string;
  opening_balance?: string;
  opening_balance_date?: string;
}

type Field = Exclude<keyof CensusRow, "row_number">;

export const TEMPLATE_COLUMNS: { field: Field; header: string; example: string }[] = [
  { field: "tower", header: "Torre", example: "Torre 1" },
  { field: "unit_code", header: "Unidad", example: "T1-502" },
  { field: "unit_type", header: "Tipo", example: "Apartamento" },
  { field: "area_m2", header: "Área m2", example: "72,5" },
  { field: "coefficient_pct", header: "Coeficiente %", example: "0,8523" },
  { field: "owner_name", header: "Propietario", example: "Ana María Pérez" },
  { field: "owner_document_type", header: "Tipo documento propietario", example: "CC" },
  { field: "owner_document_number", header: "Documento propietario", example: "1020304050" },
  { field: "owner_phone", header: "Celular propietario", example: "3001234567" },
  { field: "owner_email", header: "Correo propietario", example: "ana@correo.com" },
  { field: "occupant_name", header: "Ocupante", example: "Carlos Ruiz" },
  { field: "occupant_document_type", header: "Tipo documento ocupante", example: "CC" },
  { field: "occupant_document_number", header: "Documento ocupante", example: "79888777" },
  { field: "occupant_phone", header: "Celular ocupante", example: "3109876543" },
  { field: "occupant_email", header: "Correo ocupante", example: "" },
  { field: "occupant_relation", header: "Relación ocupante", example: "Arrendatario" },
  { field: "opening_balance", header: "Saldo inicial", example: "450000" },
  { field: "opening_balance_date", header: "Fecha saldo inicial", example: "30/09/2026" }
];

function normalizeKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Sinónimos frecuentes en los censos que llevan las administraciones.
const HEADER_ALIASES: Record<string, Field> = {
  torre: "tower", bloque: "tower", interior: "tower",
  unidad: "unit_code", apartamento: "unit_code", apto: "unit_code", casa: "unit_code", inmueble: "unit_code", codigo: "unit_code",
  tipo: "unit_type", "tipo unidad": "unit_type",
  area: "area_m2", "area m2": "area_m2", "area privada": "area_m2",
  coeficiente: "coefficient_pct", "coeficiente %": "coefficient_pct", "coeficiente de copropiedad": "coefficient_pct",
  propietario: "owner_name", "nombre propietario": "owner_name",
  "cedula propietario": "owner_document_number", "celular": "owner_phone", "telefono propietario": "owner_phone",
  "email propietario": "owner_email",
  arrendatario: "occupant_name", residente: "occupant_name", "nombre ocupante": "occupant_name",
  "cedula ocupante": "occupant_document_number", "telefono ocupante": "occupant_phone", "email ocupante": "occupant_email",
  saldo: "opening_balance", "saldo anterior": "opening_balance", "saldo a la fecha": "opening_balance"
};

for (const column of TEMPLATE_COLUMNS) {
  HEADER_ALIASES[normalizeKey(column.header)] = column.field;
}

export function mapHeader(header: string): Field | null {
  return HEADER_ALIASES[normalizeKey(header)] ?? null;
}

const UNIT_TYPES: Record<string, UnitType> = {
  apartamento: "apartment", apto: "apartment", casa: "house", local: "commercial", "local comercial": "commercial",
  oficina: "office", parqueadero: "parking", garaje: "parking", deposito: "storage", "cuarto util": "storage", otro: "other"
};

const RELATIONS: Record<string, string> = {
  arrendatario: "tenant", inquilino: "tenant", residente: "resident", familiar: "resident", autorizado: "authorized"
};

/** "1.234.567,89" / "1234567.89" / "$ 450.000" -> "1234567.89". */
export function normalizeNumber(raw: string): string {
  const cleaned = raw.replace(/[$\s]/g, "");
  if (!cleaned) return "";
  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  if (lastComma > lastDot) return cleaned.replace(/\./g, "").replace(",", ".");
  // Punto como separador de miles (450.000) cuando hay grupos de 3 dígitos.
  if (/^\d{1,3}(\.\d{3})+$/.test(cleaned)) return cleaned.replace(/\./g, "");
  return cleaned.replace(/,/g, "");
}

/** dd/mm/aaaa o aaaa-mm-dd -> aaaa-mm-dd. Deja el valor como vino si no lo reconoce (SQL lo rechaza). */
export function normalizeDate(raw: string): string {
  const value = raw.trim();
  const dmy = value.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  return value.slice(0, 10);
}

function normalizeCell(field: Field, raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  if (raw instanceof Date) return raw.toISOString().slice(0, 10);
  const value = String(raw).trim();
  if (!value) return "";
  switch (field) {
    case "unit_type":
      return UNIT_TYPES[normalizeKey(value)] ?? value;
    case "occupant_relation":
      return RELATIONS[normalizeKey(value)] ?? value;
    case "area_m2":
    case "coefficient_pct":
    case "opening_balance":
      return typeof raw === "number" ? String(raw) : normalizeNumber(value);
    case "opening_balance_date":
      return normalizeDate(value);
    default:
      return value;
  }
}

export interface ParsedCensus {
  rows: CensusRow[];
  unknownHeaders: string[];
  missingRequired: boolean;
}

/** Convierte las filas de la hoja (objetos por encabezado) al formato del RPC. */
export function mapCensusSheet(sheetRows: Record<string, unknown>[]): ParsedCensus {
  const headers = Object.keys(sheetRows[0] ?? {});
  const mapping = new Map<string, Field>();
  const unknownHeaders: string[] = [];
  for (const header of headers) {
    const field = mapHeader(header);
    if (field) mapping.set(header, field);
    else unknownHeaders.push(header);
  }

  const rows: CensusRow[] = [];
  sheetRows.forEach((sheetRow, index) => {
    const row: CensusRow = { row_number: index + 2 };
    let hasData = false;
    for (const [header, field] of mapping) {
      const value = normalizeCell(field, sheetRow[header]);
      if (value) {
        row[field] = value;
        hasData = true;
      }
    }
    if (hasData) rows.push(row);
  });

  return { rows, unknownHeaders, missingRequired: ![...mapping.values()].includes("unit_code") };
}
