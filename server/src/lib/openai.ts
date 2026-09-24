import OpenAI from "openai";
import { env } from "../config/env.js";

// OPENAI_BASE_URL es opcional: permite apuntar a un endpoint compatible con
// la API de OpenAI (p. ej. OpenRouter) para desarrollo local sin necesitar
// una key propia de OpenAI. En producción se deja sin definir y se usa la
// API oficial de OpenAI, tal como pide el prompt maestro.
// maxRetries=1 (el SDK trae 2 por default): cada reintento automático puede
// sumar varios segundos de backoff, y con OpenRouter en cuota gratuita eso
// se nota directo en la latencia del turno. Con 1 alcanza para blips
// transitorios sin duplicar la espera cuando el proveedor está lento.
export const openai = new OpenAI({
  apiKey: env.OPENAI_API_KEY,
  baseURL: env.OPENAI_BASE_URL || undefined,
  maxRetries: 1
});

/** Modelo configurado centralmente. No hardcodear "gpt-4o" en otros archivos. */
export const OPENAI_MODEL = env.OPENAI_MODEL;

/**
 * OpenRouter enruta cada request entre varios proveedores upstream; sin
 * créditos cargados, la cuenta puede terminar en proveedores lentos/con
 * cola. `provider.sort: "throughput"` le pide priorizar velocidad de
 * respuesta sobre precio. Solo aplica si el base URL es OpenRouter: la API
 * oficial de OpenAI no reconoce este campo.
 */
export const IS_OPENROUTER = env.OPENAI_BASE_URL.includes("openrouter.ai");
