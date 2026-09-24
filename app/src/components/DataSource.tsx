import { Database } from "lucide-react";
import { formatDateTime } from "@/lib/format";

/**
 * Regla de veracidad en pantalla: toda cifra muestra de dónde sale y la
 * fecha de corte de los datos.
 */
export function DataSource({ source, asOf }: { source: string; asOf?: string | null }) {
  return (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Database className="h-3.5 w-3.5" aria-hidden />
      <span>
        Fuente: {source}
        {asOf ? ` · corte ${formatDateTime(asOf)}` : ""}
      </span>
    </p>
  );
}
