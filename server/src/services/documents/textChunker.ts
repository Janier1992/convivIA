export interface TextChunk {
  index: number;
  heading: string | null;
  content: string;
}

export interface ChunkOptions {
  maxChars: number;
  overlapChars: number;
}

const DEFAULT_OPTIONS: ChunkOptions = { maxChars: 1500, overlapChars: 150 };

// Encabezados típicos de reglamentos y manuales de convivencia.
const ARTICLE_RE = /^(art[íi]culo|art\.)\s*\d+[a-z°º]*\b/i;
const PARAGRAPH_RE = /^par[áa]grafo(\s+(\d+|[a-záéíóú]+))?\b/i;
const CHAPTER_RE = /^(cap[íi]tulo|t[íi]tulo|secci[óo]n)\s+([ivxlcdm]+|\d+|[a-záéíóú]+)\b/i;

interface Section {
  heading: string | null;
  lines: string[];
}

/** Limpia saltos de línea, espacios y líneas que solo son números de página. */
export function normalizeDocumentText(text: string): string {
  return text
    .split(String.fromCharCode(0))
    .join("")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter((line) => !/^(p[áa]gina\s+)?\d{1,4}(\s+de\s+\d{1,4})?$/i.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function headingOf(line: string): "chapter" | "article" | null {
  if (line.length > 200) return null;
  if (CHAPTER_RE.test(line)) return "chapter";
  if (ARTICLE_RE.test(line) || PARAGRAPH_RE.test(line)) return "article";
  return null;
}

function splitIntoSections(text: string): Section[] {
  const sections: Section[] = [];
  let chapter: string | null = null;
  let current: Section = { heading: null, lines: [] };

  for (const line of text.split("\n")) {
    const kind = headingOf(line);
    if (kind === "chapter") {
      chapter = line.slice(0, 120);
      continue;
    }
    if (kind === "article") {
      if (current.lines.some((l) => l.length > 0)) sections.push(current);
      const heading = [chapter, line.slice(0, 160)].filter(Boolean).join(" · ");
      current = { heading, lines: [] };
      // El título del artículo suele venir en la misma línea: se conserva en el cuerpo.
      current.lines.push(line);
      continue;
    }
    current.lines.push(line);
  }
  if (current.lines.some((l) => l.length > 0)) sections.push(current);
  return sections;
}

function cutAtWordBoundary(text: string, max: number): [string, string] {
  if (text.length <= max) return [text, ""];
  const slice = text.slice(0, max);
  const lastSpace = slice.lastIndexOf(" ");
  const cut = lastSpace > max * 0.6 ? lastSpace : max;
  return [text.slice(0, cut).trim(), text.slice(cut).trim()];
}

function tailForOverlap(text: string, overlap: number): string {
  if (overlap <= 0 || text.length <= overlap) return "";
  const tail = text.slice(-overlap);
  const firstSpace = tail.indexOf(" ");
  return firstSpace >= 0 ? tail.slice(firstSpace + 1) : tail;
}

/**
 * Divide el cuerpo de una sección en piezas ≤ maxChars, por párrafos y con
 * solapamiento. Cada unidad mide como máximo maxChars - overlap - 1, así
 * que "solapamiento + unidad" siempre cabe en una pieza.
 */
function splitBody(body: string, options: ChunkOptions): string[] {
  if (body.length <= options.maxChars) return [body];
  const unitMax = Math.max(100, options.maxChars - options.overlapChars - 1);
  const units: string[] = [];
  for (const paragraph of body.split(/\n+/).map((p) => p.trim()).filter(Boolean)) {
    let rest = paragraph;
    while (rest.length > unitMax) {
      const [head, tail] = cutAtWordBoundary(rest, unitMax);
      units.push(head);
      rest = tail;
    }
    if (rest) units.push(rest);
  }

  const pieces: string[] = [];
  let current = "";
  for (const unit of units) {
    const candidate = current ? `${current}\n${unit}` : unit;
    if (candidate.length <= options.maxChars) {
      current = candidate;
      continue;
    }
    pieces.push(current);
    const overlap = tailForOverlap(current, options.overlapChars);
    current = overlap ? `${overlap}\n${unit}` : unit;
  }
  if (current) pieces.push(current);
  return pieces;
}

/**
 * Fragmenta un documento respetando su estructura (capítulos, artículos,
 * parágrafos): cada fragmento conserva su encabezado para que el
 * asistente pueda citar "Reglamento · Capítulo III · Artículo 25".
 */
export function chunkDocumentText(rawText: string, options: ChunkOptions = DEFAULT_OPTIONS): TextChunk[] {
  const text = normalizeDocumentText(rawText);
  if (!text) return [];
  const chunks: TextChunk[] = [];
  for (const section of splitIntoSections(text)) {
    const body = section.lines.join("\n").trim();
    for (const content of splitBody(body, options)) {
      if (content.length < 3) continue;
      chunks.push({ index: chunks.length, heading: section.heading, content });
    }
  }
  return chunks;
}
