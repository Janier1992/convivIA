import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
  /** Texto mostrado como título del fallback. Por defecto genérico. */
  title?: string;
}

interface State {
  error: Error | null;
}

/**
 * Contiene errores de render dentro de la sección que envuelve, en vez de
 * dejar que tumben toda la SPA (pantalla blanca). Por ejemplo, envolviendo el
 * <Outlet/> del dashboard: si una página específica revienta, el resto del
 * layout (sidebar, navegación) sigue funcionando y el usuario puede navegar
 * a otra sección en vez de quedar totalmente bloqueado.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Error de render capturado por ErrorBoundary:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 rounded-lg border border-border bg-card p-8 text-center">
          <AlertTriangle className="h-8 w-8 text-destructive" />
          <div>
            <p className="font-medium">{this.props.title ?? "Algo salió mal en esta pantalla."}</p>
            <p className="text-sm text-muted-foreground">Probá recargar; si el problema persiste, avisale al soporte.</p>
          </div>
          <Button variant="outline" onClick={() => this.setState({ error: null })}>
            Reintentar
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}
