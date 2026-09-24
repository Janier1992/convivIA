#!/usr/bin/env node
// Despliega todas las Edge Functions de functions/ a InsForge en un solo comando.
// Uso: npm run insforge:functions:deploy (valida antes que el proyecto vinculado no sea el de ReservasIA)
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const functionsDir = path.join(rootDir, "functions");

// Cada archivo .ts de functions/ es una función; los .d.ts son solo para el typecheck local.
const files = readdirSync(functionsDir).filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts"));

if (files.length === 0) {
  console.log("No hay funciones en functions/.");
  process.exit(0);
}

let hadError = false;

for (const file of files) {
  const slug = file.replace(/\.ts$/, "");
  const filePath = path.join("functions", file);
  console.log(`\nDesplegando ${slug}...`);
  const result = spawnSync("npx", ["-y", "@insforge/cli", "functions", "deploy", slug, "--file", filePath], {
    stdio: "inherit",
    shell: true,
    cwd: rootDir
  });
  if (result.status !== 0) hadError = true;
}

process.exit(hadError ? 1 : 0);
