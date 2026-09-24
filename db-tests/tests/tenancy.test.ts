import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../helpers/db.js";
import { addMember, createOrgWithOwner, createPerson, createUnit } from "../helpers/fixtures.js";

describe("multi-tenant y RBAC", () => {
  let t: TestDb;
  let orgA: { orgId: string; ownerId: string };
  let orgB: { orgId: string; ownerId: string };

  beforeAll(async () => {
    t = await createTestDb();
    orgA = await createOrgWithOwner(t, "Conjunto A");
    orgB = await createOrgWithOwner(t, "Conjunto B");
    await createPerson(t, orgA.orgId, "Ana Pérez", "3001112233");
    await createPerson(t, orgB.orgId, "Beto Gómez", "3004445566");
  });

  afterAll(async () => {
    await t.close();
  });

  it("el alta crea perfil, asistente, conceptos del sistema y categorías de PQRS", async () => {
    const [counts] = await t.server<Record<string, number>>(
      `select
        (select count(*)::int from public.property_profiles where organization_id = $1) as profiles,
        (select count(*)::int from public.agents where organization_id = $1) as agents,
        (select count(*)::int from public.charge_concepts where organization_id = $1 and is_system) as system_concepts,
        (select count(*)::int from public.pqrs_categories where organization_id = $1) as categories`,
      [orgA.orgId]
    );
    expect(counts).toEqual({ profiles: 1, agents: 1, system_concepts: 3, categories: 8 });
  });

  it("un owner solo ve su copropiedad y sus personas", async () => {
    const orgs = await t.as<{ name: string }>(orgA.ownerId, "select name from public.organizations");
    expect(orgs.map((o) => o.name)).toEqual(["Conjunto A"]);
    const persons = await t.as<{ full_name: string }>(orgA.ownerId, "select full_name from public.persons");
    expect(persons.map((p) => p.full_name)).toEqual(["Ana Pérez"]);
  });

  it("no puede insertar unidades en otra copropiedad", async () => {
    await expect(
      t.as(orgA.ownerId, "insert into public.units (organization_id, code) values ($1, 'X-1')", [orgB.orgId])
    ).rejects.toThrow(/row-level security/);
  });

  it("no puede relacionar una persona de otra copropiedad (referencia cruzada)", async () => {
    const unitA = await createUnit(t, orgA.orgId, "A-101");
    const [personB] = await t.server<{ id: string }>("select id from public.persons where organization_id = $1", [orgB.orgId]);
    await expect(
      t.as(orgA.ownerId,
        "insert into public.unit_persons (organization_id, unit_id, person_id, relation) values ($1, $2, $3, 'owner')",
        [orgA.orgId, unitA, personB.id])
    ).rejects.toThrow(/TENANT_MISMATCH/);
  });

  it("normaliza teléfonos colombianos a E.164", async () => {
    const [row] = await t.server<{ phone: string }>("select phone from public.persons where full_name = 'Ana Pérez'");
    expect(row.phone).toBe("+573001112233");
    const [n] = await t.server<Record<string, string>>(
      "select public.normalize_phone('57 300 111 2233') as a, public.normalize_phone('(601) 234 5678') as b, public.normalize_phone('+1 415 555 0100') as c"
    );
    expect(n).toEqual({ a: "+573001112233", b: "+576012345678", c: "+14155550100" });
  });

  it("el consejo ve cartera pero no datos personales del censo", async () => {
    const councilId = await addMember(t, orgA.orgId, "council");
    const [perms] = await t.as<{ perms: string[] }>(councilId, "select public.get_my_permissions($1) as perms", [orgA.orgId]);
    expect(perms.perms).toContain("finance.read");
    expect(perms.perms).not.toContain("residents.read");
    const persons = await t.as(councilId, "select * from public.persons");
    expect(persons).toHaveLength(0);
    const units = await t.as(councilId, "select code from public.units where organization_id = $1", [orgA.orgId]);
    expect(units.length).toBeGreaterThan(0);
  });

  it("un auxiliar no puede cambiar la configuración de la copropiedad", async () => {
    const assistantId = await addMember(t, orgA.orgId, "assistant");
    const updated = await t.as(assistantId,
      "update public.property_profiles set nit = '900123456' where organization_id = $1 returning nit", [orgA.orgId]);
    expect(updated).toHaveLength(0);
  });

  it("un admin no puede asignar el rol owner ni degradar al owner", async () => {
    const adminId = await addMember(t, orgA.orgId, "admin");
    const assistantId = await addMember(t, orgA.orgId, "assistant");
    await expect(
      t.as(adminId, "update public.organization_members set role = 'owner' where user_id = $1", [assistantId])
    ).rejects.toThrow(/owner/);
    await expect(
      t.as(adminId, "update public.organization_members set role = 'admin' where user_id = $1", [orgA.ownerId])
    ).rejects.toThrow(/owner/);
  });

  it("la copropiedad siempre conserva un owner", async () => {
    await expect(
      t.as(orgA.ownerId, "delete from public.organization_members where user_id = $1 and organization_id = $2",
        [orgA.ownerId, orgA.orgId])
    ).rejects.toThrow(/al menos un owner/);
  });

  it("un miembro no puede reactivar una copropiedad suspendida", async () => {
    await t.server("update public.organizations set status = 'suspended' where id = $1", [orgB.orgId]);
    await expect(
      t.as(orgB.ownerId, "update public.organizations set status = 'active' where id = $1", [orgB.orgId])
    ).rejects.toThrow(/soporte/);
    await t.server("update public.organizations set status = 'active' where id = $1", [orgB.orgId]);
  });

  it("las credenciales de integraciones nunca son legibles por el panel", async () => {
    await t.server(
      `insert into public.integrations (organization_id, provider, status, credentials)
       values ($1, 'telegram', 'connected', '{"bot_token":"secreto"}')`, [orgA.orgId]);
    await expect(t.as(orgA.ownerId, "select credentials from public.integrations")).rejects.toThrow(/permission denied/);
    const rows = await t.as<{ status: string }>(orgA.ownerId, "select status from public.integrations");
    expect(rows).toEqual([{ status: "connected" }]);
  });

  it("invitación aceptada con el email correcto crea la membresía con su rol", async () => {
    const inviteeId = await t.createUser("contador@example.com");
    const [invite] = await t.as<{ id: string }>(orgA.ownerId,
      "insert into public.organization_invites (organization_id, email, role, invited_by) values ($1, 'contador@example.com', 'accountant', $2) returning id",
      [orgA.orgId, orgA.ownerId]);
    const [member] = await t.as<{ role: string }>(inviteeId, "select role from public.accept_organization_invite($1)", [invite.id]);
    expect(member.role).toBe("accountant");
    const team = await t.as<{ email: string }>(orgA.ownerId, "select email from public.get_team_members($1)", [orgA.orgId]);
    expect(team.map((m) => m.email)).toContain("contador@example.com");
  });

  it("soporte ve metadatos agregados pero no el censo", async () => {
    const supportId = await t.createUser();
    await t.server("insert into public.support_staff (user_id) values ($1)", [supportId]);
    const orgs = await t.as(supportId, "select id from public.organizations");
    expect(orgs.length).toBeGreaterThanOrEqual(2);
    expect(await t.as(supportId, "select * from public.persons")).toHaveLength(0);
    const [overview] = await t.as<{ o: { persons: number } }>(supportId, "select public.get_support_overview($1) as o", [orgA.orgId]);
    expect(overview.o.persons).toBe(1);
  });
});
