import { z } from "zod";
import { addMinutes } from "date-fns";
import { fromZonedTime } from "date-fns-tz";
import { insforgeAdmin } from "../../../lib/insforge.js";
import { formatCop, formatDateTimeInZone, formatDateYmd, formatTimeInZone, reservationStatusLabel } from "../../../lib/format.js";
import { findByIdOrName } from "../../../lib/text.js";
import { AppError, ErrorCodes, toAppError } from "../../../utils/AppError.js";
import type { CommonAreaSummary } from "../../../types/domain.js";
import { proposeAction } from "../pendingActions.js";
import { resolveOwnUnit } from "../unitResolver.js";
import { fail, ok, requireIdentity, structuredMeta, toToolResult, type ToolContext, type ToolDefinition } from "../toolTypes.js";

interface SlotRow {
  start_at: string;
  end_at: string;
  available: boolean;
  remaining_capacity: number;
}

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "fecha debe tener formato YYYY-MM-DD");

function resolveArea(ctx: ToolContext, query: string): CommonAreaSummary {
  const area = findByIdOrName(ctx.areas, query);
  if (!area) {
    throw new AppError(ErrorCodes.AREA_NOT_FOUND, `No reconozco esa zona. Zonas reservables: ${ctx.areas.map((a) => a.name).join(", ") || "ninguna"}.`, 404);
  }
  return area;
}

async function loadSlots(areaId: string, date: string, durationMinutes: number | undefined): Promise<SlotRow[]> {
  const { data, error } = await insforgeAdmin.database.rpc("get_area_slots", {
    p_area_id: areaId,
    p_date: date,
    p_duration_minutes: durationMinutes ?? null
  });
  if (error) throw toAppError(error, "No se pudo consultar la disponibilidad.");
  return (data ?? []) as SlotRow[];
}

const disponibilidadSchema = z.object({
  zona: z.string().min(2).max(80),
  fecha: DATE,
  duracion_minutos: z.number().int().min(15).max(1440).optional()
});

const consultarDisponibilidadZona: ToolDefinition<z.infer<typeof disponibilidadSchema>> = {
  name: "consultar_disponibilidad_zona",
  description:
    "Franjas disponibles de una zona común en una fecha, según horario, reservas existentes, aforo y anticipación. " +
    "SIEMPRE llámala antes de proponer una reserva; solo se puede reservar en las franjas que devuelve.",
  parameters: {
    type: "object",
    properties: {
      zona: { type: "string", description: "Nombre o id de la zona común." },
      fecha: { type: "string", description: "Fecha YYYY-MM-DD en la zona horaria de la copropiedad." },
      duracion_minutos: { type: "number", description: "Duración deseada; por defecto la mínima de la zona." }
    },
    required: ["zona", "fecha"]
  },
  schema: disponibilidadSchema,
  access: "verified",
  capability: "reservations",
  execute: (args, ctx) =>
    toToolResult(async () => {
      requireIdentity(ctx);
      const area = resolveArea(ctx, args.zona);
      const slots = await loadSlots(area.id, args.fecha, args.duracion_minutos);
      const available = slots.filter((s) => s.available);
      const reason =
        slots.length === 0
          ? "La zona no abre ese día."
          : available.length === 0
            ? `No hay franjas libres (ocupadas o fuera de la anticipación permitida: mínimo ${area.advance_min_hours} h y máximo ${area.advance_max_days} días).`
            : undefined;
      return ok(
        {
          zona: area.name,
          fecha: formatDateYmd(args.fecha),
          duracion_minutos: args.duracion_minutos ?? area.min_duration_minutes,
          franjas_disponibles: available.slice(0, 24).map((s) => ({
            hora_inicio: formatTimeInZone(s.start_at, ctx.timezone),
            hora_fin: formatTimeInZone(s.end_at, ctx.timezone),
            cupos: area.booking_mode === "shared" ? s.remaining_capacity : undefined
          })),
          motivo_sin_disponibilidad: reason
        },
        { tipo_dato: "CALCULO", fuente: `Motor de reservas: ${area.name}`, fecha_datos: ctx.now.toISOString() }
      );
    })
};

const reservaSchema = z.object({
  zona: z.string().min(2).max(80),
  fecha: DATE,
  hora_inicio: z.string().regex(/^\d{2}:\d{2}$/, "hora_inicio debe tener formato HH:mm"),
  duracion_minutos: z.number().int().min(15).max(1440),
  unidad: z.string().max(40).optional(),
  invitados: z.number().int().min(1).max(500).optional(),
  notas: z.string().max(300).optional()
});

const proponerReservaZona: ToolDefinition<z.infer<typeof reservaSchema>> = {
  name: "proponer_reserva_zona",
  description:
    "Prepara la reserva de una zona común en una franja devuelta por consultar_disponibilidad_zona. Calcula tarifa y " +
    "depósito según la configuración. Requiere confirmación posterior con confirmar_accion.",
  parameters: {
    type: "object",
    properties: {
      zona: { type: "string" },
      fecha: { type: "string", description: "YYYY-MM-DD" },
      hora_inicio: { type: "string", description: "HH:mm (24 h), una hora_inicio disponible." },
      duracion_minutos: { type: "number" },
      unidad: { type: "string", description: "Código de la unidad que reserva. Omitir si tiene una sola." },
      invitados: { type: "number", description: "Cantidad de personas, incluido el residente." },
      notas: { type: "string", description: "Motivo o detalles (ej. cumpleaños)." }
    },
    required: ["zona", "fecha", "hora_inicio", "duracion_minutos"]
  },
  schema: reservaSchema,
  access: "verified",
  capability: "reservations",
  execute: (args, ctx) =>
    toToolResult(async () => {
      const identity = requireIdentity(ctx);
      const unit = resolveOwnUnit(identity, args.unidad, "booking");
      const area = resolveArea(ctx, args.zona);
      if (args.duracion_minutos < area.min_duration_minutes || args.duracion_minutos > area.max_duration_minutes) {
        return fail("RESERVATION_INVALID_DURATION",
          `La duración debe estar entre ${area.min_duration_minutes} y ${area.max_duration_minutes} minutos.`);
      }
      const guests = args.invitados ?? 1;
      const maxGuests = area.booking_mode === "shared" ? area.capacity : area.max_guests;
      if (maxGuests && guests > maxGuests) {
        return fail("GUESTS_EXCEED_CAPACITY", `El máximo para ${area.name} es ${maxGuests} personas.`);
      }

      const start = fromZonedTime(`${args.fecha}T${args.hora_inicio}:00`, ctx.timezone);
      const end = addMinutes(start, args.duracion_minutos);
      const slots = await loadSlots(area.id, args.fecha, args.duracion_minutos);
      const slot = slots.find((s) => new Date(s.start_at).getTime() === start.getTime());
      if (!slot || !slot.available || (area.booking_mode === "shared" && slot.remaining_capacity < guests)) {
        return fail("AREA_NOT_AVAILABLE", "Esa franja no está disponible. Consulta de nuevo la disponibilidad y ofrece las franjas libres.");
      }

      const fee = Number(area.fee_amount);
      const deposit = Number(area.deposit_amount);
      const summary =
        `Reservar ${area.name} el ${formatDateYmd(args.fecha)} de ${args.hora_inicio} a ${formatTimeInZone(end.toISOString(), ctx.timezone)} ` +
        `para la unidad ${unit.code} (${guests} ${guests === 1 ? "persona" : "personas"}).` +
        (fee > 0 ? ` Tarifa ${formatCop(fee)}, que se carga a la cuenta de la unidad.` : " Sin costo.") +
        (deposit > 0 ? ` Depósito ${formatCop(deposit)} según el reglamento.` : "") +
        (area.requires_approval ? " Queda pendiente de aprobación de la administración." : " Queda confirmada de inmediato.");
      return proposeAction(
        ctx,
        "book_area",
        {
          area_id: area.id,
          area_name: area.name,
          unit_id: unit.unit_id,
          unit_code: unit.code,
          person_id: identity.personId,
          start_at: start.toISOString(),
          end_at: end.toISOString(),
          guests,
          notes: args.notas ?? null
        },
        summary
      );
    })
};

interface ReservationRow {
  id: string;
  unit_id: string;
  start_at: string;
  end_at: string;
  status: string;
  fee_amount: number;
  common_areas: { name: string } | null;
}

async function loadOwnReservations(ctx: ToolContext, unitIds: string[]): Promise<ReservationRow[]> {
  const { data, error } = await insforgeAdmin.database
    .from("area_reservations")
    .select("id, unit_id, start_at, end_at, status, fee_amount, common_areas(name)")
    .eq("organization_id", ctx.organizationId)
    .in("unit_id", unitIds)
    .in("status", ["pending_approval", "confirmed"])
    .gt("end_at", ctx.now.toISOString())
    .order("start_at", { ascending: true })
    .limit(10);
  if (error) throw new AppError(ErrorCodes.INTERNAL_ERROR, "No se pudieron consultar las reservas.", 500);
  return (data ?? []) as unknown as ReservationRow[];
}

const consultarMisReservas: ToolDefinition<Record<string, unknown>> = {
  name: "consultar_mis_reservas",
  description: "Próximas reservas de zonas comunes (pendientes o confirmadas) de las unidades del residente.",
  parameters: { type: "object", properties: {} },
  schema: z.object({}).passthrough(),
  access: "verified",
  capability: "reservations",
  execute: (_args, ctx) =>
    toToolResult(async () => {
      const identity = requireIdentity(ctx);
      const rows = await loadOwnReservations(ctx, identity.units.map((u) => u.unit_id));
      return ok(
        rows.map((r) => ({
          reserva_id: r.id,
          zona: r.common_areas?.name ?? "Zona común",
          unidad: identity.units.find((u) => u.unit_id === r.unit_id)?.code,
          inicio: formatDateTimeInZone(r.start_at, ctx.timezone),
          fin: formatDateTimeInZone(r.end_at, ctx.timezone),
          estado: reservationStatusLabel(r.status)
        })),
        structuredMeta("Reservas de zonas comunes", ctx.now)
      );
    })
};

const cancelacionSchema = z.object({ reserva_id: z.string().uuid() });

const proponerCancelacionReserva: ToolDefinition<z.infer<typeof cancelacionSchema>> = {
  name: "proponer_cancelacion_reserva",
  description: "Prepara la cancelación de una reserva propia (reserva_id de consultar_mis_reservas). Requiere confirmar_accion.",
  parameters: {
    type: "object",
    properties: { reserva_id: { type: "string" } },
    required: ["reserva_id"]
  },
  schema: cancelacionSchema,
  access: "verified",
  capability: "reservations",
  execute: (args, ctx) =>
    toToolResult(async () => {
      const identity = requireIdentity(ctx);
      const bookingUnits = identity.units.filter((u) => u.relations.some((r) => r !== "authorized"));
      const rows = await loadOwnReservations(ctx, bookingUnits.map((u) => u.unit_id));
      const reservation = rows.find((r) => r.id === args.reserva_id);
      if (!reservation) {
        return fail(ErrorCodes.RESERVATION_NOT_FOUND, "No encontré una reserva vigente con ese id entre las reservas de la persona.");
      }
      const unitCode = identity.units.find((u) => u.unit_id === reservation.unit_id)?.code;
      const fee = Number(reservation.fee_amount);
      const summary =
        `Cancelar la reserva de ${reservation.common_areas?.name ?? "la zona común"} del ` +
        `${formatDateTimeInZone(reservation.start_at, ctx.timezone)} (unidad ${unitCode}).` +
        (fee > 0 && reservation.status === "confirmed" ? ` Se anulará el cobro de ${formatCop(fee)}.` : "");
      return proposeAction(ctx, "cancel_area_reservation", { reservation_id: reservation.id }, summary);
    })
};

export const AREA_TOOLS = [consultarDisponibilidadZona, proponerReservaZona, consultarMisReservas, proponerCancelacionReserva] as ToolDefinition[];
