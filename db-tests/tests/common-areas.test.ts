import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../helpers/db.js";
import {
  createOrgWithOwner,
  createPerson,
  createUnit,
  createVerifiedConversation,
  insertCharge,
  isoDate,
  linkPerson
} from "../helpers/fixtures.js";

const at = (day: string, time: string) => `${day}T${time}:00-05:00`;

describe("zonas comunes y reservas", () => {
  let t: TestDb;
  let org: { orgId: string; ownerId: string };
  let salon: string;
  let gym: string;
  let unitA: string;
  let unitB: string;
  let personA: string;
  const day = isoDate(4);

  async function createArea(name: string, extra: Record<string, unknown>): Promise<string> {
    const columns = ["organization_id", "name", ...Object.keys(extra)];
    const values = [org.orgId, name, ...Object.values(extra)];
    const placeholders = values.map((_, i) => `$${i + 1}`).join(", ");
    const [row] = await t.server<{ id: string }>(
      `insert into public.common_areas (${columns.join(", ")}) values (${placeholders}) returning id`, values);
    for (let dow = 0; dow < 7; dow++) {
      await t.server(
        "insert into public.common_area_hours (organization_id, area_id, day_of_week, opens_at, closes_at) values ($1, $2, $3, '08:00', '22:00')",
        [org.orgId, row.id, dow]);
    }
    return row.id;
  }

  async function bookAsAgent(areaId: string, unitId: string, start: string, end: string, guests = 1) {
    const [row] = await t.server<{ id: string; status: string; charge_id: string | null }>(
      "select id, status, charge_id from public.book_area_reservation($1, $2, $3, $4, $5::timestamptz, $6::timestamptz, $7, null, 'agent', null)",
      [org.orgId, areaId, unitId, personA, start, end, guests]);
    return row;
  }

  beforeAll(async () => {
    t = await createTestDb();
    org = await createOrgWithOwner(t);
    salon = await createArea("Salón social", { fee_amount: 80_000, max_duration_minutes: 360 });
    gym = await createArea("Gimnasio", { booking_mode: "shared", capacity: 3, advance_min_hours: 0 });
    unitA = await createUnit(t, org.orgId, "C-301");
    unitB = await createUnit(t, org.orgId, "C-302");
    personA = await createPerson(t, org.orgId, "Irene Soto", "3020000001");
    await linkPerson(t, org.orgId, unitA, personA, "owner");
    await createVerifiedConversation(t, org.orgId, personA);
  });

  afterAll(async () => {
    await t.close();
  });

  it("lista franjas del día dentro del horario", async () => {
    const slots = await t.as<{ start_at: string; available: boolean }>(org.ownerId,
      "select start_at, available from public.get_area_slots($1, $2::date, 120)", [salon, day]);
    // 08:00 a 20:00 inclusive, cada 60 minutos, con duración de 2 horas.
    expect(slots).toHaveLength(13);
    expect(slots.every((s) => s.available)).toBe(true);
  });

  it("reserva exclusiva: confirma, genera el cargo de la tarifa y bloquea el choque", async () => {
    const booked = await bookAsAgent(salon, unitA, at(day, "14:00"), at(day, "18:00"));
    expect(booked.status).toBe("confirmed");
    expect(booked.charge_id).not.toBeNull();
    const [charge] = await t.server<{ amount: string; unit_id: string }>(
      "select amount, unit_id from public.charges where id = $1", [booked.charge_id]);
    expect({ amount: Number(charge.amount), unit: charge.unit_id }).toEqual({ amount: 80_000, unit: unitA });

    await expect(bookAsAgent(salon, unitB, at(day, "17:00"), at(day, "19:00"))).rejects.toThrow(/AREA_NOT_AVAILABLE/);
    const slots = await t.as<{ start_at: string; available: boolean }>(org.ownerId,
      "select start_at, available from public.get_area_slots($1, $2::date, 60)", [salon, day]);
    expect(slots.filter((s) => !s.available)).toHaveLength(4);
  });

  it("cancelar anula el cargo de la tarifa", async () => {
    const booked = await bookAsAgent(salon, unitA, at(isoDate(5), "10:00"), at(isoDate(5), "12:00"));
    await t.server("select public.cancel_area_reservation($1, 'Cambio de planes')", [booked.id]);
    const [charge] = await t.server<{ status: string }>("select status from public.charges where id = $1", [booked.charge_id]);
    expect(charge.status).toBe("voided");
  });

  it("valida horario, duración, anticipación y cupo por unidad", async () => {
    await expect(bookAsAgent(salon, unitB, at(day, "21:00"), at(day, "23:00"))).rejects.toThrow(/AREA_CLOSED/);
    await expect(bookAsAgent(salon, unitB, at(day, "08:00"), at(day, "08:30"))).rejects.toThrow(/INVALID_DURATION/);
    await expect(bookAsAgent(salon, unitB, at(isoDate(0), "21:00"), at(isoDate(0), "21:59"))).rejects.toThrow(
      /INVALID_DURATION|OUTSIDE_BOOKING_WINDOW|RESERVATION_IN_PAST|AREA_CLOSED/);
    await bookAsAgent(salon, unitA, at(isoDate(6), "08:00"), at(isoDate(6), "10:00"));
    await expect(bookAsAgent(salon, unitA, at(isoDate(7), "08:00"), at(isoDate(7), "10:00"))).rejects.toThrow(
      /UNIT_RESERVATION_LIMIT/);
  });

  it("zona por aforo: acepta hasta la capacidad", async () => {
    const start = at(day, "09:00");
    const end = at(day, "10:00");
    await bookAsAgent(gym, unitA, start, end, 2);
    await bookAsAgent(gym, unitB, start, end, 1);
    await expect(bookAsAgent(gym, unitB, start, end, 1)).rejects.toThrow(/AREA_NOT_AVAILABLE|UNIT_RESERVATION_LIMIT/);
    const [slot] = await t.as<{ remaining_capacity: number }>(org.ownerId,
      "select remaining_capacity from public.get_area_slots($1, $2::date, 60) where start_at = $3::timestamptz",
      [gym, day, start]);
    expect(slot.remaining_capacity).toBe(0);
  });

  it("aprobación: queda pendiente, al aprobar se cobra y se avisa al residente", async () => {
    const bbq = await createArea("BBQ", { requires_approval: true, fee_amount: 50_000 });
    const booked = await bookAsAgent(bbq, unitA, at(day, "12:00"), at(day, "14:00"));
    expect(booked).toMatchObject({ status: "pending_approval", charge_id: null });
    const [approved] = await t.as<{ status: string; charge_id: string }>(org.ownerId,
      "select status, charge_id from public.decide_area_reservation($1, true)", [booked.id]);
    expect(approved.status).toBe("confirmed");
    expect(approved.charge_id).not.toBeNull();
    const [notice] = await t.server<{ body: string; template_key: string }>(
      "select body, template_key from public.outbound_messages where source_id = $1", [booked.id]);
    expect(notice.template_key).toBe("reservation_update");
    expect(notice.body).toContain("aprobada");
  });

  it("bloqueo opcional por mora", async () => {
    const pool = await createArea("Piscina", { block_if_overdue: true });
    await insertCharge(t, org.orgId, unitB, 100_000, isoDate(-10));
    await expect(bookAsAgent(pool, unitB, at(day, "10:00"), at(day, "11:00"))).rejects.toThrow(/UNIT_HAS_OVERDUE_BALANCE/);
  });

  it("el equipo puede agendar sin la anticipación mínima, pero nunca en el pasado", async () => {
    const tomorrow = isoDate(1);
    const [staff] = await t.as<{ status: string }>(org.ownerId,
      "select status from public.book_area_reservation($1, $2, $3, null, $4::timestamptz, $5::timestamptz)",
      [org.orgId, salon, unitB, at(tomorrow, "08:00"), at(tomorrow, "09:00")]);
    expect(staff.status).toBe("confirmed");
    await expect(
      t.as(org.ownerId, "select public.book_area_reservation($1, $2, $3, null, now() - interval '2 hours', now() - interval '1 hour')",
        [org.orgId, salon, unitB])
    ).rejects.toThrow(/RESERVATION_IN_PAST|INVALID_DURATION/);
  });
});
