import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../helpers/db.js";
import { addMember, createOrgWithOwner, createPerson, createUnit, insertCharge, isoDate, linkPerson } from "../helpers/fixtures.js";

describe("conversaciones, identidad y tablero", () => {
  let t: TestDb;
  let org: { orgId: string; ownerId: string };
  let personId: string;

  beforeAll(async () => {
    t = await createTestDb();
    org = await createOrgWithOwner(t);
    const unit1 = await createUnit(t, org.orgId, "D-401");
    const unit2 = await createUnit(t, org.orgId, "P-12", { unitType: "parking" });
    personId = await createPerson(t, org.orgId, "Mónica Téllez", "3187654321");
    await linkPerson(t, org.orgId, unit1, personId, "owner");
    await linkPerson(t, org.orgId, unit2, personId, "resident");
    await insertCharge(t, org.orgId, unit1, 300_000, isoDate(-15));
  });

  afterAll(async () => {
    await t.close();
  });

  it("encuentra a la persona por cualquier formato del teléfono", async () => {
    for (const raw of ["+573187654321", "573187654321", "318 765 4321"]) {
      const [row] = await t.server<{ person_id: string }>("select person_id from public.find_person_by_phone($1, $2)", [org.orgId, raw]);
      expect(row.person_id).toBe(personId);
    }
  });

  it("la identidad deriva el acceso financiero de la relación con cada unidad", async () => {
    const [row] = await t.server<{ i: { units: { code: string; finance_access: boolean }[] } }>(
      "select public.get_person_identity($1, $2) as i", [org.orgId, personId]);
    expect(row.i.units).toEqual([
      expect.objectContaining({ code: "D-401", finance_access: true }),
      expect.objectContaining({ code: "P-12", finance_access: false })
    ]);
  });

  it("la vista previa crea una conversación simulada y encola el turno del agente real", async () => {
    const [res] = await t.as<{ r: { conversation_id: string; job_id: string } }>(org.ownerId,
      "select public.enqueue_preview_message($1, 'Hola, ¿cuánto debo?', null, $2) as r", [org.orgId, personId]);
    const [conv] = await t.server<{ is_preview: boolean; identity_status: string; channel: string }>(
      "select is_preview, identity_status, channel from public.conversations where id = $1", [res.r.conversation_id]);
    expect(conv).toEqual({ is_preview: true, identity_status: "verified", channel: "web" });
    const claimed = await t.server<{ id: string; job_type: string }>("select id, job_type from public.claim_background_jobs(5)");
    expect(claimed).toEqual([{ id: res.r.job_id, job_type: "agent_turn" }]);
    expect(await t.server("select id from public.claim_background_jobs(5)")).toHaveLength(0);
  });

  it("un auxiliar no puede usar la vista previa del asistente", async () => {
    const assistant = await addMember(t, org.orgId, "assistant");
    await expect(
      t.as(assistant, "select public.enqueue_preview_message($1, 'hola')", [org.orgId])
    ).rejects.toThrow(/FORBIDDEN/);
  });

  it("los mensajes del residente actualizan la ventana de 24h de la conversación", async () => {
    const [conv] = await t.server<{ id: string }>(
      `insert into public.conversations (organization_id, channel, external_conversation_id, external_identity)
       values ($1, 'whatsapp', '+573009990000', '+573009990000') returning id`, [org.orgId]);
    await t.server("insert into public.messages (organization_id, conversation_id, role, content) values ($1, $2, 'user', 'hola')",
      [org.orgId, conv.id]);
    await t.server("insert into public.messages (organization_id, conversation_id, role, content) values ($1, $2, 'assistant', 'hola!')",
      [org.orgId, conv.id]);
    const [row] = await t.server<{ inbound: boolean; last: boolean }>(
      "select last_inbound_at is not null as inbound, last_message_at >= last_inbound_at as last from public.conversations where id = $1",
      [conv.id]);
    expect(row).toEqual({ inbound: true, last: true });
  });

  it("eliminar a una persona verificada deja su conversación como no verificada", async () => {
    const ghost = await createPerson(t, org.orgId, "Persona Temporal", "3170000000");
    const [conv] = await t.server<{ id: string }>(
      `insert into public.conversations (organization_id, channel, external_conversation_id, person_id, identity_status, verified_via)
       values ($1, 'telegram', '555', $2, 'verified', 'telegram_contact') returning id`, [org.orgId, ghost]);
    await t.server("delete from public.persons where id = $1", [ghost]);
    const [row] = await t.server<{ identity_status: string; person_id: string | null }>(
      "select identity_status, person_id from public.conversations where id = $1", [conv.id]);
    expect(row).toEqual({ identity_status: "unverified", person_id: null });
  });

  it("el tablero calcula la mora y es privado de cada copropiedad", async () => {
    const [owner] = await t.as<{ d: { finance: { overdue_total: number; units_overdue: number } } }>(org.ownerId,
      "select public.get_admin_dashboard($1) as d", [org.orgId]);
    expect(Number(owner.d.finance.overdue_total)).toBe(300_000);
    expect(owner.d.finance.units_overdue).toBe(1);
    const outsider = await createOrgWithOwner(t, "Otro conjunto");
    await expect(
      t.as(outsider.ownerId, "select public.get_admin_dashboard($1)", [org.orgId])
    ).rejects.toThrow(/FORBIDDEN/);
  });
});
