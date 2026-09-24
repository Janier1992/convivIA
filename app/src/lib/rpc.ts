import { insforge } from "./insforgeClient";
import { friendlyError } from "./errors";

export { RpcError, errorMessage, friendlyError } from "./errors";

export async function rpc<T>(fn: string, params: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await insforge.database.rpc(fn, params);
  if (error) throw friendlyError((error as { message?: string }).message);
  return data as T;
}

/** Convierte el { error } de una consulta directa en un error amigable. */
export function assertOk<T>(result: { data: T | null; error: unknown }): T {
  if (result.error) throw friendlyError((result.error as { message?: string }).message);
  return result.data as T;
}
