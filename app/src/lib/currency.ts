export interface CurrencyOption {
  code: string;
  label: string;
}

// COP primero: la plataforma nació para copropiedades colombianas
// (property_profiles.currency es texto libre por si alguna vez opera fuera de Colombia).
export const CURRENCY_OPTIONS: CurrencyOption[] = [
  { code: "COP", label: "Peso colombiano (COP)" },
  { code: "USD", label: "Dólar estadounidense (USD)" },
  { code: "MXN", label: "Peso mexicano (MXN)" }
];

export const DEFAULT_CURRENCY = "COP";
