import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../helpers/db.js";
import { createOrgWithOwner, createUnit, insertCharge, isoDate } from "../helpers/fixtures.js";

describe("panel consolidado multi-copropiedad (get_portfolio_overview)", () => {
  let t: TestDb;
  let orgA: { orgId: string; ownerId: string };
  let orgB: { orgId: string; ownerId: string };
  let unitA: string;

  beforeAll(async () => {
    t = await createTestDb();
    orgA = await createOrgWithOwner(t, "Conjunto Los Robles");
    orgB = await createOrgWithOwner(t, "Conjunto El Bosque");
    unitA = await createUnit(t, orgA.orgId, "T1-501");
    await createUnit(t, orgA.orgId, "T1-502");

    // Cartera: un cargo vencido sin pagar en orgA.
    await insertCharge(t, orgA.orgId, unitA, 350_000, isoDate(-10));

    // PQRS: una abierta y vencida, otra cerrada (no debe contar como abierta).
    const [overdueTicket] = await t.as<{ id: string }>(
      orgA.ownerId,
      "select * from public.create_pqrs_ticket($1, 'queja', null, 'Fuga de agua', 'Hay agua en el pasillo.')",
      [orgA.orgId]
    );
    // El SLA por defecto la deja vigente por 72h: la atrasamos a mano para probar el conteo de vencidas.
    await t.server("update public.pqrs_tickets set due_at = now() - interval '1 day' where id = $1", [overdueTicket.id]);
    const [closedTicket] = await t.as<{ id: string }>(
      orgA.ownerId,
      "select * from public.create_pqrs_ticket($1, 'peticion', null, 'Certificado', 'Necesito un paz y salvo.')",
      [orgA.orgId]
    );
    await t.as(orgA.ownerId, "select public.respond_pqrs_ticket($1, 'Listo, adjunto el certificado.', true)", [closedTicket.id]);

    // Mantenimiento: una orden abierta (reportada) y otra cerrada.
    await t.as(orgA.ownerId, "select public.create_work_order($1, 'Ascensor con ruido', 'Ruido metálico al frenar.')", [orgA.orgId]);
    const [wo2] = await t.as<{ id: string }>(
      orgA.ownerId,
      "select * from public.create_work_order($1, 'Portón trabado', 'No cierra del todo.')",
      [orgA.orgId]
    );
    await t.as(orgA.ownerId, "select public.cancel_work_order($1, 'Se resolvió solo, era un tornillo suelto.')", [wo2.id]);

    // ownerA también es "accountant" (solo lectura de cartera) en orgB, que no tiene datos.
    await t.server("insert into public.organization_members (organization_id, user_id, role) values ($1, $2, 'accountant')", [
      orgB.orgId,
      orgA.ownerId
    ]);
  });

  afterAll(async () => {
    await t.close();
  });

  it("agrega cartera, PQRS y mantenimiento de todas las copropiedades del usuario, ordenadas por nombre", async () => {
    const rows = await t.as<{
      organization_name: string;
      role: string;
      units_total: number;
      overdue_total: string;
      units_overdue: number;
      pqrs_open: number;
      pqrs_overdue: number;
      work_orders_open: number;
    }>(orgA.ownerId, "select * from public.get_portfolio_overview()");

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.organization_name)).toEqual(["Conjunto El Bosque", "Conjunto Los Robles"]);

    const bosque = rows.find((r) => r.organization_name === "Conjunto El Bosque")!;
    expect(bosque.role).toBe("accountant");
    expect(Number(bosque.overdue_total)).toBe(0);
    expect(bosque.pqrs_open).toBe(0);
    expect(bosque.work_orders_open).toBe(0);

    const robles = rows.find((r) => r.organization_name === "Conjunto Los Robles")!;
    expect(robles.role).toBe("owner");
    expect(robles.units_total).toBe(2);
    expect(Number(robles.overdue_total)).toBe(350_000);
    expect(robles.units_overdue).toBe(1);
    // Solo la PQRS abierta cuenta; la cerrada no.
    expect(robles.pqrs_open).toBe(1);
    expect(robles.pqrs_overdue).toBe(1);
    // Solo la orden reportada cuenta; la cancelada no.
    expect(robles.work_orders_open).toBe(1);
  });

  it("no filtra copropiedades ajenas: el owner de orgB solo ve orgB", async () => {
    const rows = await t.as<{ organization_name: string }>(orgB.ownerId, "select * from public.get_portfolio_overview()");
    expect(rows).toHaveLength(1);
    expect(rows[0].organization_name).toBe("Conjunto El Bosque");
  });
});
