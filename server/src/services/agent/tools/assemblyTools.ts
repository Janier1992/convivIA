import { z } from "zod";
import { insforgeAdmin } from "../../../lib/insforge.js";
import { formatDateTimeInZone } from "../../../lib/format.js";
import { AppError, ErrorCodes } from "../../../utils/AppError.js";
import { ok, structuredMeta, toToolResult, type ToolDefinition } from "../toolTypes.js";

interface AgendaItemRow {
  title: string;
  requires_vote: boolean;
}

interface AssemblyRow {
  id: string;
  title: string;
  assembly_type: string;
  status: string;
  scheduled_at: string;
  location: string | null;
}

/**
 * Solo información pública de la próxima asamblea (fecha, orden del día).
 * Nunca calcula ni menciona quórum o resultados de votación: esa parte
 * del prompt maestro es explícita en que el asistente NUNCA certifica eso.
 */
const consultarProximaAsamblea: ToolDefinition<Record<string, unknown>> = {
  name: "consultar_proxima_asamblea",
  description:
    "Fecha, lugar y orden del día de la próxima asamblea convocada o en curso. No da información de quórum ni de " +
    "resultados de votación: eso lo certifica el equipo administrativo en el acta, no el asistente.",
  parameters: { type: "object", properties: {} },
  schema: z.object({}).passthrough(),
  access: "public",
  capability: "assembly",
  execute: (_args, ctx) =>
    toToolResult(async () => {
      const { data, error } = await insforgeAdmin.database
        .from("assemblies")
        .select("id, title, assembly_type, status, scheduled_at, location")
        .eq("organization_id", ctx.organizationId)
        .in("status", ["draft", "in_progress"])
        .order("scheduled_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error) throw new AppError(ErrorCodes.INTERNAL_ERROR, "No se pudo consultar la próxima asamblea.", 500);
      const assembly = data as AssemblyRow | null;
      if (!assembly) {
        return ok({ mensaje: "No hay ninguna asamblea convocada por ahora." }, structuredMeta("Asambleas", ctx.now));
      }

      const { data: items } = await insforgeAdmin.database
        .from("assembly_agenda_items")
        .select("title, requires_vote")
        .eq("assembly_id", assembly.id)
        .order("position", { ascending: true });

      return ok(
        {
          titulo: assembly.title,
          tipo: assembly.assembly_type === "extraordinaria" ? "extraordinaria" : "ordinaria",
          estado: assembly.status === "in_progress" ? "en curso" : "convocada",
          fecha: formatDateTimeInZone(assembly.scheduled_at, ctx.timezone),
          lugar: assembly.location,
          orden_del_dia: ((items ?? []) as AgendaItemRow[]).map((i) => i.title)
        },
        structuredMeta("Asambleas de la copropiedad", ctx.now)
      );
    })
};

export const ASSEMBLY_TOOLS = [consultarProximaAsamblea] as ToolDefinition[];
