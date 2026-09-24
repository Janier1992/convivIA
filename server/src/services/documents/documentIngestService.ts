import { createHash } from "node:crypto";
import { extractText, getDocumentProxy } from "unpdf";
import { insforgeAdmin } from "../../lib/insforge.js";
import { logger } from "../../lib/logger.js";
import { AppError, ErrorCodes } from "../../utils/AppError.js";
import type { DocumentRow } from "../../types/domain.js";
import { chunkDocumentText } from "./textChunker.js";

export const DOCUMENTS_BUCKET = "documents";
const MIN_TEXT_LENGTH = 40;
const INSERT_BATCH = 100;

function isPdf(mimeType: string | null, fileName: string | null): boolean {
  return mimeType === "application/pdf" || Boolean(fileName?.toLowerCase().endsWith(".pdf"));
}

function isPlainText(mimeType: string | null, fileName: string | null): boolean {
  return Boolean(mimeType?.startsWith("text/")) || /\.(txt|md)$/i.test(fileName ?? "");
}

export async function extractDocumentText(bytes: Uint8Array, mimeType: string | null, fileName: string | null): Promise<string> {
  if (isPdf(mimeType, fileName)) {
    const pdf = await getDocumentProxy(bytes);
    const { text } = await extractText(pdf, { mergePages: false });
    return (Array.isArray(text) ? text : [text]).join("\n\n");
  }
  if (isPlainText(mimeType, fileName)) {
    return new TextDecoder("utf-8").decode(bytes);
  }
  throw new AppError(ErrorCodes.VALIDATION_ERROR, "Formato no soportado: sube un PDF con texto o un archivo .txt.", 422);
}

async function loadDocument(documentId: string): Promise<DocumentRow> {
  const { data, error } = await insforgeAdmin.database
    .from("documents")
    .select("id, organization_id, title, storage_key, mime_type, file_name, source_text")
    .eq("id", documentId)
    .maybeSingle();
  if (error || !data) throw new AppError(ErrorCodes.VALIDATION_ERROR, "El documento no existe.", 404);
  return data as DocumentRow;
}

async function readSource(doc: DocumentRow): Promise<{ text: string; hash: string }> {
  if (doc.source_text) {
    return { text: doc.source_text, hash: createHash("sha256").update(doc.source_text).digest("hex") };
  }
  const { data, error } = await insforgeAdmin.storage.from(DOCUMENTS_BUCKET).download(doc.storage_key!);
  if (error || !data) throw new Error(`No se pudo descargar el archivo: ${error?.message ?? "sin datos"}`);
  const bytes = new Uint8Array(await data.arrayBuffer());
  return {
    text: await extractDocumentText(bytes, doc.mime_type, doc.file_name),
    hash: createHash("sha256").update(bytes).digest("hex")
  };
}

/**
 * Extrae el texto, lo fragmenta y reemplaza los fragmentos indexados del
 * documento. El hash SHA-256 queda como evidencia de integridad de la
 * versión procesada.
 */
export async function ingestDocument(documentId: string): Promise<{ chunks: number }> {
  const doc = await loadDocument(documentId);
  await insforgeAdmin.database.from("documents").update({ status: "processing", error: null }).eq("id", doc.id);

  try {
    const { text, hash } = await readSource(doc);
    if (text.replace(/\s+/g, "").length < MIN_TEXT_LENGTH) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR,
        "No se encontró texto en el archivo. Si es un PDF escaneado, súbelo con reconocimiento de texto (OCR) o pega el contenido.", 422);
    }
    const chunks = chunkDocumentText(text);
    await insforgeAdmin.database.from("document_chunks").delete().eq("document_id", doc.id);
    for (let i = 0; i < chunks.length; i += INSERT_BATCH) {
      const batch = chunks.slice(i, i + INSERT_BATCH).map((chunk) => ({
        organization_id: doc.organization_id,
        document_id: doc.id,
        chunk_index: chunk.index,
        heading: chunk.heading,
        content: chunk.content
      }));
      const { error } = await insforgeAdmin.database.from("document_chunks").insert(batch);
      if (error) throw new Error(`No se pudieron guardar los fragmentos: ${error.message}`);
    }
    await insforgeAdmin.database
      .from("documents")
      .update({ status: "ready", chunk_count: chunks.length, sha256: hash, error: null })
      .eq("id", doc.id);
    return { chunks: chunks.length };
  } catch (err) {
    const message = err instanceof AppError ? err.message : "No se pudo procesar el documento.";
    if (!(err instanceof AppError)) logger.error({ err, documentId: doc.id }, "document_ingest_failed");
    await insforgeAdmin.database.from("documents").update({ status: "failed", error: message }).eq("id", doc.id);
    throw err;
  }
}
