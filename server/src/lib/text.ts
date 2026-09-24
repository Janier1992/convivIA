/** Minúsculas, sin tildes y con espacios colapsados: para comparar nombres. */
export function normalizeForMatch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Busca un elemento por id exacto o por nombre (ignorando tildes y
 * mayúsculas; acepta coincidencia parcial si es única). Devuelve null si
 * no hay coincidencia o si es ambigua.
 */
export function findByIdOrName<T extends { id: string; name: string }>(items: T[], query: string): T | null {
  const trimmed = query.trim();
  const byId = items.find((item) => item.id === trimmed);
  if (byId) return byId;
  const target = normalizeForMatch(trimmed);
  if (!target) return null;
  const exact = items.filter((item) => normalizeForMatch(item.name) === target);
  if (exact.length === 1) return exact[0];
  const partial = items.filter((item) => {
    const name = normalizeForMatch(item.name);
    return name.includes(target) || target.includes(name);
  });
  return partial.length === 1 ? partial[0] : null;
}

export function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

export function firstName(fullName: string | null | undefined): string {
  return (fullName ?? "").trim().split(/\s+/)[0] ?? "";
}
