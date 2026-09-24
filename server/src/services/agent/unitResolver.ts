import { AppError, ErrorCodes } from "../../utils/AppError.js";
import { normalizeForMatch } from "../../lib/text.js";
import type { IdentityUnit, ResidentIdentity, UnitRelation } from "../../types/domain.js";

export type UnitPurpose = "finance" | "booking" | "any";

const BOOKING_RELATIONS: UnitRelation[] = ["owner", "tenant", "resident"];

function allowedFor(unit: IdentityUnit, purpose: UnitPurpose): boolean {
  if (purpose === "finance") return unit.finance_access;
  if (purpose === "booking") return unit.relations.some((r) => BOOKING_RELATIONS.includes(r));
  return true;
}

const DENIED_MESSAGES: Record<UnitPurpose, string> = {
  finance: "Solo el propietario o el arrendatario de la unidad pueden consultar o reportar pagos de su cartera.",
  booking: "Las personas autorizadas no pueden reservar zonas comunes a nombre de la unidad.",
  any: "No tienes relación con esa unidad."
};

/**
 * Resuelve la unidad que menciona el residente contra SUS unidades
 * verificadas (nunca contra el censo completo): el modelo puede repetir
 * un código cualquiera, pero solo se autorizan las unidades propias con la
 * relación adecuada para el propósito.
 */
export function resolveOwnUnit(identity: ResidentIdentity, requested: string | undefined, purpose: UnitPurpose): IdentityUnit {
  const allowed = identity.units.filter((u) => allowedFor(u, purpose));

  if (!requested || !requested.trim()) {
    if (allowed.length === 1) return allowed[0];
    if (allowed.length === 0) throw new AppError(ErrorCodes.UNIT_ACCESS_DENIED, DENIED_MESSAGES[purpose], 403);
    throw new AppError(
      ErrorCodes.AMBIGUOUS_UNIT,
      `La persona tiene varias unidades (${allowed.map((u) => u.code).join(", ")}). Pregunta a cuál se refiere.`,
      422
    );
  }

  const target = normalizeForMatch(requested);
  const match =
    identity.units.find((u) => u.unit_id === requested.trim()) ??
    identity.units.find((u) => normalizeForMatch(u.code) === target) ??
    (() => {
      const partial = identity.units.filter((u) => normalizeForMatch(u.code).endsWith(target));
      return partial.length === 1 ? partial[0] : undefined;
    })();

  if (!match) {
    throw new AppError(
      ErrorCodes.UNIT_NOT_FOUND,
      `La unidad "${requested}" no está entre las unidades verificadas de la persona (${identity.units.map((u) => u.code).join(", ")}).`,
      404
    );
  }
  if (!allowedFor(match, purpose)) {
    throw new AppError(ErrorCodes.UNIT_ACCESS_DENIED, DENIED_MESSAGES[purpose], 403);
  }
  return match;
}
