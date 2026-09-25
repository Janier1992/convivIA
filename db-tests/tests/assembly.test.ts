import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../helpers/db.js";
import { addMember, createOrgWithOwner, createPerson, createUnit, linkPerson } from "../helpers/fixtures.js";

describe("asamblea y gobierno", () => {
  let t: TestDb;
  let orgA: { orgId: string; ownerId: string };
  let orgB: { orgId: string; ownerId: string };
  let unitA: string;
  let unitB: string;
  let ownerA1: string;
  let ownerB1: string;
  let attorney: string;
  let adminA: string;
  let auditorA: string;

  beforeAll(async () => {
    t = await createTestDb();
    orgA = await createOrgWithOwner(t, "Conjunto Los Cerezos");
    orgB = await createOrgWithOwner(t, "Conjunto El Prado");
    unitA = await createUnit(t, orgA.orgId, "T1-101", { coefficient: 60 });
    unitB = await createUnit(t, orgA.orgId, "T1-102", { coefficient: 40 });
    ownerA1 = await createPerson(t, orgA.orgId, "Ana Torres");
    ownerB1 = await createPerson(t, orgA.orgId, "Bruno Salas");
    attorney = await createPerson(t, orgA.orgId, "Carla Niño");
    await linkPerson(t, orgA.orgId, unitA, ownerA1, "owner");
    await linkPerson(t, orgA.orgId, unitB, ownerB1, "owner");
    adminA = await addMember(t, orgA.orgId, "admin");
    auditorA = await addMember(t, orgA.orgId, "auditor");
  });

  afterAll(async () => {
    await t.close();
  });

  it("crea una asamblea en borrador con quórum por defecto", async () => {
    const [assembly] = await t.as<{ id: string; status: string; first_call_quorum_pct: string }>(
      adminA,
      "select * from public.create_assembly($1, 'Asamblea ordinaria 2026', now() + interval '7 days')",
      [orgA.orgId]
    );
    expect(assembly.status).toBe("draft");
    expect(Number(assembly.first_call_quorum_pct)).toBe(51);
  });

  it("flujo completo: orden del día, poderes, asistencia, quórum, votación y cierre", async () => {
    const [assembly] = await t.as<{ id: string }>(
      adminA,
      "select * from public.create_assembly($1, 'Asamblea extraordinaria', now() + interval '3 days', 'extraordinaria')",
      [orgA.orgId]
    );

    const [itemVota] = await t.as<{ id: string; requires_vote: boolean }>(
      adminA,
      "select * from public.add_agenda_item($1, 'Aprobar presupuesto 2027')",
      [assembly.id]
    );
    const [itemInforme] = await t.as<{ id: string }>(
      adminA,
      "select * from public.add_agenda_item($1, 'Informe de gestión', null, false)",
      [assembly.id]
    );
    expect(itemVota.requires_vote).toBe(true);

    // Bruno (dueño de la unidad B) le da poder a Carla, que no vive allí.
    const [proxy] = await t.as<{ id: string; status: string }>(
      adminA,
      "select * from public.register_proxy($1, $2, $3, $4, $5)",
      [orgA.orgId, assembly.id, unitB, ownerB1, attorney]
    );
    expect(proxy.status).toBe("accepted");

    await t.as(adminA, "select public.start_assembly($1)", [assembly.id]);

    await t.as(adminA, "select public.check_in_unit($1, $2, $3, $4)", [orgA.orgId, assembly.id, unitA, ownerA1]);
    await t.as(adminA, "select public.check_in_unit($1, $2, $3, $4, $5)", [orgA.orgId, assembly.id, unitB, attorney, proxy.id]);

    const attendees = await t.as<{ unit_code: string; full_name: string }>(
      adminA,
      "select unit_code, full_name from public.get_assembly_attendees($1) order by unit_code",
      [assembly.id]
    );
    expect(attendees.map((a) => `${a.unit_code}:${a.full_name}`)).toEqual(["T1-101:Ana Torres", "T1-102:Carla Niño"]);

    const proxies = await t.as<{ unit_code: string; attorney_name: string }>(
      adminA,
      "select unit_code, attorney_name from public.get_assembly_proxies($1)",
      [assembly.id]
    );
    expect(proxies).toEqual([{ unit_code: "T1-102", attorney_name: "Carla Niño" }]);

    const [quorum] = await t.as<{
      result: { total_coefficient_pct: string; present_coefficient_pct: string; reached_first_call: boolean };
    }>(adminA, "select public.get_assembly_quorum($1) as result", [assembly.id]);
    expect(Number(quorum.result.total_coefficient_pct)).toBe(100);
    expect(Number(quorum.result.present_coefficient_pct)).toBe(100);
    expect(quorum.result.reached_first_call).toBe(true);

    await t.as(adminA, "select public.cast_vote($1, $2, $3, 'a_favor')", [assembly.id, itemVota.id, unitA]);
    await t.as(adminA, "select public.cast_vote($1, $2, $3, 'en_contra')", [assembly.id, itemVota.id, unitB]);

    const [results] = await t.as<{ result: { a_favor_pct: string; en_contra_pct: string } }>(
      adminA,
      "select public.get_vote_results($1) as result",
      [itemVota.id]
    );
    expect(Number(results.result.a_favor_pct)).toBe(60);
    expect(Number(results.result.en_contra_pct)).toBe(40);

    await expect(
      t.as(adminA, "select public.cast_vote($1, $2, $3, 'a_favor')", [assembly.id, itemInforme.id, unitA])
    ).rejects.toThrow(/VALIDATION_ERROR/);

    const [doc] = await t.server<{ id: string }>(
      `insert into public.documents (organization_id, title, doc_type, visibility, source_text, status)
       values ($1, 'Acta asamblea extraordinaria', 'assembly_minutes', 'residents', 'Contenido del acta.', 'ready')
       returning id`,
      [orgA.orgId]
    );
    await expect(
      t.as(adminA, "select public.set_assembly_minutes($1, $2)", [assembly.id, await docWrongType(t, orgA.orgId)])
    ).rejects.toThrow(/VALIDATION_ERROR/);

    await t.as(adminA, "select public.close_assembly($1)", [assembly.id]);
    const [linked] = await t.as<{ minutes_document_id: string | null; status: string }>(
      adminA,
      "select * from public.set_assembly_minutes($1, $2)",
      [assembly.id, doc.id]
    );
    expect(linked.minutes_document_id).toBe(doc.id);
    expect(linked.status).toBe("closed");

    await expect(
      t.as(adminA, "select public.add_agenda_item($1, 'Punto tardío')", [assembly.id])
    ).rejects.toThrow(/VALIDATION_ERROR/);
  });

  async function docWrongType(dbT: TestDb, orgId: string): Promise<string> {
    const [doc] = await dbT.server<{ id: string }>(
      `insert into public.documents (organization_id, title, doc_type, visibility, source_text, status)
       values ($1, 'Reglamento interno', 'bylaws', 'residents', 'Contenido.', 'ready')
       returning id`,
      [orgId]
    );
    return doc.id;
  }

  it("respeta el límite de unidades por apoderado configurado en la copropiedad", async () => {
    await t.server("update public.property_profiles set max_proxies_per_attorney = 1 where organization_id = $1", [orgA.orgId]);
    const unitC = await createUnit(t, orgA.orgId, "T1-103", { coefficient: 5 });
    const ownerC1 = await createPerson(t, orgA.orgId, "Diego Ruiz");
    await linkPerson(t, orgA.orgId, unitC, ownerC1, "owner");

    const [assembly] = await t.as<{ id: string }>(
      adminA,
      "select * from public.create_assembly($1, 'Asamblea de prueba de poderes', now() + interval '5 days')",
      [orgA.orgId]
    );

    await t.as(adminA, "select public.register_proxy($1, $2, $3, $4, $5)", [orgA.orgId, assembly.id, unitB, ownerB1, attorney]);
    await expect(
      t.as(adminA, "select public.register_proxy($1, $2, $3, $4, $5)", [orgA.orgId, assembly.id, unitC, ownerC1, attorney])
    ).rejects.toThrow(/VALIDATION_ERROR/);

    await t.server("update public.property_profiles set max_proxies_per_attorney = null where organization_id = $1", [orgA.orgId]);
  });

  it("un auditor (solo lectura) no puede crear ni registrar nada", async () => {
    await expect(
      t.as(auditorA, "select public.create_assembly($1, 'X', now())", [orgA.orgId])
    ).rejects.toThrow(/FORBIDDEN/);
  });

  it("aísla asambleas entre copropiedades", async () => {
    const [assembly] = await t.as<{ id: string }>(
      adminA,
      "select * from public.create_assembly($1, 'Asamblea privada A', now() + interval '10 days')",
      [orgA.orgId]
    );
    const rows = await t.as(orgB.ownerId, "select id from public.assemblies where organization_id = $1", [orgA.orgId]);
    expect(rows).toEqual([]);
    await expect(t.as(orgB.ownerId, "select public.get_assembly_quorum($1)", [assembly.id])).rejects.toThrow(/FORBIDDEN/);
  });
});
