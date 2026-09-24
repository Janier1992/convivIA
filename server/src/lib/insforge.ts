import { createAdminClient } from "@insforge/sdk";
import { env } from "../config/env.js";

/**
 * Cliente project_admin: bypassa RLS y privilegios de columna (equivalente
 * a la service role key de otras plataformas). Sólo debe usarse en este
 * compute service, nunca exponerse al frontend. El frontend nunca llama a
 * este servicio directamente (InsForge no permite adjuntar el token del
 * usuario a un origen externo); las operaciones que el frontend dispara
 * viven en Edge Functions (ver /functions). Este servicio sólo responde a
 * Twilio y a la redirección de Google OAuth.
 */
export const insforgeAdmin = createAdminClient({
  baseUrl: env.INSFORGE_URL,
  apiKey: env.INSFORGE_API_KEY
});
