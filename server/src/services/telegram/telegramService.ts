import { insforgeAdmin } from "../../lib/insforge.js";
import { AppError, ErrorCodes } from "../../utils/AppError.js";

const TELEGRAM_API_BASE = "https://api.telegram.org";
const SEND_TIMEOUT_MS = 10_000;
const SEND_MAX_ATTEMPTS = 3;
const DOWNLOAD_TIMEOUT_MS = 20_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * fetch con timeout propio: un fetch colgado congelaría todo el loop de
 * long-polling de esa copropiedad (processUpdate lo espera con await).
 */
async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export interface ConnectedTelegramBot {
  organizationId: string;
  botToken: string;
}

export async function listConnectedTelegramBots(): Promise<ConnectedTelegramBot[]> {
  const { data, error } = await insforgeAdmin.database
    .from("integrations")
    .select("organization_id, credentials, status")
    .eq("provider", "telegram")
    .eq("status", "connected");
  if (error) throw new AppError(ErrorCodes.INTERNAL_ERROR, "No se pudieron cargar las integraciones de Telegram.", 500);

  return (data ?? [])
    .filter((row) => (row.credentials as { bot_token?: string } | null)?.bot_token)
    .map((row) => ({
      organizationId: row.organization_id as string,
      botToken: (row.credentials as { bot_token: string }).bot_token
    }));
}

export async function loadTelegramBotToken(organizationId: string): Promise<string | null> {
  const { data } = await insforgeAdmin.database
    .from("integrations")
    .select("credentials")
    .eq("organization_id", organizationId)
    .eq("provider", "telegram")
    .eq("status", "connected")
    .maybeSingle();
  return (data?.credentials as { bot_token?: string } | null)?.bot_token ?? null;
}

export const REQUEST_CONTACT_KEYBOARD = {
  keyboard: [[{ text: "📱 Compartir mi número", request_contact: true }]],
  resize_keyboard: true,
  one_time_keyboard: true
};

export const REMOVE_KEYBOARD = { remove_keyboard: true };

export interface SendOptions {
  replyMarkup?: Record<string, unknown>;
}

function parseRetryAfterSeconds(body: string): number | undefined {
  try {
    return (JSON.parse(body) as { parameters?: { retry_after?: number } }).parameters?.retry_after;
  } catch {
    return undefined;
  }
}

/**
 * Reintenta fallas transitorias (timeout, red, 5xx, 429): la respuesta ya
 * quedó guardada en el Inbox, y un envío perdido en silencio haría creer
 * al equipo que el residente recibió algo que nunca llegó.
 */
export async function sendTelegramMessage(botToken: string, chatId: string | number, text: string, options: SendOptions = {}): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= SEND_MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetchWithTimeout(
        `${TELEGRAM_API_BASE}/bot${botToken}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text, reply_markup: options.replyMarkup })
        },
        SEND_TIMEOUT_MS
      );
      if (res.ok) return;
      const body = await res.text().catch(() => "");
      if (res.status === 429 || res.status >= 500) {
        lastError = new AppError(ErrorCodes.CHANNEL_SEND_FAILED, `Telegram devolvió ${res.status}: ${body}`, 502);
        if (attempt < SEND_MAX_ATTEMPTS) await sleep(res.status === 429 ? (parseRetryAfterSeconds(body) ?? 1) * 1000 : attempt * 500);
        continue;
      }
      // Otro 4xx (chat inválido, bot bloqueado, token revocado): reintentar no cambia nada.
      throw new AppError(ErrorCodes.CHANNEL_SEND_FAILED, `No se pudo enviar el mensaje de Telegram (${res.status}): ${body}`, 400);
    } catch (err) {
      if (err instanceof AppError) throw err;
      lastError = err;
      if (attempt < SEND_MAX_ATTEMPTS) await sleep(attempt * 500);
    }
  }
  throw lastError instanceof AppError
    ? lastError
    : new AppError(ErrorCodes.CHANNEL_SEND_FAILED, `No se pudo enviar el mensaje de Telegram tras ${SEND_MAX_ATTEMPTS} intentos.`, 502);
}

/** Indicador de "escribiendo..." (best-effort). */
export async function sendTelegramTypingAction(botToken: string, chatId: string | number): Promise<void> {
  try {
    await fetchWithTimeout(
      `${TELEGRAM_API_BASE}/bot${botToken}/sendChatAction`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: chatId, action: "typing" }) },
      SEND_TIMEOUT_MS
    );
  } catch {
    // best-effort
  }
}

export interface TelegramPhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

export interface TelegramMessage {
  message_id: number;
  date: number;
  chat: { id: number; type: string };
  from?: { id: number; first_name?: string; last_name?: string; username?: string };
  text?: string;
  photo?: TelegramPhotoSize[];
  document?: { file_id: string; file_name?: string; mime_type?: string; file_size?: number };
  contact?: { phone_number: string; first_name?: string; last_name?: string; user_id?: number };
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

export async function getTelegramUpdates(botToken: string, offset: number, timeoutSeconds: number, signal: AbortSignal): Promise<TelegramUpdate[]> {
  const url = `${TELEGRAM_API_BASE}/bot${botToken}/getUpdates?timeout=${timeoutSeconds}&offset=${offset}&allowed_updates=%5B%22message%22%5D`;

  // Timeout propio combinado a mano con la señal del poller (sin
  // AbortSignal.any, que dejó el poller trabado en algunos entornos).
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal.addEventListener("abort", onAbort);
  const timer = setTimeout(() => controller.abort(), (timeoutSeconds + 10) * 1000);

  let res: Response;
  try {
    res = await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
  }
  if (!res.ok) throw new AppError(ErrorCodes.INTERNAL_ERROR, `getUpdates falló con status ${res.status}`, 502);
  const data = (await res.json()) as { ok: boolean; result?: TelegramUpdate[]; description?: string };
  if (!data.ok) throw new AppError(ErrorCodes.INTERNAL_ERROR, data.description ?? "getUpdates devolvió ok=false", 502);
  return data.result ?? [];
}

/** Descarga un archivo por file_id con el flujo oficial getFile + endpoint de archivos. */
export async function downloadTelegramFile(botToken: string, fileId: string): Promise<{ bytes: Uint8Array; filePath: string }> {
  const fileRes = await fetchWithTimeout(`${TELEGRAM_API_BASE}/bot${botToken}/getFile?file_id=${encodeURIComponent(fileId)}`, {}, SEND_TIMEOUT_MS);
  const fileData = (await fileRes.json().catch(() => ({}))) as { ok?: boolean; result?: { file_path?: string }; description?: string };
  if (!fileRes.ok || !fileData.ok || !fileData.result?.file_path) {
    throw new AppError(ErrorCodes.INTERNAL_ERROR, fileData.description ?? "getFile no devolvió file_path", 502);
  }
  const download = await fetchWithTimeout(`${TELEGRAM_API_BASE}/file/bot${botToken}/${fileData.result.file_path}`, {}, DOWNLOAD_TIMEOUT_MS);
  if (!download.ok) throw new AppError(ErrorCodes.INTERNAL_ERROR, `Descarga de Telegram falló con status ${download.status}`, 502);
  return { bytes: new Uint8Array(await download.arrayBuffer()), filePath: fileData.result.file_path };
}

export function mimeTypeFromPath(filePath: string, fallback = "image/jpeg"): string {
  const extension = filePath.split(".").pop()?.toLowerCase();
  if (extension === "png") return "image/png";
  if (extension === "webp") return "image/webp";
  if (extension === "pdf") return "application/pdf";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  return fallback;
}
