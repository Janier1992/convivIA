import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function isStandaloneDisplay(): boolean {
  if (window.matchMedia("(display-mode: standalone)").matches) return true;
  // iOS Safari no soporta display-mode: standalone como media query; expone su propio flag.
  return Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone);
}

function detectIos(): boolean {
  const ua = window.navigator.userAgent;
  return /iphone|ipad|ipod/i.test(ua) || (ua.includes("Macintosh") && "ontouchend" in document);
}

function detectAndroid(): boolean {
  return /android/i.test(window.navigator.userAgent);
}

interface InstallPromptContextValue {
  installed: boolean;
  canPrompt: boolean;
  isIos: boolean;
  isAndroid: boolean;
  promptInstall: () => Promise<void>;
}

const InstallPromptContext = createContext<InstallPromptContextValue | null>(null);

/**
 * El navegador dispara `beforeinstallprompt` UNA SOLA VEZ por carga de
 * página, en el momento que él decide (no nosotros). Si nadie está
 * escuchando en ESE instante, el evento se pierde para siempre — no vuelve
 * a dispararse aunque el usuario navegue a otra pantalla dentro de la SPA.
 *
 * Por eso este listener se registra acá, envolviendo TODA la app en
 * App.tsx (se monta una única vez y nunca se desmonta durante la sesión),
 * en vez de adentro de cada layout (Auth/Dashboard) que se monta y
 * desmonta con cada navegación. Así, sin importar en qué pantalla esté el
 * usuario cuando el navegador decide ofrecer la instalación, el evento
 * queda capturado acá y disponible para cualquier botón de la app.
 */
export function InstallPromptProvider({ children }: { children: ReactNode }) {
  const [deferredEvent, setDeferredEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(isStandaloneDisplay());

  useEffect(() => {
    function onBeforeInstallPrompt(e: Event) {
      e.preventDefault();
      setDeferredEvent(e as BeforeInstallPromptEvent);
    }
    function onInstalled() {
      setInstalled(true);
      setDeferredEvent(null);
    }
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  async function promptInstall() {
    if (!deferredEvent) return;
    await deferredEvent.prompt();
    const choice = await deferredEvent.userChoice;
    if (choice.outcome === "accepted") setInstalled(true);
    setDeferredEvent(null);
  }

  const value: InstallPromptContextValue = {
    installed,
    canPrompt: !!deferredEvent,
    isIos: detectIos(),
    isAndroid: detectAndroid(),
    promptInstall
  };

  return <InstallPromptContext.Provider value={value}>{children}</InstallPromptContext.Provider>;
}

export function useInstallPrompt(): InstallPromptContextValue {
  const ctx = useContext(InstallPromptContext);
  if (!ctx) throw new Error("useInstallPrompt debe usarse dentro de <InstallPromptProvider>");
  return ctx;
}
