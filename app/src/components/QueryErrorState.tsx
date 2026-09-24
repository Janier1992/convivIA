import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Reemplaza el patrón repetido de "la consulta falló, pero como el default
 * de `data` es `[]` la pantalla igual renderiza una tabla vacía" — sin esto,
 * un corte de red se ve idéntico a "no hay datos todavía", y el usuario no
 * tiene forma de saber que tiene que reintentar.
 */
export function QueryErrorState({ onRetry, message }: { onRetry: () => void; message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-8 text-center">
      <AlertTriangle className="h-6 w-6 text-destructive" />
      <div>
        <p className="text-sm font-medium">{message ?? "No se pudo cargar la información."}</p>
        <p className="text-xs text-muted-foreground">Revisá tu conexión e intentá de nuevo.</p>
      </div>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Reintentar
      </Button>
    </div>
  );
}
