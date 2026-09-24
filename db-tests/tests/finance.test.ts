import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../helpers/db.js";
import {
  addMember,
  conceptId,
  createOrgWithOwner,
  createPerson,
  createUnit,
  createVerifiedConversation,
  insertCharge,
  insertConfirmedPayment,
  isoDate,
  linkPerson
} from "../helpers/fixtures.js";

type Statement = {
  balance: number;
  overdue_amount: number;
  current_amount: number;
  credit: number;
  aging: Record<string, number>;
  open_items: { unpaid: number; due_date: string }[];
}

describe("cartera y recaudo", () => {
  let t: TestDb;
  let org: { orgId: string; ownerId: string };

  beforeAll(async () => {
    t = await createTestDb();
    org = await createOrgWithOwner(t);
  });

  afterAll(async () => {
    await t.close();
  });

  async function statement(unitId: string, userId = org.ownerId): Promise<Statement> {
    const [row] = await t.as<{ s: Statement }>(userId, "select public.get_unit_statement($1) as s", [unitId]);
    return row.s;
  }

  it("aplica los pagos FIFO a los cargos más antiguos y clasifica por edades", async () => {
    const unit = await createUnit(t, org.orgId, "T1-101");
    await insertCharge(t, org.orgId, unit, 300_000, isoDate(-70));
    await insertCharge(t, org.orgId, unit, 300_000, isoDate(-40));
    await insertCharge(t, org.orgId, unit, 300_000, isoDate(10));
    await insertConfirmedPayment(t, org.orgId, unit, 400_000, isoDate(-5));

    const s = await statement(unit);
    expect(Number(s.balance)).toBe(500_000);
    // El primer cargo queda pagado; el segundo tiene 200.000 vencidos (31-60 días).
    expect(Number(s.overdue_amount)).toBe(200_000);
    expect(Number(s.current_amount)).toBe(300_000);
    expect(Number(s.aging.d31_60)).toBe(200_000);
    expect(Number(s.aging.d61_90)).toBe(0);
    expect(s.open_items.map((i) => Number(i.unpaid))).toEqual([200_000, 300_000]);
  });

  it("un pago mayor a la deuda deja saldo a favor", async () => {
    const unit = await createUnit(t, org.orgId, "T1-102");
    await insertCharge(t, org.orgId, unit, 100_000, isoDate(-3));
    await insertConfirmedPayment(t, org.orgId, unit, 150_000, isoDate(-1));
    const s = await statement(unit);
    expect(Number(s.balance)).toBe(-50_000);
    expect(Number(s.credit)).toBe(50_000);
    expect(s.open_items).toEqual([]);
  });

  it("la cuota por coeficiente se redondea y la liquidación es idempotente", async () => {
    await t.server(
      "update public.charge_concepts set amount = 10000000 where organization_id = $1 and name = 'Cuota de administración'",
      [org.orgId]
    );
    const period = `${isoDate(0).slice(0, 7)}-01`;
    const [preview] = await t.as<{ p: { new_count: number; rows: { unit_code: string; amount: number }[] } }>(
      org.ownerId, "select public.preview_monthly_charges($1, $2::date) as p", [org.orgId, period]);
    // Coeficiente 1% => 100.000 exactos para cada unidad creada con el fixture.
    expect(preview.p.rows.every((r) => Number(r.amount) === 100_000)).toBe(true);

    const [first] = await t.as<{ r: { created: number } }>(org.ownerId,
      "select public.generate_monthly_charges($1, $2::date, $3::date) as r", [org.orgId, period, isoDate(15)]);
    expect(first.r.created).toBe(preview.p.new_count);
    const [second] = await t.as<{ r: { created: number } }>(org.ownerId,
      "select public.generate_monthly_charges($1, $2::date, $3::date) as r", [org.orgId, period, isoDate(15)]);
    expect(second.r.created).toBe(0);
  });

  it("solo quien tiene finance.write liquida cuotas", async () => {
    const council = await addMember(t, org.orgId, "council");
    await expect(
      t.as(council, "select public.generate_monthly_charges($1, $2::date, $3::date)", [org.orgId, isoDate(0), isoDate(15)])
    ).rejects.toThrow(/FORBIDDEN/);
  });

  it("los cargos son inmutables: solo se anulan con motivo", async () => {
    const unit = await createUnit(t, org.orgId, "T1-103");
    const charge = await insertCharge(t, org.orgId, unit, 50_000, isoDate(-1));
    await expect(t.server("update public.charges set amount = 1 where id = $1", [charge])).rejects.toThrow(/CHARGE_IMMUTABLE/);
    await expect(t.as(org.ownerId, "select public.void_charge($1, 'x')", [charge])).rejects.toThrow(/motivo/);
    const [voided] = await t.as<{ status: string; voided_by: string }>(org.ownerId,
      "select status, voided_by from public.void_charge($1, 'Cobro duplicado')", [charge]);
    expect(voided).toEqual({ status: "voided", voided_by: org.ownerId });
    expect(Number((await statement(unit)).balance)).toBe(0);
    await expect(t.as(org.ownerId, "delete from public.charges where id = $1", [charge])).rejects.toThrow(/permission denied/);
  });

  it("liquida intereses de mora sin interés sobre interés", async () => {
    await t.server("update public.property_profiles set late_interest_monthly_rate = 2 where organization_id = $1", [org.orgId]);
    const unit = await createUnit(t, org.orgId, "T9-901", { coefficient: 0 });
    await insertCharge(t, org.orgId, unit, 1_000_000, isoDate(-45));
    const [res] = await t.as<{ r: { created: number } }>(org.ownerId,
      "select public.generate_interest_charges($1, $2::date, $3::date, $4::date) as r",
      [org.orgId, isoDate(0), isoDate(0), isoDate(10)]);
    expect(res.r.created).toBeGreaterThan(0);
    const [interest] = await t.server<{ amount: string }>(
      "select c.amount from public.charges c join public.charge_concepts cc on cc.id = c.concept_id where c.unit_id = $1 and cc.kind = 'interest'",
      [unit]);
    expect(Number(interest.amount)).toBe(20_000);
    const [again] = await t.as<{ r: { created: number } }>(org.ownerId,
      "select public.generate_interest_charges($1, $2::date, $3::date, $4::date) as r",
      [org.orgId, isoDate(0), isoDate(0), isoDate(10)]);
    expect(again.r.created).toBe(0);
  });

  it("un reporte de pago del residente solo cuenta cuando el equipo lo confirma", async () => {
    const unit = await createUnit(t, org.orgId, "T2-201");
    const person = await createPerson(t, org.orgId, "Carla Ruiz", "3105556677");
    await linkPerson(t, org.orgId, unit, person, "owner");
    const conversation = await createVerifiedConversation(t, org.orgId, person);
    await insertCharge(t, org.orgId, unit, 350_000, isoDate(-2));

    const [receipt] = await t.server<{ r: { payment_id: string; created: boolean } }>(
      "select public.attach_payment_receipt($1, $2, $3, 'org/receipt.jpg') as r", [org.orgId, person, conversation]);
    expect(receipt.r.created).toBe(true);
    const [reported] = await t.server<{ id: string; status: string; unit_id: string }>(
      "select id, status, unit_id from public.report_payment_from_resident($1, $2, $3, 350000, $4::date, 'pse', 'REF123', null, $5)",
      [org.orgId, person, unit, isoDate(-1), conversation]);
    // Completa el reporte que ya tenía la foto, no crea otro.
    expect(reported.id).toBe(receipt.r.payment_id);
    expect(Number((await statement(unit)).balance)).toBe(350_000);

    const [confirmed] = await t.as<{ status: string }>(org.ownerId,
      "select status from public.review_payment($1, true)", [reported.id]);
    expect(confirmed.status).toBe("confirmed");
    expect(Number((await statement(unit)).balance)).toBe(0);

    const [notice] = await t.server<{ body: string; channel: string }>(
      "select body, channel from public.outbound_messages where source_id = $1", [reported.id]);
    expect(notice.body).toContain("$ 350.000");
    expect(notice.channel).toBe("telegram");
  });

  it("un pago confirmado solo se reversa, con motivo", async () => {
    const unit = await createUnit(t, org.orgId, "T2-202");
    const [payment] = await t.as<{ id: string }>(org.ownerId,
      "select id from public.register_payment($1, $2, 80000, $3::date, 'cash')", [org.orgId, unit, isoDate(0)]);
    await expect(t.server("update public.payments set amount = 1 where id = $1", [payment.id])).rejects.toThrow(/PAYMENT_IMMUTABLE/);
    const [reversed] = await t.as<{ status: string }>(org.ownerId,
      "select status from public.reverse_payment($1, 'Cheque devuelto')", [payment.id]);
    expect(reversed.status).toBe("reversed");
  });

  it("no acepta pagos con fecha futura", async () => {
    const unit = await createUnit(t, org.orgId, "T2-203");
    await expect(
      t.as(org.ownerId, "select public.register_payment($1, $2, 1000, $3::date, 'cash')", [org.orgId, unit, isoDate(3)])
    ).rejects.toThrow(/futura/);
  });

  it("la cartera por edades oculta nombres a quien no tiene permiso de censo", async () => {
    const council = await addMember(t, org.orgId, "council");
    const rows = await t.as<{ unit_code: string; owner_names: string | null }>(council,
      "select unit_code, owner_names from public.get_portfolio($1) where unit_code = 'T2-201'", [org.orgId]);
    expect(rows).toEqual([{ unit_code: "T2-201", owner_names: null }]);
    const withNames = await t.as<{ owner_names: string }>(org.ownerId,
      "select owner_names from public.get_portfolio($1) where unit_code = 'T2-201'", [org.orgId]);
    expect(withNames[0].owner_names).toBe("Carla Ruiz");
  });

  it("encola recordatorios de cobro privados e idempotentes", async () => {
    await t.server("update public.property_profiles set payment_reminder_days_before = 3 where organization_id = $1", [org.orgId]);
    const unit = await createUnit(t, org.orgId, "T3-301", { coefficient: 0 });
    const person = await createPerson(t, org.orgId, "Diego Mora", "3201234567");
    await linkPerson(t, org.orgId, unit, person, "owner");
    await createVerifiedConversation(t, org.orgId, person, "whatsapp");
    await insertCharge(t, org.orgId, unit, 420_000, isoDate(3));

    const [first] = await t.server<{ n: number }>("select public.enqueue_payment_reminders() as n");
    const [second] = await t.server<{ n: number }>("select public.enqueue_payment_reminders() as n");
    expect(first.n).toBeGreaterThanOrEqual(1);
    expect(second.n).toBe(0);
    const [msg] = await t.server<{ body: string; template_key: string; template_vars: Record<string, string> }>(
      "select body, template_key, template_vars from public.outbound_messages where person_id = $1 and kind = 'payment_reminder'",
      [person]);
    expect(msg.template_key).toBe("payment_reminder");
    expect(msg.template_vars["4"]).toBe("$ 420.000");
    expect(msg.body).toContain("T3-301");
  });

  it("solo conceptos no del sistema admiten cargos manuales", async () => {
    const unit = await createUnit(t, org.orgId, "T4-401");
    const interest = await conceptId(t, org.orgId, "Intereses de mora");
    await expect(
      t.as(org.ownerId, "select public.create_manual_charge($1, $2, $3, 1000, null)", [org.orgId, unit, interest])
    ).rejects.toThrow(/CONCEPT_NOT_FOUND/);
  });
});
