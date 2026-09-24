import { useState } from "react";
import { formatMoney, formatNumber } from "@/lib/format";
import type { PortfolioRow } from "@/types/domain";

const BUCKETS: { key: keyof Pick<PortfolioRow, "not_due" | "d1_30" | "d31_60" | "d61_90" | "d90_plus">; label: string }[] = [
  { key: "not_due", label: "Por vencer" },
  { key: "d1_30", label: "1 a 30 días" },
  { key: "d31_60", label: "31 a 60 días" },
  { key: "d61_90", label: "61 a 90 días" },
  { key: "d90_plus", label: "Más de 90 días" }
];

/**
 * Cartera por edades: barras horizontales de una sola serie con rampa
 * ordinal de un tono (más antigua = más contraste). Etiqueta directa en
 * cada barra, tooltip por barra con el número de unidades y la tabla de
 * cartera debajo como vista tabular.
 */
export function AgingChart({ rows }: { rows: PortfolioRow[] }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const data = BUCKETS.map((bucket) => ({
    ...bucket,
    total: rows.reduce((sum, r) => sum + Number(r[bucket.key]), 0),
    units: rows.filter((r) => Number(r[bucket.key]) > 0).length
  }));
  const max = Math.max(...data.map((d) => d.total), 1);

  return (
    <figure className="space-y-2" aria-label="Cartera por edades">
      {data.map((bucket, index) => {
        const width = bucket.total > 0 ? Math.max((bucket.total / max) * 100, 1.5) : 0;
        return (
          <div
            key={bucket.key}
            className="group relative grid grid-cols-[7.5rem_1fr] items-center gap-3 rounded-md py-1 outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            tabIndex={0}
            onMouseEnter={() => setHovered(index)}
            onMouseLeave={() => setHovered(null)}
            onFocus={() => setHovered(index)}
            onBlur={() => setHovered(null)}
          >
            <span className="text-xs text-muted-foreground">{bucket.label}</span>
            <div className="flex items-center gap-2">
              <div className="h-3.5 flex-1">
                <div
                  className="h-full rounded-r transition-[width] duration-300"
                  style={{ width: `${width}%`, backgroundColor: `var(--aging-${index})` }}
                />
              </div>
              <span className="w-28 shrink-0 text-right text-xs font-semibold tabular-nums">{formatMoney(bucket.total)}</span>
            </div>
            {hovered === index && (
              <div role="tooltip" className="absolute right-0 top-full z-10 mt-1 rounded-md border border-border bg-card px-3 py-2 text-xs shadow-lg">
                <p className="font-semibold">{bucket.label}</p>
                <p className="text-muted-foreground">
                  {formatMoney(bucket.total)} · {formatNumber(bucket.units)} {bucket.units === 1 ? "unidad" : "unidades"}
                </p>
              </div>
            )}
          </div>
        );
      })}
    </figure>
  );
}
