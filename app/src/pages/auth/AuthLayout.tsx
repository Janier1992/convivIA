import type { ReactNode } from "react";
import { CalendarCheck, MessageCircleHeart, ShieldCheck } from "lucide-react";
import { InstallAppButton } from "@/components/InstallAppButton";
import { ThemeToggle } from "@/components/ThemeToggle";

const HIGHLIGHTS = [
  { icon: MessageCircleHeart, text: "Un asistente por Telegram o WhatsApp que nunca inventa un saldo." },
  { icon: CalendarCheck, text: "PQRS, reservas y portería con radicado y trazabilidad, no en un chat grupal." },
  { icon: ShieldCheck, text: "Cada copropiedad, con sus datos completamente aislados de las demás." }
];

/**
 * Pantalla dividida: panel de marca a la izquierda (oculto en celular) y el
 * formulario a la derecha. Reemplaza la tarjeta genérica centrada heredada
 * del clon de ReservasIA, para que el primer momento con ConvivIA se sienta
 * propio.
 */
export function AuthLayout({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] xl:grid-cols-[minmax(0,7fr)_minmax(0,6fr)]">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br from-primary via-primary to-accent px-12 py-12 text-primary-foreground lg:flex">
        <div
          className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-white/10 blur-3xl"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -bottom-28 left-0 h-72 w-72 rounded-full bg-accent-foreground/10 blur-3xl"
          aria-hidden
        />

        <div className="relative flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/15 text-lg font-bold backdrop-blur-sm">
            C
          </span>
          <span className="text-lg font-semibold tracking-tight">
            Conviv<span className="opacity-80">IA</span>
          </span>
        </div>

        <div className="relative max-w-md space-y-8">
          <p className="text-3xl font-semibold leading-tight tracking-tight">
            El día a día de tu copropiedad, en un solo lugar.
          </p>
          <ul className="space-y-4">
            {HIGHLIGHTS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-start gap-3 text-sm text-primary-foreground/90">
                <span className="mt-0.5 flex h-7 w-7 flex-none items-center justify-center rounded-full bg-white/15">
                  <Icon className="h-3.5 w-3.5" aria-hidden />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-primary-foreground/60">
          Administración de propiedad horizontal · Colombia
        </p>
      </div>

      <div className="relative flex items-center justify-center bg-background px-4 py-10">
        <ThemeToggle className="absolute right-4 top-4" />
        <div className="w-full max-w-sm space-y-6">
          <div className="space-y-1.5 text-center lg:text-left">
            <div className="mb-3 flex items-center justify-center gap-2 lg:hidden">
              <span className="brand-gradient flex h-9 w-9 items-center justify-center rounded-lg text-sm font-bold text-white">
                C
              </span>
              <span className="text-base font-semibold tracking-tight">
                Conviv<span className="text-muted-foreground">IA</span>
              </span>
            </div>
            <h1 className="text-2xl font-semibold">{title}</h1>
            <p className="text-sm text-muted-foreground">{subtitle}</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-6 shadow-sm">{children}</div>
          <div className="flex justify-center">
            <InstallAppButton />
          </div>
        </div>
      </div>
    </div>
  );
}
