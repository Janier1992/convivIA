import { describe, expect, it } from "vitest";
import { chunkDocumentText, normalizeDocumentText } from "../src/services/documents/textChunker.js";
import { detectChannelCommand } from "../src/services/conversations/replyComposer.js";
import { isWithinReminderHours } from "../src/services/reminders/paymentReminderWorker.js";
import { isWithinWhatsAppWindow } from "../src/services/outbox/outboxSender.js";
import { formatCop, formatDateYmd } from "../src/lib/format.js";
import { findByIdOrName } from "../src/lib/text.js";
import { mapPostgresErrorMessage } from "../src/utils/AppError.js";

const REGLAMENTO = `REGLAMENTO DE PROPIEDAD HORIZONTAL
Página 1 de 30
CAPÍTULO III
DE LAS ZONAS COMUNES
ARTÍCULO 25. Mascotas.
Las mascotas deben transitar con traílla y bozal cuando la raza lo exija.
PARÁGRAFO. Los propietarios recogerán los excrementos.
ARTÍCULO 26. Ruido.
Está prohibido el ruido excesivo después de las 10 p. m.
3`;

describe("fragmentación de documentos", () => {
  it("respeta capítulos, artículos y parágrafos como encabezados citables", () => {
    const chunks = chunkDocumentText(REGLAMENTO);
    expect(chunks.map((c) => c.heading)).toEqual([
      null,
      "CAPÍTULO III · ARTÍCULO 25. Mascotas.",
      "CAPÍTULO III · PARÁGRAFO. Los propietarios recogerán los excrementos.",
      "CAPÍTULO III · ARTÍCULO 26. Ruido."
    ]);
    expect(chunks[1].content).toContain("traílla");
  });

  it("elimina números de página y respeta el tamaño máximo con solapamiento", () => {
    expect(normalizeDocumentText("Texto\nPágina 3 de 10\n12\nMás texto")).toBe("Texto\nMás texto");
    const long = Array.from({ length: 80 }, (_, i) => `Frase número ${i} del artículo con contenido relevante.`).join(" ");
    const chunks = chunkDocumentText(`ARTÍCULO 1. Largo\n${long}`, { maxChars: 500, overlapChars: 80 });
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks.every((c) => c.content.length <= 500)).toBe(true);
    const tail = chunks[0].content.slice(-40);
    expect(chunks[1].content).toContain(tail.slice(tail.indexOf(" ") + 1));
  });
});

describe("helpers", () => {
  it("detecta bajas y altas sin importar tildes ni mayúsculas", () => {
    expect(detectChannelCommand("BAJA")).toBe("opt_out");
    expect(detectChannelCommand("  Stop! ")).toBe("opt_out");
    expect(detectChannelCommand("alta")).toBe("opt_in");
    expect(detectChannelCommand("quiero dar de baja mi carro")).toBeNull();
  });

  it("solo envía recordatorios en horario diurno de Colombia", () => {
    expect(isWithinReminderHours(new Date("2026-10-05T14:00:00Z"))).toBe(true); // 09:00 Bogotá
    expect(isWithinReminderHours(new Date("2026-10-05T05:00:00Z"))).toBe(false); // 00:00 Bogotá
  });

  it("calcula la ventana de 24 h de WhatsApp", () => {
    const now = new Date("2026-10-05T15:00:00Z");
    expect(isWithinWhatsAppWindow("2026-10-05T10:00:00Z", now)).toBe(true);
    expect(isWithinWhatsAppWindow("2026-10-04T14:00:00Z", now)).toBe(false);
    expect(isWithinWhatsAppWindow(null, now)).toBe(false);
  });

  it("formatea pesos y fechas como en SQL", () => {
    expect(formatCop(1234567.4)).toBe("$ 1.234.567");
    expect(formatCop(0)).toBe("$ 0");
    expect(formatDateYmd("2026-10-05")).toBe("05/10/2026");
  });

  it("encuentra zonas por nombre aproximado sin tildes y evita ambigüedades", () => {
    const areas = [{ id: "1", name: "Salón social" }, { id: "2", name: "Salón de juegos" }, { id: "3", name: "BBQ" }];
    expect(findByIdOrName(areas, "salon social")?.id).toBe("1");
    expect(findByIdOrName(areas, "bbq")?.id).toBe("3");
    expect(findByIdOrName(areas, "salón")).toBeNull();
  });

  it("traduce errores de SQL a mensajes claros sin filtrar detalles técnicos", () => {
    expect(mapPostgresErrorMessage("ERROR: AREA_NOT_AVAILABLE")?.message).toMatch(/ya no está disponible/);
    expect(mapPostgresErrorMessage("VALIDATION_ERROR: la fecha de pago no puede ser futura")?.message).toBe(
      "la fecha de pago no puede ser futura"
    );
    expect(mapPostgresErrorMessage("relation x does not exist")).toBeNull();
  });
});
