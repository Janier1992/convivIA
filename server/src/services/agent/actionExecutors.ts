import { insforgeAdmin } from "../../lib/insforge.js";
import { logger } from "../../lib/logger.js";
import { formatCop, formatDateTimeInZone, pqrsStatusLabel, reservationStatusLabel } from "../../lib/format.js";
import { toAppError } from "../../utils/AppError.js";
import { notifyOrganization } from "../notifications/pushService.js";
import type { ToolContext } from "./toolTypes.js";

export type ActionType = "create_pqrs" | "book_area" | "cancel_area_reservation" | "report_payment" | "create_visitor_authorization";

type Executor = (payload: Record<string, unknown>, ctx: ToolContext) => Promise<Record<string, unknown>>;

function notify(organizationId: string, title: string, body: string, url: string) {
  notifyOrganization(organizationId, { title, body, url, tag: `${url}-${Date.now()}` }).catch((err) =>
    logger.warn({ organizationId, err }, "push_notify_failed")
  );
}

async function rpc<T>(fn: string, params: Record<string, unknown>, fallback: string): Promise<T> {
  const { data, error } = await insforgeAdmin.database.rpc(fn, params);
  if (error) throw toAppError(error, fallback);
  return data as T;
}

const createPqrs: Executor = async (payload, ctx) => {
  const ticket = await rpc<{ id: string; radicado: string; status: string; due_at: string; subject: string }>(
    "create_pqrs_ticket",
    {
      p_organization_id: ctx.organizationId,
      p_ticket_type: payload.ticket_type,
      p_category_id: payload.category_id,
      p_subject: payload.subject,
      p_description: payload.description,
      p_priority: payload.priority,
      p_unit_id: payload.unit_id ?? null,
      p_requester_person_id: payload.person_id,
      p_requester_name: null,
      p_requester_contact: null,
      p_channel: ctx.channel,
      p_conversation_id: ctx.conversationId,
      p_actor_kind: "agent"
    },
    "No se pudo radicar la PQRS."
  );
  notify(ctx.organizationId, `Nueva PQRS ${ticket.radicado}`, ticket.subject, "/dashboard/pqrs");
  return {
    radicado: ticket.radicado,
    estado: pqrsStatusLabel(ticket.status),
    fecha_limite_respuesta: formatDateTimeInZone(ticket.due_at, ctx.timezone)
  };
};

const bookArea: Executor = async (payload, ctx) => {
  const reservation = await rpc<{ id: string; status: string; start_at: string; end_at: string; fee_amount: number; deposit_amount: number }>(
    "book_area_reservation",
    {
      p_organization_id: ctx.organizationId,
      p_area_id: payload.area_id,
      p_unit_id: payload.unit_id,
      p_person_id: payload.person_id,
      p_start_at: payload.start_at,
      p_end_at: payload.end_at,
      p_guests: payload.guests,
      p_notes: payload.notes ?? null,
      p_source: "agent",
      p_conversation_id: ctx.conversationId
    },
    "No se pudo registrar la reserva."
  );
  if (reservation.status === "pending_approval") {
    notify(ctx.organizationId, "Reserva pendiente de aprobación", `${payload.area_name} · ${payload.unit_code}`, "/dashboard/reservations");
  }
  const fee = Number(reservation.fee_amount);
  return {
    reserva_id: reservation.id,
    estado: reservationStatusLabel(reservation.status),
    zona: payload.area_name,
    inicio: formatDateTimeInZone(reservation.start_at, ctx.timezone),
    fin: formatDateTimeInZone(reservation.end_at, ctx.timezone),
    tarifa: fee > 0 ? formatCop(fee) : null,
    tarifa_cargada_a_la_cuenta: fee > 0 && reservation.status === "confirmed",
    deposito: Number(reservation.deposit_amount) > 0 ? formatCop(reservation.deposit_amount) : null
  };
};

const cancelAreaReservation: Executor = async (payload) => {
  const reservation = await rpc<{ id: string; status: string }>(
    "cancel_area_reservation",
    { p_reservation_id: payload.reservation_id, p_reason: "Cancelada por el residente desde el chat" },
    "No se pudo cancelar la reserva."
  );
  return { reserva_id: reservation.id, estado: reservationStatusLabel(reservation.status) };
};

const reportPayment: Executor = async (payload, ctx) => {
  const payment = await rpc<{ id: string; receipt_storage_key: string | null }>(
    "report_payment_from_resident",
    {
      p_organization_id: ctx.organizationId,
      p_person_id: payload.person_id,
      p_unit_id: payload.unit_id,
      p_amount: payload.amount,
      p_paid_on: payload.paid_on,
      p_method: payload.method,
      p_reference: payload.reference ?? null,
      p_note: null,
      p_conversation_id: ctx.conversationId
    },
    "No se pudo registrar el reporte de pago."
  );
  notify(ctx.organizationId, "Pago reportado para revisar", `${payload.unit_code} · ${formatCop(Number(payload.amount))}`, "/dashboard/payments");
  return {
    pago_id: payment.id,
    estado: "pendiente de verificación por la administración",
    soporte_adjunto: Boolean(payment.receipt_storage_key)
  };
};

const createVisitorAuthorization: Executor = async (payload, ctx) => {
  const auth = await rpc<{ id: string; visitor_name: string; valid_from: string; valid_until: string; status: string }>(
    "create_visitor_authorization",
    {
      p_organization_id: ctx.organizationId,
      p_unit_id: payload.unit_id,
      p_visitor_name: payload.visitor_name,
      p_valid_from: payload.valid_from,
      p_valid_until: payload.valid_until,
      p_visitor_document: payload.visitor_document ?? null,
      p_visitor_phone: payload.visitor_phone ?? null,
      p_vehicle_plate: payload.vehicle_plate ?? null,
      p_notes: payload.notes ?? null,
      p_requested_by_person_id: payload.requested_by_person_id ?? null,
      p_conversation_id: ctx.conversationId,
      p_source: "agent",
      p_actor_kind: "agent"
    },
    "No se pudo crear la autorización de visitante."
  );
  notify(ctx.organizationId, "Nueva autorización de visitante", `${auth.visitor_name}`, "/dashboard/gatehouse");
  return {
    autorizacion_id: auth.id,
    visitante: auth.visitor_name,
    desde: formatDateTimeInZone(auth.valid_from, ctx.timezone),
    hasta: formatDateTimeInZone(auth.valid_until, ctx.timezone)
  };
};

export const ACTION_EXECUTORS: Record<ActionType, Executor> = {
  create_pqrs: createPqrs,
  book_area: bookArea,
  cancel_area_reservation: cancelAreaReservation,
  report_payment: reportPayment,
  create_visitor_authorization: createVisitorAuthorization
};
