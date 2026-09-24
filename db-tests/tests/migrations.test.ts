import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, migrationFiles, type TestDb } from "../helpers/db.js";

// RPCs que el panel (rol authenticated) puede ejecutar. Cualquier función
// nueva expuesta sin estar en esta lista hace fallar el test: evita
// publicar por accidente funciones internas del compute service
// (claim_outbound_messages, enqueue_payment_reminders, ...).
const AUTHENTICATED_ALLOWLIST = [
  "accept_organization_invite", "book_area_reservation", "cancel_area_reservation", "create_manual_charge",
  "create_organization_with_owner", "create_pqrs_ticket", "current_user_email", "decide_area_reservation",
  "enqueue_preview_message", "generate_interest_charges", "generate_monthly_charges", "get_admin_dashboard",
  "get_announcement_delivery", "get_area_slots", "get_channel_status", "get_my_permissions", "get_portfolio",
  "get_support_overview", "get_team_members", "get_unit_statement", "get_user_organization_ids",
  "has_org_permission", "has_permission_for_storage_key", "import_units_residents", "is_org_member",
  "is_org_owner", "is_support_admin", "is_support_staff", "normalize_phone", "org_today",
  "preview_interest_charges", "preview_monthly_charges", "register_payment", "reprocess_document",
  "respond_pqrs_ticket", "reverse_payment", "review_payment", "rollback_import_batch",
  "search_document_chunks", "send_announcement", "send_staff_reply", "set_area_reservation_status",
  "set_conversation_status", "update_pqrs_ticket", "void_charge"
].sort();

// Las funciones internas de extensiones (soporte GiST de btree_gist) no
// son RPCs de negocio.
const NOT_EXTENSION_MEMBER =
  "not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')";

describe("migraciones", () => {
  let t: TestDb;

  beforeAll(async () => {
    t = await createTestDb();
  });

  afterAll(async () => {
    await t.close();
  });

  it("los nombres de archivo cumplen el formato del CLI de InsForge", () => {
    for (const file of migrationFiles()) {
      expect(file).toMatch(/^\d{14}_[a-z0-9]+(-[a-z0-9]+)*\.sql$/);
    }
  });

  it("todas las tablas del esquema público tienen RLS activo", async () => {
    const rows = await t.server<{ relname: string }>(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`
    );
    expect(rows.map((r) => r.relname)).toEqual([]);
  });

  it("anon no puede ejecutar ninguna función del esquema público", async () => {
    const rows = await t.server<{ proname: string }>(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')
         and ${NOT_EXTENSION_MEMBER}`
    );
    expect(rows.map((r) => r.proname)).toEqual([]);
  });

  it("anon no tiene privilegios sobre ninguna tabla pública", async () => {
    const rows = await t.server<{ relname: string }>(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r'
         and (has_table_privilege('anon', c.oid, 'select') or has_table_privilege('anon', c.oid, 'insert'))`
    );
    expect(rows.map((r) => r.relname)).toEqual([]);
  });

  it("authenticated solo ejecuta las funciones de la lista permitida", async () => {
    const rows = await t.server<{ proname: string }>(
      `select distinct p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute')
         and ${NOT_EXTENSION_MEMBER}
       order by p.proname`
    );
    expect(rows.map((r) => r.proname)).toEqual(AUTHENTICATED_ALLOWLIST);
  });

  it("anon no lee datos aunque existan", async () => {
    await expect(t.anon("select count(*) from public.organizations")).rejects.toThrow(/permission denied/);
  });
});
