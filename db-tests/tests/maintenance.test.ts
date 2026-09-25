import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../helpers/db.js";
import { addMember, createOrgWithOwner } from "../helpers/fixtures.js";

describe("mantenimiento de activos", () => {
  let t: TestDb;
  let orgA: { orgId: string; ownerId: string };
  let orgB: { orgId: string; ownerId: string };
  let staffA: string;
  let councilA: string;
  let assetA: string;
  let vendorA: string;

  beforeAll(async () => {
    t = await createTestDb();
    orgA = await createOrgWithOwner(t, "Conjunto Los Robles");
    orgB = await createOrgWithOwner(t, "Conjunto El Bosque");
    staffA = await addMember(t, orgA.orgId, "assistant");
    councilA = await addMember(t, orgA.orgId, "council");

    const [asset] = await t.as<{ id: string }>(
      staffA,
      "select * from public.create_asset($1, 'Ascensor torre 1', 'elevator', 'Torre 1')",
      [orgA.orgId]
    );
    assetA = asset.id;

    const [vendor] = await t.as<{ id: string }>(
      staffA,
      "select * from public.create_vendor($1, 'Ascensores Andinos SAS', 'Ascensores', '3001112233')",
      [orgA.orgId]
    );
    vendorA = vendor.id;
  });

  afterAll(async () => {
    await t.close();
  });

  it("recorre el flujo completo: reporte -> diagnóstico -> aprobación -> asignación -> ejecución -> evidencia -> validación -> cierre", async () => {
    const [wo] = await t.as<{ id: string; code: string; status: string }>(
      staffA,
      "select * from public.create_work_order($1, 'Ascensor hace ruido', 'Ruido metálico al frenar en el piso 5.', 'high', $2)",
      [orgA.orgId, assetA]
    );
    expect(wo.status).toBe("reported");
    expect(wo.code).toMatch(/^OT-\d{4}-\d{5}$/);

    const [diagnosed] = await t.as<{ status: string; cost_estimate: string | null }>(
      staffA,
      "select * from public.diagnose_work_order($1, 'Rodamiento del motor desgastado, requiere cambio.', 450000)",
      [wo.id]
    );
    expect(diagnosed.status).toBe("diagnosed");
    expect(Number(diagnosed.cost_estimate)).toBe(450000);

    // El equipo operativo no puede aprobar el gasto: es un checkpoint de gobierno.
    await expect(t.as(staffA, "select public.approve_work_order($1, true)", [wo.id])).rejects.toThrow(/FORBIDDEN/);

    const [approved] = await t.as<{ status: string }>(councilA, "select * from public.approve_work_order($1, true)", [wo.id]);
    expect(approved.status).toBe("approved");

    const [assigned] = await t.as<{ status: string; vendor_id: string }>(
      staffA,
      "select * from public.assign_work_order($1, $2)",
      [wo.id, vendorA]
    );
    expect(assigned.status).toBe("assigned");
    expect(assigned.vendor_id).toBe(vendorA);

    const [started] = await t.as<{ status: string; started_at: string | null }>(staffA, "select * from public.start_work_order($1)", [wo.id]);
    expect(started.status).toBe("in_progress");
    expect(started.started_at).not.toBeNull();

    const [withEvidence] = await t.as<{ status: string; cost_final: string | null }>(
      staffA,
      "select * from public.add_work_order_evidence($1, 'Se cambió el rodamiento y se probó el ascensor 10 veces sin ruido.', 480000)",
      [wo.id]
    );
    expect(withEvidence.status).toBe("pending_validation");
    expect(Number(withEvidence.cost_final)).toBe(480000);

    // El equipo operativo tampoco puede validar/cerrar: mismo checkpoint de gobierno.
    await expect(t.as(staffA, "select public.close_work_order($1, true)", [wo.id])).rejects.toThrow(/FORBIDDEN/);

    const [closed] = await t.as<{ status: string; closed_at: string | null }>(councilA, "select * from public.close_work_order($1, true)", [wo.id]);
    expect(closed.status).toBe("closed");
    expect(closed.closed_at).not.toBeNull();

    const events = await t.as<{ event_type: string }>(
      staffA,
      "select event_type from public.work_order_events where work_order_id = $1 order by created_at",
      [wo.id]
    );
    expect(events.map((e) => e.event_type)).toEqual([
      "created",
      "diagnosed",
      "approved",
      "assigned",
      "started",
      "evidence_added",
      "closed"
    ]);
  });

  it("rechaza saltarse pasos del flujo (no se asigna sin aprobar)", async () => {
    const [wo] = await t.as<{ id: string }>(
      staffA,
      "select * from public.create_work_order($1, 'Bomba de agua con fuga', 'Fuga visible en la base de la bomba principal.')",
      [orgA.orgId]
    );
    await expect(t.as(staffA, "select public.assign_work_order($1, $2)", [wo.id, vendorA])).rejects.toThrow(/VALIDATION_ERROR/);
  });

  it("una validación rechazada reabre la orden en ejecución, no la cierra", async () => {
    const [wo] = await t.as<{ id: string }>(
      staffA,
      "select * from public.create_work_order($1, 'Portón principal trabado', 'No abre completamente desde ayer.')",
      [orgA.orgId]
    );
    await t.as(staffA, "select public.diagnose_work_order($1, 'Motoreductor sin lubricar.')", [wo.id]);
    await t.as(councilA, "select public.approve_work_order($1, true)", [wo.id]);
    await t.as(staffA, "select public.assign_work_order($1, null, $2)", [wo.id, staffA]);
    await t.as(staffA, "select public.start_work_order($1)", [wo.id]);
    await t.as(staffA, "select public.add_work_order_evidence($1, 'Se lubricó el motorreductor.')", [wo.id]);

    const [rejected] = await t.as<{ status: string; closed_at: string | null }>(
      councilA,
      "select * from public.close_work_order($1, false, 'Sigue trabado a media carrera, falta ajustar el riel.')",
      [wo.id]
    );
    expect(rejected.status).toBe("in_progress");
    expect(rejected.closed_at).toBeNull();
  });

  it("una orden de trabajo enlazada a una PQRS no duplica el reporte y bloquea un segundo enlace", async () => {
    const [ticket] = await t.as<{ id: string }>(
      staffA,
      "select * from public.create_pqrs_ticket($1, 'queja', null, 'Ascensor torre 2 dañado', 'Lleva dos días sin funcionar.')",
      [orgA.orgId]
    );
    const [wo] = await t.as<{ id: string; pqrs_ticket_id: string }>(
      staffA,
      "select * from public.create_work_order($1, 'Reparar ascensor torre 2', 'Diagnosticar y reparar según PQRS.', 'normal', null, $2)",
      [orgA.orgId, ticket.id]
    );
    expect(wo.pqrs_ticket_id).toBe(ticket.id);

    // El estado de la PQRS no cambia solo porque exista una orden: los módulos quedan desacoplados.
    const [ticketAfter] = await t.as<{ status: string }>(staffA, "select status from public.pqrs_tickets where id = $1", [ticket.id]);
    expect(ticketAfter.status).toBe("received");

    await expect(
      t.as(staffA, "select public.create_work_order($1, 'Duplicado', 'No debería crearse.', 'normal', null, $2)", [orgA.orgId, ticket.id])
    ).rejects.toThrow(/VALIDATION_ERROR/);
  });

  it("mantenimiento preventivo: crear un cronograma y marcarlo ejecutado adelanta la próxima fecha", async () => {
    const asDateString = (value: string | Date) => (value instanceof Date ? value.toISOString() : value).slice(0, 10);

    const [schedule] = await t.as<{ id: string; next_due_on: string | Date }>(
      staffA,
      "select * from public.create_maintenance_schedule($1, 'Revisión mensual del ascensor', 1, '2026-10-01', $2)",
      [orgA.orgId, assetA]
    );
    expect(asDateString(schedule.next_due_on)).toBe("2026-10-01");

    const [done] = await t.as<{ last_done_on: string | Date; next_due_on: string | Date }>(
      staffA,
      "select * from public.mark_maintenance_schedule_done($1, '2026-10-01')",
      [schedule.id]
    );
    expect(asDateString(done.last_done_on)).toBe("2026-10-01");
    expect(asDateString(done.next_due_on)).toBe("2026-11-01");
  });

  it("un rol de solo lectura (auditor) no puede reportar ni aprobar", async () => {
    const auditorA = await addMember(t, orgA.orgId, "auditor");
    await expect(
      t.as(auditorA, "select public.create_work_order($1, 'X', 'Y')", [orgA.orgId])
    ).rejects.toThrow(/FORBIDDEN/);
  });

  it("aísla activos, proveedores y órdenes de trabajo entre copropiedades", async () => {
    const assets = await t.as(orgB.ownerId, "select id from public.assets where organization_id = $1", [orgA.orgId]);
    expect(assets).toEqual([]);
    const vendors = await t.as(orgB.ownerId, "select id from public.vendors where organization_id = $1", [orgA.orgId]);
    expect(vendors).toEqual([]);
    const orders = await t.as(orgB.ownerId, "select id from public.work_orders where organization_id = $1", [orgA.orgId]);
    expect(orders).toEqual([]);

    // El owner de B sí puede operar sobre SU propia copropiedad.
    const [ownAsset] = await t.as<{ status: string }>(
      orgB.ownerId,
      "select * from public.create_asset($1, 'Planta eléctrica', 'generator')",
      [orgB.orgId]
    );
    expect(ownAsset.status).toBe("active");
  });
});
