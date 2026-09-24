import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../helpers/db.js";
import {
  addMember,
  createOrgWithOwner,
  createPerson,
  createUnit,
  createVerifiedConversation,
  insertCharge,
  isoDate,
  linkPerson
} from "../helpers/fixtures.js";

type Ticket = {
  id: string;
  radicado: string;
  status: string;
  due_at: string;
  created_at: string;
};

describe("PQRS", () => {
  let t: TestDb;
  let org: { orgId: string; ownerId: string };
  let personId: string;
  let conversationId: string;
  let categoryId: string;

  beforeAll(async () => {
    t = await createTestDb();
    org = await createOrgWithOwner(t);
    const unit = await createUnit(t, org.orgId, "A-101");
    personId = await createPerson(t, org.orgId, "Elena Ríos", "3151112222");
    await linkPerson(t, org.orgId, unit, personId, "tenant");
    conversationId = await createVerifiedConversation(t, org.orgId, personId);
    const [cat] = await t.server<{ id: string }>(
      "select id from public.pqrs_categories where organization_id = $1 and name = 'Seguridad'", [org.orgId]);
    categoryId = cat.id;
  });

  afterAll(async () => {
    await t.close();
  });

  async function createFromAgent(subject: string): Promise<Ticket> {
    const [ticket] = await t.server<Ticket>(
      `select * from public.create_pqrs_ticket($1, 'queja', $2, $3, 'Descripción detallada', 'high', null, $4, null, null,
        'telegram', $5, 'agent')`,
      [org.orgId, categoryId, subject, personId, conversationId]);
    return ticket;
  }

  it("genera radicados consecutivos por año y el SLA de la categoría", async () => {
    const first = await createFromAgent("Portón dañado");
    const second = await createFromAgent("Ruido en la noche");
    const year = new Date().getUTCFullYear();
    expect(first.radicado).toMatch(new RegExp(`^PQRS-(${year}|${year - 1}|${year + 1})-00001$`));
    expect(second.radicado.endsWith("-00002")).toBe(true);
    const hours = (new Date(first.due_at).getTime() - new Date(first.created_at).getTime()) / 3_600_000;
    expect(Math.round(hours)).toBe(24);
    const events = await t.server<{ actor_kind: string }>("select actor_kind from public.pqrs_events where ticket_id = $1", [first.id]);
    expect(events).toEqual([{ actor_kind: "agent" }]);
  });

  it("valida el flujo de estados", async () => {
    const ticket = await createFromAgent("Filtración en parqueadero");
    await expect(t.as(org.ownerId, "select public.update_pqrs_ticket($1, 'answered')", [ticket.id])).rejects.toThrow(/respond/);
    await expect(t.as(org.ownerId, "select public.update_pqrs_ticket($1, 'closed')", [ticket.id])).rejects.toThrow(/motivo/);
    const [assigned] = await t.as<{ status: string }>(org.ownerId,
      "select status from public.update_pqrs_ticket($1, null, null, $2)", [ticket.id, org.ownerId]);
    expect(assigned.status).toBe("assigned");
  });

  it("responder entrega el mensaje por la conversación del residente", async () => {
    const ticket = await createFromAgent("Luz dañada en el pasillo");
    const [res] = await t.as<{ r: { notified: boolean; ticket: { status: string } } }>(org.ownerId,
      "select public.respond_pqrs_ticket($1, 'Mañana llega el electricista.', false) as r", [ticket.id]);
    expect(res.r.notified).toBe(true);
    expect(res.r.ticket.status).toBe("answered");
    const [msg] = await t.server<{ conversation_id: string; body: string; template_key: string }>(
      "select conversation_id, body, template_key from public.outbound_messages where source_id = $1", [ticket.id]);
    expect(msg.conversation_id).toBe(conversationId);
    expect(msg.body).toContain(ticket.radicado);
    expect(msg.template_key).toBe("pqrs_update");
  });

  it("el consejo lee PQRS pero no las gestiona", async () => {
    const council = await addMember(t, org.orgId, "council");
    const ticket = await createFromAgent("Sugerencia de jardinería");
    expect((await t.as(council, "select id from public.pqrs_tickets where id = $1", [ticket.id]))).toHaveLength(1);
    await expect(t.as(council, "select public.respond_pqrs_ticket($1, 'Respuesta', false)", [ticket.id])).rejects.toThrow(/FORBIDDEN/);
  });
});

describe("comunicaciones", () => {
  let t: TestDb;
  let org: { orgId: string; ownerId: string };
  let debtor: string;
  let upToDate: string;

  beforeAll(async () => {
    t = await createTestDb();
    org = await createOrgWithOwner(t);
    const unitDebt = await createUnit(t, org.orgId, "B-201");
    const unitOk = await createUnit(t, org.orgId, "B-202");
    debtor = await createPerson(t, org.orgId, "Fabio Luna", "3010000001");
    upToDate = await createPerson(t, org.orgId, "Gloria Mesa", "3010000002");
    const noChannel = await createPerson(t, org.orgId, "Hugo Paz", "3010000003");
    await linkPerson(t, org.orgId, unitDebt, debtor, "owner");
    await linkPerson(t, org.orgId, unitOk, upToDate, "owner");
    await linkPerson(t, org.orgId, unitOk, noChannel, "resident");
    await createVerifiedConversation(t, org.orgId, debtor, "whatsapp");
    await createVerifiedConversation(t, org.orgId, upToDate);
    await insertCharge(t, org.orgId, unitDebt, 200_000, isoDate(-20));
  });

  afterAll(async () => {
    await t.close();
  });

  async function draft(audience: string): Promise<string> {
    const [row] = await t.as<{ id: string }>(org.ownerId,
      "insert into public.announcements (organization_id, title, body, audience_type) values ($1, 'Mantenimiento', 'Corte de agua el sábado', $2) returning id",
      [org.orgId, audience]);
    return row.id;
  }

  it("envía un mensaje privado por persona y reporta quién no tiene canal", async () => {
    const id = await draft("all");
    const [res] = await t.as<{ r: { queued: number; without_channel: number } }>(org.ownerId,
      "select public.send_announcement($1) as r", [id]);
    expect(res.r).toEqual({ queued: 2, without_channel: 1 });
    await expect(t.as(org.ownerId, "select public.send_announcement($1)", [id])).rejects.toThrow(/ALREADY_SENT/);
    await expect(
      t.as(org.ownerId, "update public.announcements set title = 'Otro' where id = $1", [id])
    ).rejects.toThrow(/no se puede modificar/);
  });

  it("la audiencia 'unidades en mora' solo alcanza a quienes deben", async () => {
    const id = await draft("debtors");
    const [res] = await t.as<{ r: { queued: number } }>(org.ownerId, "select public.send_announcement($1) as r", [id]);
    expect(res.r.queued).toBe(1);
    const recipients = await t.server<{ person_id: string }>(
      "select person_id from public.outbound_messages where source_id = $1", [id]);
    expect(recipients).toEqual([{ person_id: debtor }]);
  });

  it("respetar la baja de notificaciones", async () => {
    await t.server("update public.conversations set notifications_opt_out = true where person_id = $1", [upToDate]);
    const id = await draft("owners");
    const [res] = await t.as<{ r: { queued: number; without_channel: number } }>(org.ownerId,
      "select public.send_announcement($1) as r", [id]);
    expect(res.r.queued).toBe(1);
    await t.server("update public.conversations set notifications_opt_out = false where person_id = $1", [upToDate]);
  });

  it("la respuesta manual del equipo pausa al asistente y se encola", async () => {
    const [conv] = await t.server<{ id: string; external_identity: string }>(
      "select id, external_identity from public.conversations where person_id = $1", [debtor]);
    await t.as(org.ownerId, "select public.send_staff_reply($1, 'Hola Fabio, ya revisamos tu caso.')", [conv.id]);
    const [state] = await t.server<{ status: string }>("select status from public.conversations where id = $1", [conv.id]);
    expect(state.status).toBe("handoff");
    const [out] = await t.server<{ channel: string; destination: string }>(
      "select channel, destination from public.outbound_messages where conversation_id = $1 and kind = 'staff_reply'", [conv.id]);
    // WhatsApp se entrega al teléfono de la conversación (no a un chat id).
    expect(out).toEqual({ channel: "whatsapp", destination: conv.external_identity });
  });

  it("el worker reclama mensajes una sola vez (SKIP LOCKED) y recupera envíos colgados", async () => {
    const claimed = await t.server<{ id: string }>("select id from public.claim_outbound_messages(50)");
    expect(claimed.length).toBeGreaterThan(0);
    expect(await t.server("select id from public.claim_outbound_messages(50)")).toHaveLength(0);
    await t.server("update public.outbound_messages set updated_at = now() - interval '10 minutes' where status = 'sending'");
    const reclaimed = await t.server<{ attempts: number }>("select attempts from public.claim_outbound_messages(50)");
    expect(reclaimed.every((m) => m.attempts === 2)).toBe(true);
  });
});
