/// <reference lib="webworker" />
import { precacheAndRoute } from "workbox-precaching";

declare const self: ServiceWorkerGlobalScope;

// Precachea el shell de la app (HTML/JS/CSS/íconos) — vite-plugin-pwa
// inyecta la lista real de archivos en el build. Los datos de la
// copropiedad (cartera, PQRS, conversaciones) nunca pasan por este cache:
// siempre van a InsForge por red.
precacheAndRoute(self.__WB_MANIFEST);

self.skipWaiting();
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

/**
 * Server → Push service (FCM/Mozilla/etc.) → este listener. Es lo que hace
 * que llegue una notificación real (con sonido) al celular aunque la PWA
 * esté cerrada — no alcanza con pedir permiso desde la app, es este
 * listener el que efectivamente la muestra.
 */
self.addEventListener("push", (event) => {
  let payload: PushPayload = { title: "ConvivIA", body: "Tienes una novedad en tu copropiedad." };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch {
    // Si el payload no es JSON válido, se usa el mensaje genérico de arriba.
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: payload.tag,
      data: { url: payload.url ?? "/dashboard" }
    })
  );
});

/**
 * Al tocar la notificación: si ya hay una pestaña de la app abierta, la
 * enfoca en vez de abrir una nueva (evita acumular pestañas duplicadas).
 */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data?.url as string) ?? "/dashboard";

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const existing = allClients.find((c) => c.url.includes(targetUrl)) ?? allClients[0];
      if (existing) {
        await existing.focus();
        if ("navigate" in existing) await (existing as WindowClient).navigate(targetUrl);
      } else {
        await self.clients.openWindow(targetUrl);
      }
    })()
  );
});
