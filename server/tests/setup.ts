// Valores dummy para que config/env.ts no falle al importarse en tests que
// no necesitan credenciales reales (mockean supabase/openai directamente).
process.env.INSFORGE_URL ??= "http://localhost:54321";
process.env.INSFORGE_API_KEY ??= "test-api-key";
process.env.OPENAI_API_KEY ??= "test-openai-key";
process.env.TWILIO_VALIDATE_SIGNATURE ??= "true";
