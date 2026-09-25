import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../helpers/db.js";
import { createOrgWithOwner, isoDate } from "../helpers/fixtures.js";

describe("IA para administradores: mantenimientos pendientes y resumen de acta", () => {
  let t: TestDb;
  let orgA: { orgId: string; ownerId: string };
  let orgB: { orgId: string; ownerId: string };

  beforeAll(async () => {
    t = await createTestDb();
    orgA = await createOrgWithOwner(t, "Conjunto Los Robles");
    orgB = await createOrgWithOwner(t, "Conjunto El Bosque");
  });

  afterAll(async () => {
    await t.close();
  });

  describe("get_maintenance_priority_brief", () => {
    it("agrupa cronogramas vencidos/próximos y órdenes esperando una decisión", async () => {
      const [asset] = await t.as<{ id: string }>(orgA.ownerId, "select * from public.create_asset($1, 'Ascensor torre 1', 'elevator')", [
        orgA.orgId
      ]);

      // Cronograma vencido y uno próximo (dentro de 7 días).
      await t.as(orgA.ownerId, "select public.create_maintenance_schedule($1, 'Revisión mensual', 1, $2, $3)", [
        orgA.orgId,
        isoDate(-5),
        asset.id
      ]);
      await t.as(orgA.ownerId, "select public.create_maintenance_schedule($1, 'Revisión de motor', 3, $2, $3)", [
        orgA.orgId,
        isoDate(3),
        asset.id
      ]);

      // Una orden esperando aprobación.
      const [woApproval] = await t.as<{ id: string }>(
        orgA.ownerId,
        "select * from public.create_work_order($1, 'Bomba con fuga', 'Fuga visible en la base.')",
        [orgA.orgId]
      );
      await t.as(orgA.ownerId, "select public.diagnose_work_order($1, 'Empaque desgastado, requiere cambio.')", [woApproval.id]);

      // Una orden esperando validación (recorre el flujo completo hasta evidencia).
      const [woValidation] = await t.as<{ id: string }>(
        orgA.ownerId,
        "select * from public.create_work_order($1, 'Portón trabado', 'No cierra del todo.')",
        [orgA.orgId]
      );
      await t.as(orgA.ownerId, "select public.diagnose_work_order($1, 'Motorreductor sin lubricar.')", [woValidation.id]);
      await t.as(orgA.ownerId, "select public.approve_work_order($1, true)", [woValidation.id]);
      await t.as(orgA.ownerId, "select public.assign_work_order($1, null, $2)", [woValidation.id, orgA.ownerId]);
      await t.as(orgA.ownerId, "select public.start_work_order($1)", [woValidation.id]);
      await t.as(orgA.ownerId, "select public.add_work_order_evidence($1, 'Se lubricó el motorreductor.')", [woValidation.id]);

      // Una orden urgente y abierta (recién reportada).
      await t.as(orgA.ownerId, "select public.create_work_order($1, 'Fuga de gas', 'Olor a gas en el sótano.', 'urgent')", [orgA.orgId]);

      const [row] = await t.as<{
        brief: {
          cronogramas_vencidos: { titulo: string; activo: string }[];
          cronogramas_proximos: { titulo: string }[];
          ordenes_esperando_aprobacion: { codigo: string }[];
          ordenes_esperando_validacion: { codigo: string }[];
          ordenes_urgentes_abiertas: { titulo: string }[];
        };
      }>(orgA.ownerId, "select public.get_maintenance_priority_brief($1) as brief", [orgA.orgId]);

      expect(row.brief.cronogramas_vencidos).toHaveLength(1);
      expect(row.brief.cronogramas_vencidos[0]).toMatchObject({ titulo: "Revisión mensual", activo: "Ascensor torre 1" });
      expect(row.brief.cronogramas_proximos).toHaveLength(1);
      expect(row.brief.ordenes_esperando_aprobacion).toHaveLength(1);
      expect(row.brief.ordenes_esperando_validacion).toHaveLength(1);
      expect(row.brief.ordenes_urgentes_abiertas).toHaveLength(1);
      expect(row.brief.ordenes_urgentes_abiertas[0].titulo).toBe("Fuga de gas");
    });

    it("no filtra mantenimiento de otra copropiedad", async () => {
      const [row] = await t.as<{ brief: { cronogramas_vencidos: unknown[] } }>(
        orgB.ownerId,
        "select public.get_maintenance_priority_brief($1) as brief",
        [orgB.orgId]
      );
      expect(row.brief.cronogramas_vencidos).toEqual([]);
      await expect(t.as(orgB.ownerId, "select public.get_maintenance_priority_brief($1)", [orgA.orgId])).rejects.toThrow(/FORBIDDEN/);
    });
  });

  describe("get_latest_assembly_minutes", () => {
    it("dice que no hay actas todavía si ninguna asamblea tiene una vinculada", async () => {
      const [row] = await t.as<{ minutes: { found: boolean } }>(orgB.ownerId, "select public.get_latest_assembly_minutes($1) as minutes", [
        orgB.orgId
      ]);
      expect(row.minutes.found).toBe(false);
    });

    it("trae el texto del acta más reciente (texto pegado directo en el documento)", async () => {
      const [assembly] = await t.as<{ id: string }>(
        orgA.ownerId,
        "select * from public.create_assembly($1, 'Asamblea ordinaria 2026', $2, 'ordinaria', 'Salón social')",
        [orgA.orgId, "2026-03-15T14:00:00-05:00"]
      );
      const [doc] = await t.server<{ id: string }>(
        `insert into public.documents (organization_id, title, doc_type, source_text, status)
         values ($1, 'Acta asamblea ordinaria 2026', 'assembly_minutes', $2, 'ready') returning id`,
        [orgA.orgId, "Se aprobó el presupuesto 2026 y se autorizó la impermeabilización de la terraza."]
      );
      await t.as(orgA.ownerId, "select public.set_assembly_minutes($1, $2)", [assembly.id, doc.id]);

      const [row] = await t.as<{
        minutes: { found: boolean; assembly: { title: string }; document: { title: string }; full_text: string };
      }>(orgA.ownerId, "select public.get_latest_assembly_minutes($1) as minutes", [orgA.orgId]);

      expect(row.minutes.found).toBe(true);
      expect(row.minutes.assembly.title).toBe("Asamblea ordinaria 2026");
      expect(row.minutes.document.title).toBe("Acta asamblea ordinaria 2026");
      expect(row.minutes.full_text).toContain("impermeabilización de la terraza");
    });

    it("si el documento no tiene texto pegado, arma el texto a partir de sus chunks", async () => {
      const [assembly] = await t.as<{ id: string }>(
        orgB.ownerId,
        "select * from public.create_assembly($1, 'Asamblea extraordinaria', $2, 'extraordinaria', 'Zoom')",
        [orgB.orgId, "2026-04-01T18:00:00-05:00"]
      );
      const [doc] = await t.server<{ id: string }>(
        `insert into public.documents (organization_id, title, doc_type, storage_key, status)
         values ($1, 'Acta extraordinaria', 'assembly_minutes', 'documents/acta-extraordinaria.pdf', 'ready') returning id`,
        [orgB.orgId]
      );
      await t.server(
        `insert into public.document_chunks (organization_id, document_id, chunk_index, content) values
         ($1, $2, 0, 'Primera parte del acta: quórum verificado.'),
         ($1, $2, 1, 'Segunda parte: se aprobó contratar vigilancia privada.')`,
        [orgB.orgId, doc.id]
      );
      await t.as(orgB.ownerId, "select public.set_assembly_minutes($1, $2)", [assembly.id, doc.id]);

      const [row] = await t.as<{ minutes: { full_text: string } }>(orgB.ownerId, "select public.get_latest_assembly_minutes($1) as minutes", [
        orgB.orgId
      ]);
      expect(row.minutes.full_text).toContain("quórum verificado");
      expect(row.minutes.full_text).toContain("contratar vigilancia privada");
    });

    it("no filtra el acta de otra copropiedad", async () => {
      await expect(t.as(orgB.ownerId, "select public.get_latest_assembly_minutes($1)", [orgA.orgId])).rejects.toThrow(/FORBIDDEN/);
    });
  });
});
