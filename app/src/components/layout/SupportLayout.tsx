import { Outlet } from "react-router-dom";
import { LifeBuoy, LogOut } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ErrorBoundary } from "@/components/ErrorBoundary";

/**
 * Layout liviano para /soporte: nada de selector de copropiedad ni nav
 * de administración (DashboardLayout está pensado para una copropiedad
 * actual, esto es cross-tenant). Una cuenta de soporte pura no administra
 * ninguna copropiedad, así que no puede reusar el layout normal.
 */
export function SupportLayout() {
  const { user, signOut } = useAuth();

  return (
    <div className="min-h-dvh bg-background">
      <header className="flex h-14 items-center gap-3 border-b border-border bg-card px-4 sm:px-6">
        <div className="brand-gradient flex h-8 w-8 items-center justify-center rounded-lg text-white">
          <LifeBuoy className="h-4 w-4" />
        </div>
        <span className="font-semibold">ConvivIA — Soporte</span>
        <span className="ml-auto truncate text-xs text-muted-foreground">{user?.email}</span>
        <ThemeToggle />
        <button
          onClick={() => signOut()}
          className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-foreground/80 hover:bg-muted"
        >
          <LogOut className="h-4 w-4" /> Salir
        </button>
      </header>

      <main className="mx-auto max-w-6xl p-4 sm:p-6">
        <ErrorBoundary title="No se pudo cargar esta sección.">
          <Outlet />
        </ErrorBoundary>
      </main>
    </div>
  );
}
