import { randomUUID } from "node:crypto";
import type { TestDb } from "./db.js";

export type Role = "owner" | "admin" | "assistant" | "accountant" | "council" | "auditor";

export async function createOrgWithOwner(t: TestDb, name = "Conjunto Los Almendros") {
  const ownerId = await t.createUser();
  const slug = `conjunto-${randomUUID().slice(0, 8)}`;
  const [org] = await t.as<{ id: string }>(
    ownerId,
    "select (public.create_organization_with_owner($1, $2, 'residential_complex', 'America/Bogota', 'Medellín')).id as id",
    [name, slug]
  );
  return { orgId: org.id, ownerId };
}

export async function addMember(t: TestDb, orgId: string, role: Role): Promise<string> {
  const userId = await t.createUser();
  await t.server("insert into public.organization_members (organization_id, user_id, role) values ($1, $2, $3)", [
    orgId,
    userId,
    role
  ]);
  return userId;
}

export async function createUnit(
  t: TestDb,
  orgId: string,
  code: string,
  opts: { coefficient?: number; unitType?: string } = {}
): Promise<string> {
  const [row] = await t.server<{ id: string }>(
    "insert into public.units (organization_id, code, unit_type, coefficient_pct) values ($1, $2, $3, $4) returning id",
    [orgId, code, opts.unitType ?? "apartment", opts.coefficient ?? 1]
  );
  return row.id;
}

export async function createPerson(t: TestDb, orgId: string, name: string, phone?: string): Promise<string> {
  const [row] = await t.server<{ id: string }>(
    "insert into public.persons (organization_id, full_name, phone) values ($1, $2, $3) returning id",
    [orgId, name, phone ?? null]
  );
  return row.id;
}

export async function linkPerson(t: TestDb, orgId: string, unitId: string, personId: string, relation = "owner") {
  await t.server("insert into public.unit_persons (organization_id, unit_id, person_id, relation) values ($1, $2, $3, $4)", [
    orgId,
    unitId,
    personId,
    relation
  ]);
}

export async function conceptId(t: TestDb, orgId: string, name: string): Promise<string> {
  const [row] = await t.server<{ id: string }>(
    "select id from public.charge_concepts where organization_id = $1 and name = $2",
    [orgId, name]
  );
  return row.id;
}

export async function insertCharge(t: TestDb, orgId: string, unitId: string, amount: number, dueDate: string) {
  const concept = await conceptId(t, orgId, "Cuota extraordinaria");
  const [row] = await t.server<{ id: string }>(
    `insert into public.charges (organization_id, unit_id, concept_id, amount, due_date, source)
     values ($1, $2, $3, $4, $5, 'manual') returning id`,
    [orgId, unitId, concept, amount, dueDate]
  );
  return row.id;
}

export async function insertConfirmedPayment(t: TestDb, orgId: string, unitId: string, amount: number, paidOn: string) {
  await t.server(
    `insert into public.payments (organization_id, unit_id, amount, paid_on, method, status)
     values ($1, $2, $3, $4, 'bank_transfer', 'confirmed')`,
    [orgId, unitId, amount, paidOn]
  );
}

/** Conversación verificada de un residente (como la dejaría el flujo de identidad). */
export async function createVerifiedConversation(
  t: TestDb,
  orgId: string,
  personId: string,
  channel: "telegram" | "whatsapp" = "telegram"
): Promise<string> {
  const external = channel === "telegram" ? String(Math.floor(Math.random() * 1e9)) : `+57300${Math.floor(Math.random() * 1e7)}`;
  const [row] = await t.server<{ id: string }>(
    `insert into public.conversations (organization_id, channel, external_conversation_id, external_identity, person_id,
       identity_status, verified_at, verified_via, last_inbound_at)
     values ($1, $2, $3, $4, $5, 'verified', now(), $6, now()) returning id`,
    [orgId, channel, external, channel === "telegram" ? `telegram:${external}` : external, personId,
     channel === "telegram" ? "telegram_contact" : "whatsapp_phone"]
  );
  return row.id;
}

export function isoDate(offsetDays: number): string {
  const date = new Date(Date.now() + offsetDays * 86_400_000);
  // Fechas en la zona de Bogotá (UTC-5, sin horario de verano).
  const bogota = new Date(date.getTime() - 5 * 3_600_000);
  return bogota.toISOString().slice(0, 10);
}
