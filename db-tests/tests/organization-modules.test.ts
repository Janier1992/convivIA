import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../helpers/db.js";
import { createOrgWithOwner } from "../helpers/fixtures.js";

const ALL_MODULES = [
  "portfolio", "inbox", "pqrs", "reservations", "porteria", "maintenance", "communications",
  "finance", "units", "residents", "assembly", "documents", "agent", "integrations", "team", "audit", "settings"
];

describe("módulos habilitados por copropiedad (control comercial de soporte)", () => {
  let t: TestDb;
  let orgA: { orgId: string; ownerId: string };
  let supportId: string;

  beforeAll(async () => {
    t = await createTestDb();
    orgA = await createOrgWithOwner(t, "Conjunto Los Robles");
    supportId = await t.createUser();
    await t.server("insert into public.support_staff (user_id) values ($1)", [supportId]);
  });

  afterAll(async () => {
    await t.close();
  });

  it("una copropiedad nueva nace con todos los módulos habilitados", async () => {
    const [row] = await t.as<{ enabled_modules: string[] }>(
      orgA.ownerId,
      "select enabled_modules from public.organizations where id = $1",
      [orgA.orgId]
    );
    expect(new Set(row.enabled_modules)).toEqual(new Set(ALL_MODULES));
  });

  it("soporte puede limitar los módulos a un subconjunto (ej. plan reducido)", async () => {
    const reduced = ["portfolio", "inbox"];
    await t.as(supportId, "update public.organizations set enabled_modules = $2 where id = $1", [orgA.orgId, reduced]);
    const [row] = await t.as<{ enabled_modules: string[] }>(
      orgA.ownerId,
      "select enabled_modules from public.organizations where id = $1",
      [orgA.orgId]
    );
    expect(new Set(row.enabled_modules)).toEqual(new Set(reduced));

    // Restaurado para las siguientes pruebas.
    await t.as(supportId, "update public.organizations set enabled_modules = $2 where id = $1", [orgA.orgId, ALL_MODULES]);
  });

  it("el propio owner de la copropiedad NO puede cambiar sus módulos habilitados", async () => {
    await expect(
      t.as(orgA.ownerId, "update public.organizations set enabled_modules = $2 where id = $1", [orgA.orgId, ["portfolio"]])
    ).rejects.toThrow(/Solo soporte/);

    // Pero sí puede seguir editando lo que sí le corresponde (settings.manage).
    await t.as(orgA.ownerId, "update public.organizations set name = 'Los Robles (renombrado)' where id = $1", [orgA.orgId]);
    const [row] = await t.as<{ name: string; enabled_modules: string[] }>(
      orgA.ownerId,
      "select name, enabled_modules from public.organizations where id = $1",
      [orgA.orgId]
    );
    expect(row.name).toBe("Los Robles (renombrado)");
    expect(new Set(row.enabled_modules)).toEqual(new Set(ALL_MODULES));
  });

  it("rechaza una clave de módulo inexistente", async () => {
    await expect(
      t.as(supportId, "update public.organizations set enabled_modules = $2 where id = $1", [orgA.orgId, ["portfolio", "modulo_inventado"]])
    ).rejects.toThrow();
  });
});
