import webpush from "web-push";
import { env } from "../../config/env.js";
import { insforgeAdmin } from "../../lib/insforge.js";
import { logger } from "../../lib/logger.js";

const vapidConfigured = Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);

if (vapidConfigured) {
  webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
}

interface PushSubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
}

async function loadSubscriptions(organizationId: string): Promise<PushSubscriptionRow[]> {
  const { data, error } = await insforgeAdmin.database
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("organization_id", organizationId);
  if (error) {
    logger.warn({ organizationId, err: error }, "push_load_subscriptions_failed");
    return [];
  }
  return (data ?? []) as PushSubscriptionRow[];
}

async function sendToSubscription(sub: PushSubscriptionRow, payload: string): Promise<boolean> {
  try {
    await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload);
    return true;
  } catch (err: unknown) {
    const { statusCode, body } = err as { statusCode?: number; body?: string };
    // 404/410: el navegador invalidó la suscripción; se limpia.
    if (statusCode === 404 || statusCode === 410) {
      await insforgeAdmin.database.from("push_subscriptions").delete().eq("id", sub.id);
      return false;
    }
    logger.warn({ subscriptionId: sub.id, statusCode, body }, "push_send_failed");
    return false;
  }
}

/**
 * Aviso al equipo de la administración en sus dispositivos. Best-effort:
 * nunca bloquea ni hace fallar el flujo que lo dispara.
 */
export async function notifyOrganization(organizationId: string, payload: PushPayload): Promise<void> {
  if (!vapidConfigured) return;
  const subscriptions = await loadSubscriptions(organizationId);
  if (subscriptions.length === 0) return;
  const serialized = JSON.stringify(payload);
  const results = await Promise.all(subscriptions.map((sub) => sendToSubscription(sub, serialized)));
  logger.info({ organizationId, sent: results.filter(Boolean).length, total: subscriptions.length }, "push_notify_done");
}
