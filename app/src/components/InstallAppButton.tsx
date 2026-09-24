import { useState } from "react";
import { Download, Share, SquarePlus, Menu as MenuIcon } from "lucide-react";
import { useInstallPrompt } from "@/hooks/useInstallPrompt";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * Botón de instalación propio de la app. Cuando el navegador dispara
 * `beforeinstallprompt` (Chrome/Android, a veces también desktop) lo usamos
 * para abrir el diálogo nativo directamente. Pero ese evento NO es
 * confiable: Chrome lo condiciona a heurísticas internas de "engagement"
 * (visitas previas, tiempo en el sitio) y puede no dispararse nunca en una
 * sesión — y en iOS Safari no existe ninguna API equivalente. Por eso el
 * botón nunca desaparece por falta de evento: si no hay uno disponible,
 * muestra instrucciones manuales según la plataforma detectada. Sólo se
 * oculta cuando la app ya está instalada (modo standalone).
 */
export function InstallAppButton({ className }: { className?: string }) {
  const { installed, canPrompt, isIos, isAndroid, promptInstall } = useInstallPrompt();
  const [instructionsOpen, setInstructionsOpen] = useState(false);

  if (installed) return null;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={className}
        onClick={canPrompt ? promptInstall : () => setInstructionsOpen(true)}
      >
        <Download className="h-4 w-4" /> Instalar app
      </Button>

      <Dialog open={instructionsOpen} onOpenChange={setInstructionsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Instalar ConvivIA</DialogTitle>
          </DialogHeader>
          {isIos ? (
            <div className="space-y-3 text-sm">
              <p className="text-muted-foreground">
                Safari no tiene un botón de instalar — hay que agregarla a la pantalla de inicio manualmente, son 2
                pasos:
              </p>
              <div className="flex items-center gap-3 rounded-md border border-border p-3">
                <Share className="h-5 w-5 shrink-0 text-primary" />
                <p>
                  1. Tocá el ícono de <strong>Compartir</strong> en la barra de Safari (el cuadrado con la flecha
                  hacia arriba).
                </p>
              </div>
              <div className="flex items-center gap-3 rounded-md border border-border p-3">
                <SquarePlus className="h-5 w-5 shrink-0 text-primary" />
                <p>
                  2. Elegí <strong>"Agregar a pantalla de inicio"</strong>.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-3 text-sm">
              <p className="text-muted-foreground">
                {isAndroid
                  ? "Tu navegador todavía no ofreció instalar automáticamente. Podés hacerlo manual, son 2 pasos:"
                  : "Instalala manualmente desde el menú del navegador, son 2 pasos:"}
              </p>
              <div className="flex items-center gap-3 rounded-md border border-border p-3">
                <MenuIcon className="h-5 w-5 shrink-0 text-primary" />
                <p>
                  1. Abrí el menú del navegador (los <strong>tres puntos</strong> ⋮, generalmente arriba a la
                  derecha).
                </p>
              </div>
              <div className="flex items-center gap-3 rounded-md border border-border p-3">
                <SquarePlus className="h-5 w-5 shrink-0 text-primary" />
                <p>
                  2. Elegí <strong>"Instalar app"</strong> o <strong>"Agregar a pantalla de inicio"</strong>.
                </p>
              </div>
              <p className="text-xs text-muted-foreground">
                Si no ves esa opción, confirmá que estás abriendo el link directamente en Chrome (no desde dentro de
                WhatsApp, Telegram u otra app) — el navegador integrado de esas apps no permite instalar.
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
