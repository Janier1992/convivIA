import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../helpers/db.js";
import { addMember, createOrgWithOwner, createPerson, createUnit, isoDate, linkPerson } from "../helpers/fixtures.js";

describe("portería y visitantes", () => {
  let t: TestDb;
  let orgA: { orgId: string; ownerId: string };
  let orgB: { orgId: string; ownerId: string };
  let unitA: string;
  let unitB: string;
  let porterA: string;
  let councilA: string;

  beforeAll(async () => {
    t = await createTestDb();
    orgA = await createOrgWithOwner(t, "Conjunto Los Robles");
    orgB = await createOrgWithOwner(t, "Conjunto El Bosque");
    unitA = await createUnit(t, orgA.orgId, "T1-501");
    unitB = await createUnit(t, orgB.orgId, "A-201");
    porterA = await addMember(t, orgA.orgId, "assistant");
    councilA = await addMember(t, orgA.orgId, "council");
  });

  afterAll(async () => {
    await t.close();
  });

  function tomorrow(hour: string) {
    return `${isoDate(1)}T${hour}:00-05:00`;
  }

  /** Ventana que incluye el instante actual, para probar el uso inmediato de una autorización. */
  function windowAroundNow(): [string, string] {
    const from = new Date(Date.now() - 60 * 60_000).toISOString();
    const until = new Date(Date.now() + 4 * 60 * 60_000).toISOString();
    return [from, until];
  }

  it("crea una preautorización, registra el ingreso y lo deja como usada", async () => {
    const [validFrom, validUntil] = windowAroundNow();
    const [auth] = await t.as<{ id: string; status: string }>(
      porterA,
      "select * from public.create_visitor_authorization($1, $2, 'Juan Pérez', $3, $4)",
      [orgA.orgId, unitA, validFrom, validUntil]
    );
    expect(auth.status).toBe("pending");

    const [log] = await t.as<{ id: string; unit_id: string; exit_at: string | null }>(
      porterA,
      "select * from public.register_visitor_entry($1, 'Juan Pérez', $2, $3)",
      [orgA.orgId, unitA, auth.id]
    );
    expect(log.unit_id).toBe(unitA);
    expect(log.exit_at).toBeNull();

    const [afterUse] = await t.as<{ status: string }>(porterA, "select status from public.visitor_authorizations where id = $1", [auth.id]);
    expect(afterUse.status).toBe("used");

    const [exited] = await t.as<{ exit_at: string | null }>(porterA, "select * from public.register_visitor_exit($1)", [log.id]);
    expect(exited.exit_at).not.toBeNull();

    await expect(t.as(porterA, "select public.register_visitor_exit($1)", [log.id])).rejects.toThrow(/VALIDATION_ERROR/);
  });

  it("registra un ingreso directo sin autorización (visita sin aviso previo)", async () => {
    const [log] = await t.as<{ id: string; authorization_id: string | null }>(
      porterA,
      "select * from public.register_visitor_entry($1, 'Domiciliario Rappi', $2, null, null, null, null, 'delivery')",
      [orgA.orgId, unitA]
    );
    expect(log.authorization_id).toBeNull();
  });

  it("rechaza una ventana de autorización inválida", async () => {
    await expect(
      t.as(porterA, "select public.create_visitor_authorization($1, $2, 'X', $3, $4)", [orgA.orgId, unitA, tomorrow("18:00"), tomorrow("14:00")])
    ).rejects.toThrow(/VALIDATION_ERROR/);
  });

  it("registra un paquete, avisa al contacto principal y luego lo entrega", async () => {
    const personId = await createPerson(t, orgA.orgId, "María Gómez", "3001234567");
    await linkPerson(t, orgA.orgId, unitA, personId, "owner");
    await t.server("update public.unit_persons set is_primary_contact = true where unit_id = $1 and person_id = $2", [unitA, personId]);

    const [row] = await t.as<{ result: { package: { id: string; status: string }; notified: boolean } }>(
      porterA,
      "select public.register_package($1, $2, 'Servientrega', 'Caja mediana') as result",
      [orgA.orgId, unitA]
    );
    const result = row.result;
    expect(result.package.status).toBe("received");
    // Sin conversación verificada para esa persona, no hay a quién notificar por chat todavía.
    expect(result.notified).toBe(false);

    const [delivered] = await t.as<{ status: string; delivered_to_name: string | null }>(
      porterA,
      "select * from public.deliver_package($1, 'María Gómez')",
      [result.package.id]
    );
    expect(delivered.status).toBe("delivered");
    expect(delivered.delivered_to_name).toBe("María Gómez");

    await expect(t.as(porterA, "select public.deliver_package($1, null)", [result.package.id])).rejects.toThrow(/VALIDATION_ERROR/);
  });

  it("agrega una novedad de portería", async () => {
    const [note] = await t.as<{ category: string }>(
      porterA,
      "select * from public.add_gate_note($1, 'Cámara del parqueadero 2 sin señal', 'maintenance', 'noche')",
      [orgA.orgId]
    );
    expect(note.category).toBe("maintenance");
  });

  it("un rol de solo lectura (council) no puede registrar nada", async () => {
    await expect(
      t.as(councilA, "select public.create_visitor_authorization($1, $2, 'X', $3, $4)", [orgA.orgId, unitA, tomorrow("14:00"), tomorrow("18:00")])
    ).rejects.toThrow(/FORBIDDEN/);
    await expect(t.as(councilA, "select public.add_gate_note($1, 'nota')", [orgA.orgId])).rejects.toThrow(/FORBIDDEN/);
  });

  it("aísla visitantes, paquetes y novedades entre copropiedades", async () => {
    const ownerB = orgB.ownerId;
    const visitors = await t.as(ownerB, "select id from public.visitor_authorizations where organization_id = $1", [orgA.orgId]);
    expect(visitors).toEqual([]);
    const packages = await t.as(ownerB, "select id from public.packages");
    expect(packages).toEqual([]);
    await expect(
      t.as(ownerB, "select public.register_package($1, $2, null, null, null)", [orgA.orgId, unitA])
    ).rejects.toThrow(/FORBIDDEN/);

    // El owner de B sí puede operar sobre SU propia copropiedad.
    const [ownPackage] = await t.as<{ status: string }>(
      ownerB,
      "select (public.register_package($1, $2, null, null, null)->'package'->>'status') as status",
      [orgB.orgId, unitB]
    );
    expect(ownPackage.status).toBe("received");
  });
});
