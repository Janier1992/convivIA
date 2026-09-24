/** Exporta filas a CSV compatible con Excel en español (separador ;, BOM UTF-8). */
export function downloadCsv(fileName: string, headers: string[], rows: (string | number | null | undefined)[][]) {
  const escape = (value: string | number | null | undefined) => {
    const text = value === null || value === undefined ? "" : String(value);
    return /[;"\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const content = [headers, ...rows].map((row) => row.map(escape).join(";")).join("\r\n");
  const blob = new Blob(["\uFEFF" + content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}
