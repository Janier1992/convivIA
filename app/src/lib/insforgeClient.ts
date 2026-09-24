import { createClient } from "@insforge/sdk";
import { env } from "./env";

export const insforge = createClient({
  baseUrl: env.INSFORGE_URL,
  anonKey: env.INSFORGE_ANON_KEY
});
