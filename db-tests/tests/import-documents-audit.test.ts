import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../helpers/db.js";
import { addMember, createOrgWithOwner, createUnit, isoDate } from "../helpers/fixtures.js";

type ImportResult = {
  dry_run: boolean;
  applied: boolean;
  batch_id: string | null;
  counts: Record<string, number>;
  error_count: number;
  errors: { row: number; message: string }[];
  warnings: { row: number; message: string }[];
  changes: { unit_code: string; field: string }[];
}

const ROWS = [
  { row_number: 2, tower: "Torre 1", unit_code: "t1-101", unit_type: "apartment", area_m2: "72.5", coefficient_pct: "1.25",
    owner_name: "Julián Vargas", owner_document_number: "1.020.300.400", owner_phone: "300 555 0001",
    occupant_name: "Karen Díaz", occupant_phone: "3005550002", occupant_relation: "tenant",
    opening_balance: "450000", opening_balance_date: isoDate(-30) },
  { row_number: 3, tower: "Torre 1", unit_code: "T1-102", unit_type: "apartment", coefficient_pct: "1.25",
    owner_name: "Julián Vargas", owner_document_number: "1020300400" }
];

describe("importación del censo", () => {
  let t: TestDb;
  let org: { orgId: string; ownerId: string };

  beforeAll(async () => {
    t = await createTestDb();
    org = await createOrgWithOwner(t);
  });

  afterAll(async () => {
    await t.close();
  });

  async function runImport(rows: unknown[], dryRun: boolean, userId = org.ownerId): Promise<ImportResult> {
    const [row] = await t.as<{ r: ImportResult }>(userId,
      "select public.import_units_residents($1, $2::jsonb, $3, 'censo.xlsx') as r", [org.orgId, JSON.stringify(rows), dryRun]);
    return row.r;
  }

  it("la simulación reporta lo que haría sin escribir nada", async () => {
    const result = await runImport(ROWS, true);
    expect(result).toMatchObject({ dry_run: true, applied: false, error_count: 0 });
    expect(result.counts).toMatchObject({ units_created: 2, persons_created: 2, relations_created: 3, opening_balances: 1 });
    const [units] = await t.server<{ n: number }>("select count(*)::int as n from public.units where organization_id = $1", [org.orgId]);
    expect(units.n).toBe(0);
  });

  it("importa todo o nada y deduplica personas por documento", async () => {
    const result = await runImport(ROWS, false);
    expect(result.applied).toBe(true);
    const persons = await t.server<{ full_name: string; phone: string }>(
      "select full_name, phone from public.persons where organization_id = $1 order by full_name", [org.orgId]);
    expect(persons).toEqual([
      { full_name: "Julián Vargas", phone: "+573005550001" },
      { full_name: "Karen Díaz", phone: "+573005550002" }
    ]);
    const [statement] = await t.as<{ s: { balance: number } }>(org.ownerId,
      "select public.get_unit_statement(id) as s from public.units where code = 'T1-101'");
    expect(Number(statement.s.balance)).toBe(450_000);
  });

  it("reporta cambios sobre unidades existentes y errores por fila", async () => {
    const result = await runImport([
      { row_number: 2, unit_code: "T1-102", coefficient_pct: "1.5" },
      { row_number: 3, unit_code: "T1-103", unit_type: "castillo" },
      { row_number: 4, unit_code: "T1-104", area_m2: "abc" },
      { row_number: 5, unit_code: "T1-104" },
      { row_number: 6, unit_code: "T1-101", opening_balance: "1000" }
    ], true);
    expect(result.changes).toEqual([expect.objectContaining({ unit_code: "T1-102", field: "coeficiente" })]);
    expect(result.errors.map((e) => e.row)).toEqual([3, 4, 5, 6]);
    expect(result.errors[0].message).toMatch(/tipo de unidad/);
    expect(result.errors[3].message).toMatch(/saldo inicial/);
  });

  it("nunca sobrescribe datos personales existentes: avisa", async () => {
    const result = await runImport([
      { row_number: 2, unit_code: "T1-105", owner_name: "Julian Vargas Otro", owner_document_number: "1020300400", owner_phone: "3119998877" }
    ], true);
    expect(result.warnings.map((w) => w.message).join(" ")).toMatch(/se conserva ese nombre/);
    expect(result.warnings.map((w) => w.message).join(" ")).toMatch(/no se cambió/);
  });

  it("sin permiso de cartera no importa saldos iniciales", async () => {
    const assistant = await addMember(t, org.orgId, "assistant");
    const result = await runImport([{ row_number: 2, unit_code: "T1-200", opening_balance: "1000" }], true, assistant);
    expect(result.errors[0].message).toMatch(/permiso de cartera/);
  });

  it("revierte lo creado por un lote sin movimientos posteriores", async () => {
    const result = await runImport([
      { row_number: 2, tower: "Torre 9", unit_code: "T9-901", owner_name: "Laura Cano", owner_phone: "3150000009", opening_balance: "1000" }
    ], false);
    const [undone] = await t.as<{ r: Record<string, number> }>(org.ownerId,
      "select public.rollback_import_batch($1) as r", [result.batch_id]);
    expect(undone.r).toEqual({ opening_balances: 1, relations: 1, units: 1, persons: 1, towers: 1 });
    await expect(t.as(org.ownerId, "select public.rollback_import_batch($1)", [result.batch_id])).rejects.toThrow(/ALREADY/);
  });

  it("no revierte si hay pagos posteriores", async () => {
    const result = await runImport([{ row_number: 2, unit_code: "T8-801", opening_balance: "5000" }], false);
    const [unit] = await t.server<{ id: string }>("select id from public.units where code = 'T8-801'");
    await t.as(org.ownerId, "select public.register_payment($1, $2, 5000, $3::date, 'cash')", [org.orgId, unit.id, isoDate(0)]);
    await expect(t.as(org.ownerId, "select public.rollback_import_batch($1)", [result.batch_id])).rejects.toThrow(
      /DEPENDENT_DATA/);
  });
});

describe("documentos (RAG)", () => {
  let t: TestDb;
  let org: { orgId: string; ownerId: string };

  beforeAll(async () => {
    t = await createTestDb();
    org = await createOrgWithOwner(t);
    const docs = [
      { title: "Reglamento de propiedad horizontal", visibility: "residents",
        chunks: [["Artículo 25. Mascotas", "Las mascotas deben transitar con traílla por las zonas comunes y sus dueños recogerán sus excrementos."],
                 ["Artículo 30. Ruido", "Está prohibido generar ruido excesivo después de las 10 de la noche."]] },
      { title: "Acta de consejo confidencial", visibility: "staff",
        chunks: [["Punto 3", "Las mascotas del apartamento 502 generan quejas reiteradas."]] }
    ];
    for (const doc of docs) {
      const [row] = await t.server<{ id: string }>(
        "insert into public.documents (organization_id, title, visibility, source_text, status) values ($1, $2, $3, 'x', 'ready') returning id",
        [org.orgId, doc.title, doc.visibility]);
      for (const [index, [heading, content]] of doc.chunks.entries()) {
        await t.server(
          "insert into public.document_chunks (organization_id, document_id, chunk_index, heading, content) values ($1, $2, $3, $4, $5)",
          [org.orgId, row.id, index, heading, content]);
      }
    }
  });

  afterAll(async () => {
    await t.close();
  });

  it("encola la ingesta al crear un documento", async () => {
    const [jobs] = await t.server<{ n: number }>(
      "select count(*)::int as n from public.background_jobs where organization_id = $1 and job_type = 'document_ingest'", [org.orgId]);
    expect(jobs.n).toBe(2);
  });

  it("recupera el fragmento relevante con una pregunta natural", async () => {
    const rows = await t.server<{ heading: string }>(
      "select heading from public.search_document_chunks($1, '¿Puedo sacar a mi perro sin correa? ¿qué pasa con las mascotas?', array['public','residents'], 3)",
      [org.orgId]);
    expect(rows[0].heading).toBe("Artículo 25. Mascotas");
  });

  it("nunca devuelve documentos internos al asistente", async () => {
    const rows = await t.server<{ title: string }>(
      "select title from public.search_document_chunks($1, 'mascotas quejas', array['public','residents'], 5)", [org.orgId]);
    expect(rows.map((r) => r.title)).not.toContain("Acta de consejo confidencial");
  });

  it("una consulta sin términos útiles no devuelve nada", async () => {
    const rows = await t.server("select * from public.search_document_chunks($1, 'y de la el', array['residents'], 5)", [org.orgId]);
    expect(rows).toHaveLength(0);
  });
});

describe("auditoría", () => {
  let t: TestDb;
  let org: { orgId: string; ownerId: string };

  beforeAll(async () => {
    t = await createTestDb();
    org = await createOrgWithOwner(t);
  });

  afterAll(async () => {
    await t.close();
  });

  it("registra quién cambió qué, con valores antes/después, y no expone credenciales", async () => {
    const unit = await createUnit(t, org.orgId, "Z-1", { coefficient: 1 });
    await t.as(org.ownerId, "update public.units set coefficient_pct = 2 where id = $1", [unit]);
    const [event] = await t.server<{ actor_kind: string; actor_user_id: string; before: unknown; after: unknown; changed_fields: string[] }>(
      "select actor_kind, actor_user_id, before, after, changed_fields from public.audit_events where entity_id = $1 and action = 'update'",
      [unit]);
    expect(event).toMatchObject({
      actor_kind: "staff", actor_user_id: org.ownerId, changed_fields: ["coefficient_pct"],
      before: { coefficient_pct: 1 }, after: { coefficient_pct: 2 }
    });

    await t.server(
      "insert into public.integrations (organization_id, provider, status, credentials) values ($1, 'telegram', 'connected', '{\"bot_token\":\"x\"}')",
      [org.orgId]);
    const rows = await t.server<{ after: Record<string, unknown> }>(
      "select after from public.audit_events where entity_type = 'integrations'");
    expect(rows[0].after).not.toHaveProperty("credentials");
  });

  it("marca como 'agent' lo que el asistente hace por el servidor", async () => {
    const [cat] = await t.server<{ id: string }>("select id from public.pqrs_categories where organization_id = $1 limit 1", [org.orgId]);
    const [ticket] = await t.server<{ id: string }>(
      "select id from public.create_pqrs_ticket($1, 'peticion', $2, 'Asunto de prueba', 'Descripción', 'normal', null, null, 'Visitante', null, 'telegram', null, 'agent')",
      [org.orgId, cat.id]);
    const [event] = await t.server<{ actor_kind: string }>(
      "select actor_kind from public.audit_events where entity_id = $1 and action = 'insert'", [ticket.id]);
    expect(event.actor_kind).toBe("agent");
  });

  it("solo roles con audit.read ven la auditoría", async () => {
    const assistant = await addMember(t, org.orgId, "assistant");
    const auditor = await addMember(t, org.orgId, "auditor");
    expect(await t.as(assistant, "select id from public.audit_events")).toHaveLength(0);
    expect((await t.as(auditor, "select id from public.audit_events")).length).toBeGreaterThan(0);
  });

  it("eliminar la copropiedad completa no queda bloqueado por la auditoría ni el guard de owners", async () => {
    await t.as(org.ownerId, "delete from public.organizations where id = $1", [org.orgId]);
    const rows = await t.server("select id from public.organizations where id = $1", [org.orgId]);
    expect(rows).toHaveLength(0);
  });
});
