#!/usr/bin/env node
// Guarda de seguridad: este repositorio nació como clon de ReservasIA y el
// archivo local .insforge/project.json puede seguir apuntando al backend de
// producción de ReservasIA. Aplicar las migraciones de ConvivIA ahí (o
// desplegar sus Edge Functions) mezclaría dos productos en una misma base
// de datos. Se ejecuta antes de `npm run insforge:migrate` y
// `npm run insforge:functions:deploy`.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BLOCKED_PROJECTS = [
  { id: "b0cc20a4-3fcf-4149-a01e-07300491300d", name: "crm-clients-wpp", reason: "backend de producción de ReservasIA" }
];

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const projectFile = path.join(rootDir, ".insforge", "project.json");

if (!existsSync(projectFile)) {
  console.error("✖ No hay un proyecto de InsForge vinculado. Crea uno nuevo para ConvivIA:");
  console.error("    npx -y @insforge/cli create");
  process.exit(1);
}

let project;
try {
  project = JSON.parse(readFileSync(projectFile, "utf8"));
} catch {
  console.error("✖ .insforge/project.json no es un JSON válido.");
  process.exit(1);
}

const blocked = BLOCKED_PROJECTS.find((p) => p.id === project.project_id || p.name === project.project_name);
if (blocked) {
  console.error(`✖ El proyecto vinculado es "${blocked.name}" (${blocked.reason}).`);
  console.error("  ConvivIA necesita su propio backend. Crea o vincula otro proyecto:");
  console.error("    npx -y @insforge/cli create     # proyecto nuevo");
  console.error("    npx -y @insforge/cli link       # proyecto existente de ConvivIA");
  process.exit(1);
}

console.log(`✔ Proyecto de InsForge: ${project.project_name ?? project.project_id}`);
