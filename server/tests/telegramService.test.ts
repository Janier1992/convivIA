import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { getEventListeners } from "node:events";
import { getTelegramUpdates, sendTelegramMessage } from "../src/services/telegram/telegramService.js";

// Reproduce el bug reportado: la respuesta del agente ya queda persistida
// (visible en el Inbox) antes de intentar el envío real a Telegram. Sin
// reintentos, un fallo transitorio (red, 5xx, rate limit) hacía que el
// mensaje se viera "respondido" en el dashboard pero nunca llegara al
// cliente. sendTelegramMessage ahora debe reintentar esos casos.

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" }, ...init });
}

describe("sendTelegramMessage", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("succeeds on the first try when Telegram responds ok", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }, { status: 200 }));

    await expect(sendTelegramMessage("token", 123, "hola")).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries on a transient network error and eventually succeeds", async () => {
    fetchMock
      .mockRejectedValueOnce(new Error("network hiccup"))
      .mockResolvedValueOnce(jsonResponse({ ok: true }, { status: 200 }));

    await expect(sendTelegramMessage("token", 123, "hola")).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries on a 5xx response instead of giving up immediately", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ ok: false, description: "bad gateway" }, { status: 502 }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }, { status: 200 }));

    await expect(sendTelegramMessage("token", 123, "hola")).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry a non-retryable 4xx (e.g. bot blocked by the user)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: false, description: "Forbidden: bot was blocked by the user" }, { status: 403 }));

    await expect(sendTelegramMessage("token", 123, "hola")).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("gives up after exhausting retries and throws", async () => {
    fetchMock.mockRejectedValue(new Error("persistent network failure"));

    await expect(sendTelegramMessage("token", 123, "hola")).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

// Reproduce el otro bug: getTelegramUpdates combinaba el signal del poller
// con AbortSignal.any/AbortSignal.timeout, y si eso fallara en el runtime
// real, CADA llamada revienta antes de intentar el fetch — el poller queda
// atascado reintentando para siempre sin traer ningún mensaje nuevo
// (silencio total, ni en el Inbox ni en Telegram). Este test ejercita la
// función completa (sin mockear el manejo de abort) contra un controller
// real, para no depender de una API de Node que pueda no estar disponible.
describe("getTelegramUpdates", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the updates on success without leaking abort listeners on the caller's signal", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, result: [{ update_id: 1 }] }, { status: 200 }));

    const controller = new AbortController();
    const updates = await getTelegramUpdates("token", 0, 25, controller.signal);

    expect(updates).toEqual([{ update_id: 1 }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // El listener de abort que se agrega al signal del poller se debe
    // quitar al terminar, sin importar cuántas veces se llame en el loop.
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  });

  it("aborts the underlying fetch when the caller's signal aborts", async () => {
    const controller = new AbortController();
    fetchMock.mockImplementationOnce((_url: string, options: { signal: AbortSignal }) => {
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      });
    });

    const promise = getTelegramUpdates("token", 0, 25, controller.signal);
    controller.abort();

    await expect(promise).rejects.toThrow();
  });

  it("throws a normal AppError on a non-ok response instead of crashing on the abort wiring", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: false, description: "unauthorized" }, { status: 401 }));

    await expect(getTelegramUpdates("token", 0, 25, new AbortController().signal)).rejects.toThrow();
  });
});
