import { insforge } from "@/lib/insforgeClient";
import { env } from "@/lib/env";

export function isPushSupported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window && !!env.VAPID_PUBLIC_KEY;
}

export function getNotificationPermission(): NotificationPermission | "unsupported" {
  if (!("Notification" in window)) return "unsupported";
  return Notification.permission;
}

// El navegador espera la VAPID public key como Uint8Array, no como el
// string base64url que genera `web-push generate-vapid-keys`.
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const output = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) output[i] = rawData.charCodeAt(i);
  return output;
}

function subscriptionToRow(subscription: PushSubscription, organizationId: string, userId: string) {
  const json = subscription.toJSON();
  return {
    organization_id: organizationId,
    user_id: userId,
    endpoint: json.endpoint!,
    p256dh: json.keys!.p256dh,
    auth: json.keys!.auth
  };
}

/**
 * Pide permiso al usuario (si hace falta) y registra la suscripción push
 * para esta organización. Debe llamarse desde un gesto directo del usuario
 * (click de un botón) — los navegadores bloquean `Notification.requestPermission()`
 * si se llama automáticamente al cargar la página.
 */
export async function subscribeToPush(organizationId: string, userId: string): Promise<boolean> {
  if (!isPushSupported()) return false;

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return false;

  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(env.VAPID_PUBLIC_KEY)
    });
  }

  const { error } = await insforge.database
    .from("push_subscriptions")
    .upsert([subscriptionToRow(subscription, organizationId, userId)], { onConflict: "endpoint" });

  return !error;
}

export async function unsubscribeFromPush(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;

  const endpoint = subscription.endpoint;
  await subscription.unsubscribe();
  await insforge.database.from("push_subscriptions").delete().eq("endpoint", endpoint);
}

export async function hasActivePushSubscription(): Promise<boolean> {
  if (!("serviceWorker" in navigator)) return false;
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) return false;
  const subscription = await registration.pushManager.getSubscription();
  return !!subscription;
}
