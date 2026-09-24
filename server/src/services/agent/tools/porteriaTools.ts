import { z } from "zod";
import { fromZonedTime } from "date-fns-tz";
import { insforgeAdmin } from "../../../lib/insforge.js";
import { formatDateTimeInZone } from "../../../lib/format.js";
import { AppError, ErrorCodes } from "../../../utils/AppError.js";
import { proposeAction } from "../pendingActions.js";
import { resolveOwnUnit } from "../unitResolver.js";
import { fail, ok, requireIdentity, structuredMeta, toToolResult, type ToolDefinition } from "../toolTypes.js";

const DATETIME = z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/));

function toIso(value: string, timezone: string): string {
  return value.includes("T") && !/[zZ]|[+-]\d{2}:\d{2}$/.test(value) ? fromZonedTime(value, timezone).toISOString() : new Date(value).toISOString();
}

const autorizacionSchema = z.object({
  visitante: z.string().min(2).max(120),
  desde: DATETIME,
  hasta: DATETIME,
  unidad: z.string().max(40).optional(),
  documento: z.string().max(40).optional(),
  telefono: z.string().max(30).optional(),
  placa: z.string().max(10).optional(),
  notas: z.string().max(300).optional()
});

const proponerAutorizacionVisitante: ToolDefinition<z.infer<typeof autorizacionSchema>> = {
  name: "proponer_autorizacion_visitante",
  description:
    "Prepara una preautorización de visitante para que portería lo deje pasar sin llamar a la unidad (ej. 'mañana a las 3pm " +
    "me visita Juan Pérez'). No es el registro real de ingreso, solo la autoriza. Requiere confirmación con confirmar_accion.",
  parameters: {
    type: "object",
    properties: {
      visitante: { type: "string", description: "Nombre completo de quien va a visitar." },
      desde: { type: "string", description: "Inicio de la ventana permitida, YYYY-MM-DDTHH:mm en hora local de la copropiedad." },
      hasta: { type: "string", description: "Fin de la ventana permitida, mismo formato. Máximo 30 días después de 'desde'." },
      unidad: { type: "string", description: "Código de la unidad. Omitir si la persona tiene una sola." },
      documento: { type: "string", description: "Cédula del visitante, si la da el residente." },
      telefono: { type: "string", description: "Teléfono del visitante, si lo da el residente." },
      placa: { type: "string", description: "Placa del vehículo del visitante, si aplica." },
      notas: { type: "string", description: "Detalle adicional para portería." }
    },
    required: ["visitante", "desde", "hasta"]
  },
  schema: autorizacionSchema,
  access: "verified",
  capability: "visitors",
  execute: (args, ctx) =>
    toToolResult(async () => {
      const identity = requireIdentity(ctx);
      const unit = resolveOwnUnit(identity, args.unidad, "any");
      const validFrom = toIso(args.desde, ctx.timezone);
      const validUntil = toIso(args.hasta, ctx.timezone);
      if (new Date(validUntil).getTime() <= new Date(validFrom).getTime()) {
        return fail(ErrorCodes.VALIDATION_ERROR, "La hora de fin debe ser posterior a la de inicio.");
      }
      const summary =
        `Autorizar el ingreso de ${args.visitante} para la unidad ${unit.code}, entre ${formatDateTimeInZone(validFrom, ctx.timezone)} ` +
        `y ${formatDateTimeInZone(validUntil, ctx.timezone)}${args.placa ? ` (vehículo placa ${args.placa.toUpperCase()})` : ""}.`;
      return proposeAction(
        ctx,
        "create_visitor_authorization",
        {
          unit_id: unit.unit_id,
          visitor_name: args.visitante,
          valid_from: validFrom,
          valid_until: validUntil,
          visitor_document: args.documento ?? null,
          visitor_phone: args.telefono ?? null,
          vehicle_plate: args.placa ?? null,
          notes: args.notas ?? null,
          requested_by_person_id: identity.personId
        },
        summary
      );
    })
};

interface AuthorizationRow {
  id: string;
  visitor_name: string;
  status: string;
  valid_from: string;
  valid_until: string;
  vehicle_plate: string | null;
}

const consultarVisitantesHoy: ToolDefinition<Record<string, unknown>> = {
  name: "consultar_visitantes_hoy",
  description: "Preautorizaciones de visitantes vigentes o próximas (próximos 3 días) de las unidades del residente, con su estado.",
  parameters: { type: "object", properties: {} },
  schema: z.object({}).passthrough(),
  access: "verified",
  capability: "visitors",
  execute: (_args, ctx) =>
    toToolResult(async () => {
      const identity = requireIdentity(ctx);
      const until = new Date(ctx.now.getTime() + 3 * 24 * 60 * 60_000).toISOString();
      const { data, error } = await insforgeAdmin.database
        .from("visitor_authorizations")
        .select("id, unit_id, visitor_name, status, valid_from, valid_until, vehicle_plate")
        .eq("organization_id", ctx.organizationId)
        .in("unit_id", identity.units.map((u) => u.unit_id))
        .in("status", ["pending", "used"])
        .lte("valid_from", until)
        .order("valid_from", { ascending: true })
        .limit(15);
      if (error) throw new AppError(ErrorCodes.INTERNAL_ERROR, "No se pudieron consultar las autorizaciones.", 500);
      const rows = (data ?? []) as unknown as (AuthorizationRow & { unit_id: string })[];
      return ok(
        rows.map((r) => ({
          visitante: r.visitor_name,
          unidad: identity.units.find((u) => u.unit_id === r.unit_id)?.code,
          estado: r.status === "used" ? "ya ingresó" : "autorizado, pendiente de ingreso",
          desde: formatDateTimeInZone(r.valid_from, ctx.timezone),
          hasta: formatDateTimeInZone(r.valid_until, ctx.timezone),
          placa: r.vehicle_plate
        })),
        structuredMeta("Autorizaciones de visitantes", ctx.now)
      );
    })
};

interface PackageRow {
  id: string;
  unit_id: string;
  courier: string | null;
  description: string | null;
  status: string;
  received_at: string;
}

const consultarMisPaquetes: ToolDefinition<Record<string, unknown>> = {
  name: "consultar_mis_paquetes",
  description: "Paquetes o domicilios recibidos en portería para las unidades del residente que todavía no se han entregado.",
  parameters: { type: "object", properties: {} },
  schema: z.object({}).passthrough(),
  access: "verified",
  capability: "visitors",
  execute: (_args, ctx) =>
    toToolResult(async () => {
      const identity = requireIdentity(ctx);
      const { data, error } = await insforgeAdmin.database
        .from("packages")
        .select("id, unit_id, courier, description, status, received_at")
        .eq("organization_id", ctx.organizationId)
        .in("unit_id", identity.units.map((u) => u.unit_id))
        .eq("status", "received")
        .order("received_at", { ascending: false })
        .limit(20);
      if (error) throw new AppError(ErrorCodes.INTERNAL_ERROR, "No se pudieron consultar los paquetes.", 500);
      const rows = (data ?? []) as unknown as PackageRow[];
      if (rows.length === 0) return ok({ mensaje: "No hay paquetes pendientes de reclamar." }, structuredMeta("Paquetes de portería", ctx.now));
      return ok(
        rows.map((r) => ({
          unidad: identity.units.find((u) => u.unit_id === r.unit_id)?.code,
          transportadora: r.courier,
          descripcion: r.description,
          recibido: formatDateTimeInZone(r.received_at, ctx.timezone)
        })),
        structuredMeta("Paquetes de portería", ctx.now)
      );
    })
};

export const PORTERIA_TOOLS = [proponerAutorizacionVisitante, consultarVisitantesHoy, consultarMisPaquetes] as ToolDefinition[];
