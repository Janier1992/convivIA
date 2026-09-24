import { vi } from "vitest";

type RawResponse = { data: unknown; error: unknown };
export type TableResponse = RawResponse | RawResponse[] | (() => RawResponse);

export interface RecordedCall {
  table: string;
  method: string;
  args: unknown[];
}

/**
 * Mock mínimo pero fiel del cliente @insforge/sdk (database con la forma de
 * postgrest-js, rpc y storage). Resuelve según una tabla de respuestas por
 * nombre de tabla/función: una respuesta fija, una secuencia (arreglo, se
 * consume en orden y repite la última) o una función. Registra cada
 * llamada en `calls` para verificar filtros, inserts y updates.
 */
export function createInsforgeMock(
  responses: Record<string, TableResponse>,
  rpcResponses: Record<string, TableResponse> = {}
) {
  const cursors = new Map<string, number>();
  const calls: RecordedCall[] = [];

  function resolve(source: Record<string, TableResponse>, key: string, kind: string): RawResponse {
    const entry = source[key];
    if (!entry) return { data: null, error: { message: `no mock configured for ${kind} ${key}` } };
    if (typeof entry === "function") return entry();
    if (Array.isArray(entry)) {
      const idx = cursors.get(`${kind}:${key}`) ?? 0;
      cursors.set(`${kind}:${key}`, Math.min(idx + 1, entry.length - 1));
      return entry[Math.min(idx, entry.length - 1)];
    }
    return entry;
  }

  function buildQuery(table: string) {
    const query: Record<string, unknown> = {};
    const chainMethods = [
      "select", "eq", "neq", "in", "lt", "gt", "lte", "gte", "order", "limit", "range", "is", "not", "or", "ilike",
      "filter", "insert", "update", "upsert", "delete"
    ];
    for (const method of chainMethods) {
      query[method] = vi.fn((...args: unknown[]) => {
        calls.push({ table, method, args });
        return query;
      });
    }
    query.maybeSingle = vi.fn(async () => resolve(responses, table, "table"));
    query.single = vi.fn(async () => resolve(responses, table, "table"));
    query.then = (onFulfilled: (v: RawResponse) => unknown, onRejected?: (e: unknown) => unknown) =>
      Promise.resolve(resolve(responses, table, "table")).then(onFulfilled, onRejected);
    return query;
  }

  const storageUpload = vi.fn(async () => ({ data: { key: "stored" }, error: null }));
  const storageDownload = vi.fn(async () => ({ data: new Blob(["texto"]), error: null }));

  return {
    calls,
    storageUpload,
    storageDownload,
    database: {
      from: vi.fn((table: string) => buildQuery(table)),
      rpc: vi.fn(async (fn: string, params?: unknown) => {
        calls.push({ table: `rpc:${fn}`, method: "rpc", args: [params] });
        return resolve(rpcResponses, fn, "rpc");
      })
    },
    storage: {
      from: vi.fn(() => ({ upload: storageUpload, download: storageDownload }))
    },
    auth: {
      getCurrentUser: vi.fn(async () => ({ data: { user: null }, error: null }))
    }
  };
}

export type InsforgeMock = ReturnType<typeof createInsforgeMock>;

/** Llamadas registradas a un método de una tabla (p. ej. inserts en messages). */
export function callsTo(mock: InsforgeMock, table: string, method: string): unknown[][] {
  return mock.calls.filter((c) => c.table === table && c.method === method).map((c) => c.args);
}
