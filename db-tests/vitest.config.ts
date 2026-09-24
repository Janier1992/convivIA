import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Cada archivo levanta su propio Postgres (PGlite) con todas las
    // migraciones aplicadas; en paralelo consumen mucha memoria.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000
  }
});
