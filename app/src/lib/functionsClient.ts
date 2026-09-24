import { insforge } from "./insforgeClient";

export class FunctionError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
  }
}

async function invoke<T>(slug: string, options?: { method?: "GET" | "POST"; body?: unknown }): Promise<T> {
  const { data, error } = await insforge.functions.invoke<T>(slug, {
    method: options?.method ?? "POST",
    body: options?.body
  });

  if (error) {
    const message = (error as unknown as { message?: string })?.message ?? "Ocurrió un error inesperado.";
    const code = (data as { error?: { code?: string } } | null)?.error?.code ?? "UNKNOWN_ERROR";
    throw new FunctionError(code, message);
  }

  const payload = data as unknown as { error?: { code: string; message: string } };
  if (payload?.error) {
    throw new FunctionError(payload.error.code, payload.error.message);
  }

  return data as T;
}

export const functionsClient = {
  get: <T>(slug: string, params?: Record<string, string | number | null | undefined>) => {
    const query = params
      ? new URLSearchParams(
          Object.entries(params)
            .filter((entry): entry is [string, string | number] => entry[1] !== undefined && entry[1] !== null)
            .map(([k, v]) => [k, String(v)])
        ).toString()
      : "";
    return invoke<T>(query ? `${slug}?${query}` : slug, { method: "GET" });
  },
  post: <T>(slug: string, body?: unknown) => invoke<T>(slug, { method: "POST", body })
};
