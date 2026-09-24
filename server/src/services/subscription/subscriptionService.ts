import { insforgeAdmin } from "../../lib/insforge.js";
import { logger } from "../../lib/logger.js";

/**
 * Suspende automáticamente las copropiedades cuya suscripción venció. Nunca
 * toca una fila con subscription_expires_at en NULL (todavía no se le
 * puso fecha de vencimiento — no hay que sorprender a nadie suspendiendo
 * copropiedades que nunca entraron a este esquema de cobro).
 */
export async function suspendExpiredSubscriptions(): Promise<{ suspended: number }> {
  const { data, error } = await insforgeAdmin.database
    .from("organizations")
    .update({ status: "suspended" })
    .eq("status", "active")
    .not("subscription_expires_at", "is", null)
    .lt("subscription_expires_at", new Date().toISOString())
    .select("id");

  if (error) {
    logger.warn({ err: error }, "subscription_expiry_check_failed");
    return { suspended: 0 };
  }

  const suspended = data?.length ?? 0;
  if (suspended > 0) {
    logger.info({ suspended, organizationIds: data!.map((o) => o.id) }, "subscriptions_auto_suspended");
  }
  return { suspended };
}
