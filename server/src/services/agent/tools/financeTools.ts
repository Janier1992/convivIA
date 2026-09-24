import { z } from "zod";
import { insforgeAdmin } from "../../../lib/insforge.js";
import { formatCop, formatDateYmd, todayInZone } from "../../../lib/format.js";
import { AppError, ErrorCodes, toAppError } from "../../../utils/AppError.js";
import { proposeAction } from "../pendingActions.js";
import { resolveOwnUnit } from "../unitResolver.js";
import { fail, ok, requireIdentity, toToolResult, type ToolDefinition } from "../toolTypes.js";

interface Statement {
  as_of: string;
  today: string;
  unit: { code: string };
  balance: number;
  credit: number;
  overdue_amount: number;
  current_amount: number;
  oldest_overdue_due_date: string | null;
  next_due_date: string | null;
  open_items: { concept: string; description: string | null; period: string | null; due_date: string; unpaid: number; days_overdue: number }[];
  recent_payments: { paid_on: string; amount: number; method: string | null }[];
  pending_reports: number;
}

const estadoSchema = z.object({ unidad: z.string().max(40).optional() });

const consultarEstadoCuenta: ToolDefinition<z.infer<typeof estadoSchema>> = {
  name: "consultar_estado_cuenta",
  description:
    "Estado de cuenta oficial de una unidad del residente: saldo, valor vencido, próximo vencimiento, partidas abiertas y " +
    "últimos pagos. Úsala para '¿cuánto debo?', '¿estoy al día?', paz y salvo o dudas de cartera.",
  parameters: {
    type: "object",
    properties: { unidad: { type: "string", description: "Código de la unidad (ej. T1-502). Omitir si tiene una sola." } }
  },
  schema: estadoSchema,
  access: "verified",
  capability: "finance",
  execute: (args, ctx) =>
    toToolResult(async () => {
      const unit = resolveOwnUnit(requireIdentity(ctx), args.unidad, "finance");
      const { data, error } = await insforgeAdmin.database.rpc("get_unit_statement", { p_unit_id: unit.unit_id });
      if (error || !data) throw toAppError(error, "No se pudo consultar el estado de cuenta.");
      const s = data as Statement;
      const balance = Number(s.balance);
      const { data: profile } = await insforgeAdmin.database
        .from("property_profiles")
        .select("payment_instructions")
        .eq("organization_id", ctx.organizationId)
        .maybeSingle();

      return ok(
        {
          unidad: s.unit.code,
          saldo_total: formatCop(Math.max(balance, 0)),
          saldo_a_favor: Number(s.credit) > 0 ? formatCop(s.credit) : null,
          valor_vencido: formatCop(s.overdue_amount),
          valor_por_vencer: formatCop(s.current_amount),
          al_dia: Number(s.overdue_amount) <= 0,
          sin_deuda: balance <= 0,
          vencido_desde: formatDateYmd(s.oldest_overdue_due_date),
          proximo_vencimiento: formatDateYmd(s.next_due_date),
          partidas_abiertas: s.open_items.slice(0, 8).map((i) => ({
            concepto: i.description ?? i.concept,
            vence: formatDateYmd(i.due_date),
            pendiente: formatCop(i.unpaid),
            dias_vencida: i.days_overdue
          })),
          ultimos_pagos: s.recent_payments.slice(0, 3).map((p) => ({ fecha: formatDateYmd(p.paid_on), valor: formatCop(p.amount) })),
          reportes_de_pago_en_revision: s.pending_reports,
          instrucciones_de_pago: profile?.payment_instructions ?? null,
          nota: "Los pagos reportados que están en revisión no se reflejan hasta que la administración los verifique."
        },
        { tipo_dato: "DATO_ESTRUCTURADO", fuente: `Estado de cuenta de la unidad ${s.unit.code}`, fecha_datos: s.as_of }
      );
    })
};

const METHOD_VALUES = ["bank_transfer", "pse", "cash", "nequi", "daviplata", "card", "consignment", "other"] as const;
const METHOD_LABELS: Record<(typeof METHOD_VALUES)[number], string> = {
  bank_transfer: "transferencia bancaria",
  pse: "PSE",
  cash: "efectivo",
  nequi: "Nequi",
  daviplata: "Daviplata",
  card: "tarjeta",
  consignment: "consignación",
  other: "otro medio"
};

const reporteSchema = z.object({
  unidad: z.string().max(40).optional(),
  valor: z.number().positive().max(100_000_000),
  fecha_pago: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "fecha_pago debe tener formato YYYY-MM-DD"),
  medio: z.enum(METHOD_VALUES),
  referencia: z.string().max(80).optional()
});

const proponerReportePago: ToolDefinition<z.infer<typeof reporteSchema>> = {
  name: "proponer_reporte_pago",
  description:
    "Prepara el reporte de un pago que el residente YA hizo, para que la administración lo verifique. No aplica el pago: " +
    "queda pendiente de verificación. Requiere confirmación posterior con confirmar_accion.",
  parameters: {
    type: "object",
    properties: {
      unidad: { type: "string", description: "Código de la unidad. Omitir si tiene una sola." },
      valor: { type: "number", description: "Valor pagado en pesos, sin puntos ni signos." },
      fecha_pago: { type: "string", description: "Fecha del pago YYYY-MM-DD." },
      medio: { type: "string", enum: [...METHOD_VALUES] },
      referencia: { type: "string", description: "Número de aprobación o referencia, si lo tiene." }
    },
    required: ["valor", "fecha_pago", "medio"]
  },
  schema: reporteSchema,
  access: "verified",
  capability: "payment_reports",
  execute: (args, ctx) =>
    toToolResult(async () => {
      const identity = requireIdentity(ctx);
      const unit = resolveOwnUnit(identity, args.unidad, "finance");
      const today = todayInZone(ctx.timezone, ctx.now);
      const oldest = todayInZone(ctx.timezone, new Date(ctx.now.getTime() - 180 * 86_400_000));
      if (args.fecha_pago > today) return fail(ErrorCodes.VALIDATION_ERROR, "La fecha de pago no puede ser futura.");
      if (args.fecha_pago < oldest) {
        return fail(ErrorCodes.VALIDATION_ERROR, "Pagos de hace más de 6 meses deben gestionarse directamente con la administración.");
      }
      if (!Number.isInteger(args.valor)) throw new AppError(ErrorCodes.VALIDATION_ERROR, "El valor debe ser en pesos enteros.", 422);

      const summary =
        `Reportar un pago de ${formatCop(args.valor)} del ${formatDateYmd(args.fecha_pago)} por ${METHOD_LABELS[args.medio]}` +
        `${args.referencia ? ` (ref. ${args.referencia})` : ""} para la unidad ${unit.code}. ` +
        "La administración lo verificará antes de aplicarlo a tu estado de cuenta.";
      return proposeAction(
        ctx,
        "report_payment",
        {
          unit_id: unit.unit_id,
          unit_code: unit.code,
          person_id: identity.personId,
          amount: args.valor,
          paid_on: args.fecha_pago,
          method: args.medio,
          reference: args.referencia ?? null
        },
        summary
      );
    })
};

export const FINANCE_TOOLS = [consultarEstadoCuenta, proponerReportePago] as ToolDefinition[];
