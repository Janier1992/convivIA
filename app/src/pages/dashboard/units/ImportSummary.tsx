import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { formatMoney } from "@/lib/format";

export interface ImportResult {
  dry_run: boolean;
  applied: boolean;
  batch_id: string | null;
  counts: Record<string, number>;
  error_count: number;
  errors: { row: number; message: string }[];
  warnings: { row: number; message: string }[];
  changes: { row: number; unit_code: string; field: string; from: unknown; to: unknown }[];
}

const COUNT_LABELS: [string, string][] = [
  ["units_created", "Unidades nuevas"],
  ["units_updated", "Unidades con cambios"],
  ["towers_created", "Torres nuevas"],
  ["persons_created", "Personas nuevas"],
  ["relations_created", "Relaciones persona-unidad"],
  ["opening_balances", "Saldos iniciales"]
];

function Issues({ icon: Icon, tone, title, items }: {
  icon: typeof XCircle;
  tone: string;
  title: string;
  items: { row: number; message: string }[];
}) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <p className={`flex items-center gap-1.5 text-sm font-semibold ${tone}`}>
        <Icon className="h-4 w-4" aria-hidden /> {title} ({items.length})
      </p>
      <ul className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-border p-2 text-xs">
        {items.map((item, i) => (
          <li key={`${item.row}-${i}`}>
            <span className="font-medium">Fila {item.row}:</span> {item.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Resultado de la simulación o de la importación: qué pasará exactamente, antes de confirmar. */
export function ImportSummary({ result }: { result: ImportResult }) {
  const changes = result.changes.map((c) => ({
    row: c.row,
    message: `${c.unit_code}: ${c.field} ${c.from ?? "—"} → ${c.to ?? "—"}`
  }));
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {COUNT_LABELS.map(([key, label]) => (
          <div key={key} className="rounded-md border border-border p-2.5">
            <p className="text-lg font-bold">{result.counts[key] ?? 0}</p>
            <p className="text-xs text-muted-foreground">{label}</p>
          </div>
        ))}
      </div>
      {Number(result.counts.opening_total) > 0 && (
        <p className="text-sm">
          Total de saldos iniciales: <span className="font-semibold">{formatMoney(result.counts.opening_total)}</span>
        </p>
      )}
      {result.error_count === 0 ? (
        <p className="flex items-center gap-1.5 text-sm font-medium text-success">
          <CheckCircle2 className="h-4 w-4" aria-hidden /> Sin errores: el archivo se puede importar.
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          Corrige los errores en el archivo y vuelve a cargarlo. No se importa nada mientras haya errores.
        </p>
      )}
      <Issues icon={XCircle} tone="text-destructive" title="Errores" items={result.errors} />
      <Issues icon={Info} tone="text-primary" title="Cambios sobre unidades existentes" items={changes} />
      <Issues icon={AlertTriangle} tone="text-warning" title="Avisos (datos existentes que no se sobrescriben)" items={result.warnings} />
    </div>
  );
}
