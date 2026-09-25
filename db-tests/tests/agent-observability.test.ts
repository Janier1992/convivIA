import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../helpers/db.js";
import { addMember, createOrgWithOwner } from "../helpers/fixtures.js";

async function insertTrace(
  t: TestDb,
  orgId: string,
  overrides: Partial<{
    outcome: string;
    tools_used: string[];
    tool_errors: number;
    latency_ms: number;
    model: string;
    channel: string;
    created_at: string;
  }> = {}
) {
  await t.server(
    `insert into public.ai_traces (organization_id, conversation_id, channel, is_preview, rounds, tools_used, tool_errors, outcome, latency_ms, model, created_at)
     values ($1, null, $2, false, 1, $3, $4, $5, $6, $7, coalesce($8::timestamptz, now()))`,
    [
      orgId,
      overrides.channel ?? "telegram",
      overrides.tools_used ?? [],
      overrides.tool_errors ?? 0,
      overrides.outcome ?? "reply",
      overrides.latency_ms ?? 1000,
      overrides.model ?? "gemini-3.8-flash",
      overrides.created_at ?? null
    ]
  );
}

describe("observabilidad del asistente (get_agent_observability / get_platform_agent_observability)", () => {
  let t: TestDb;
  let orgA: { orgId: string; ownerId: string };
  let orgB: { orgId: string; ownerId: string };
  let adminA: string;
  let supportId: string;

  beforeAll(async () => {
    t = await createTestDb();
    orgA = await createOrgWithOwner(t, "Conjunto Los Robles");
    orgB = await createOrgWithOwner(t, "Conjunto El Bosque");
    adminA = await addMember(t, orgA.orgId, "admin");
    supportId = await t.createUser();
    await t.server("insert into public.support_staff (user_id) values ($1)", [supportId]);

    // orgA: 10 turnos -> 6 reply (2 sin herramientas = no fundamentadas), 2 handoff, 1 fallback, 1 error.
    for (let i = 0; i < 4; i++) await insertTrace(t, orgA.orgId, { outcome: "reply", tools_used: ["consultar_estado_cuenta"] });
    await insertTrace(t, orgA.orgId, { outcome: "reply", tools_used: [] });
    await insertTrace(t, orgA.orgId, { outcome: "reply", tools_used: [] });
    await insertTrace(t, orgA.orgId, { outcome: "handoff", tools_used: ["escalar_a_humano"] });
    await insertTrace(t, orgA.orgId, { outcome: "handoff", tools_used: ["escalar_a_humano"] });
    await insertTrace(t, orgA.orgId, { outcome: "fallback" });
    await insertTrace(t, orgA.orgId, { outcome: "error", tool_errors: 1, tools_used: ["consultar_estado_cuenta"] });
    // Una traza en vista previa no debe contar para nada.
    await t.server(
      `insert into public.ai_traces (organization_id, is_preview, rounds, tools_used, tool_errors, outcome, model)
       values ($1, true, 1, '{}', 0, 'reply', 'gemini-3.8-flash')`,
      [orgA.orgId]
    );
    // Una traza vieja (fuera de la ventana de 30 días) no debe contar.
    await insertTrace(t, orgA.orgId, { outcome: "handoff", created_at: "2020-01-01T00:00:00Z" });

    // orgB: 2 turnos, ambos reply fundamentados, con un modelo distinto (simula un cambio de proveedor).
    await insertTrace(t, orgB.orgId, { outcome: "reply", tools_used: ["consultar_estado_cuenta"], model: "gpt-4o-mini" });
    await insertTrace(t, orgB.orgId, { outcome: "reply", tools_used: ["consultar_estado_cuenta"], model: "gpt-4o-mini" });
  });

  afterAll(async () => {
    await t.close();
  });

  interface OrgObservability {
    totals: { turns: number; replies: number; handoffs: number; fallbacks: number; errors: number };
    escalation_rate: string | null;
    groundedness_rate: string | null;
    error_rate: string | null;
    tool_error_rate: string | null;
  }

  interface PlatformObservability {
    totals: { turns: number; organizations: number };
    by_model: { model: string; turns: number }[];
    top_organizations: { organization_name: string; turns: number }[];
  }

  it("calcula tasa de escalamiento, groundedness y error sobre la ventana de días, excluyendo vista previa y trazas viejas", async () => {
    const [row] = await t.as<{ obs: OrgObservability }>(orgA.ownerId, "select public.get_agent_observability($1, 30) as obs", [orgA.orgId]);
    const obs = row.obs;

    expect(obs.totals).toEqual({ turns: 10, replies: 6, handoffs: 2, fallbacks: 1, errors: 1 });
    expect(Number(obs.escalation_rate)).toBeCloseTo(2 / 10, 4);
    expect(Number(obs.groundedness_rate)).toBeCloseTo(4 / 6, 4);
    expect(Number(obs.error_rate)).toBeCloseTo(2 / 10, 4);
    expect(Number(obs.tool_error_rate)).toBeCloseTo(1 / 10, 4);
  });

  it("un rol con agent.manage (admin) puede consultarla; aislada por copropiedad", async () => {
    const [rowA] = await t.as<{ obs: OrgObservability }>(adminA, "select public.get_agent_observability($1, 30) as obs", [orgA.orgId]);
    expect(rowA.obs.totals.turns).toBe(10);

    const [rowB] = await t.as<{ obs: OrgObservability }>(orgB.ownerId, "select public.get_agent_observability($1, 30) as obs", [orgB.orgId]);
    expect(rowB.obs.totals.turns).toBe(2);
  });

  it("un residente no puede ver la observabilidad de otra copropiedad", async () => {
    await expect(t.as(orgB.ownerId, "select public.get_agent_observability($1, 30)", [orgA.orgId])).rejects.toThrow(/FORBIDDEN/);
  });

  it("la vista de plataforma agrega todas las copropiedades y desglosa por modelo (detecta un cambio de proveedor)", async () => {
    const [row] = await t.as<{ obs: PlatformObservability }>(supportId, "select public.get_platform_agent_observability(30) as obs");
    const obs = row.obs;

    expect(obs.totals.turns).toBe(12);
    expect(obs.totals.organizations).toBe(2);
    const byModel = Object.fromEntries(obs.by_model.map((m) => [m.model, m.turns]));
    expect(byModel["gemini-3.8-flash"]).toBe(10);
    expect(byModel["gpt-4o-mini"]).toBe(2);
    const orgNames = obs.top_organizations.map((o) => o.organization_name).sort();
    expect(orgNames).toEqual(["Conjunto El Bosque", "Conjunto Los Robles"]);
  });

  it("solo soporte ve la observabilidad de plataforma", async () => {
    await expect(t.as(orgA.ownerId, "select public.get_platform_agent_observability(30)")).rejects.toThrow(/FORBIDDEN/);
  });
});
