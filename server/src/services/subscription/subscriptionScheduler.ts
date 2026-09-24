import { createIntervalWorker } from "../../lib/intervalWorker.js";
import { suspendExpiredSubscriptions } from "./subscriptionService.js";

// El vencimiento de una suscripción no es sensible al minuto: una revisión por hora alcanza.
export const subscriptionWorker = createIntervalWorker("subscriptions", 60 * 60 * 1000, async () => {
  await suspendExpiredSubscriptions();
});
