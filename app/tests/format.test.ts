import { describe, expect, it } from "vitest";
import { addMonths, dayOfMonth, firstDayOfMonth, formatDate, formatMoney, todayIn } from "../src/lib/format";
import { friendlyError } from "../src/lib/errors";

describe("formato", () => {
  it("formatea pesos colombianos sin decimales", () => {
    expect(formatMoney(1234567).replace(/\s/g, " ")).toMatch(/1\.234\.567/);
    expect(formatMoney(null)).toBe("—");
  });

  it("maneja fechas sin corrimientos de zona horaria", () => {
    expect(formatDate("2026-10-01")).toMatch(/1/);
    expect(firstDayOfMonth("2026-10-17")).toBe("2026-10-01");
    expect(addMonths("2026-12-10", 1)).toBe("2027-01-01");
    expect(dayOfMonth("2026-02-10", 31)).toBe("2026-02-28");
  });

  it("calcula el día de hoy en Bogotá", () => {
    expect(todayIn("America/Bogota", new Date("2026-10-06T03:00:00Z"))).toBe("2026-10-05");
  });
});

describe("errores de la base de datos", () => {
  it("traduce códigos SQL a mensajes claros", () => {
    expect(friendlyError("ERROR: AREA_NOT_AVAILABLE").message).toMatch(/ocupado/);
    expect(friendlyError("VALIDATION_ERROR: la fecha de pago no puede ser futura").message).toBe("la fecha de pago no puede ser futura");
    expect(friendlyError("new row violates row-level security policy").code).toBe("FORBIDDEN");
    expect(friendlyError("algo raro").message).toMatch(/Intenta de nuevo/);
  });
});
