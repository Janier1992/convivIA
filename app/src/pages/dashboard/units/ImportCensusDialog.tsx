import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, FileSpreadsheet, Upload } from "lucide-react";
import { mapCensusSheet, TEMPLATE_COLUMNS, type CensusRow } from "@/lib/censusImport";
import { errorMessage, rpc } from "@/lib/rpc";
import { useOrgId } from "@/hooks/useOrganization";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ImportSummary, type ImportResult } from "./ImportSummary";
import { ImportHistory } from "./ImportHistory";

async function downloadTemplate() {
  const XLSX = await import("xlsx");
  const sheet = XLSX.utils.json_to_sheet([Object.fromEntries(TEMPLATE_COLUMNS.map((c) => [c.header, c.example]))]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Censo");
  XLSX.writeFile(book, "plantilla-censo-convivia.xlsx");
}

async function readSheet(file: File): Promise<Record<string, unknown>[]> {
  const XLSX = await import("xlsx");
  const book = XLSX.read(await file.arrayBuffer(), { cellDates: true });
  const sheet = book.Sheets[book.SheetNames[0]];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: true });
}

/**
 * cargar -> mapear -> simular (en la base de datos, mismo código que la
 * importación real) -> revisar errores y cambios -> confirmar -> auditar.
 */
export function ImportCensusDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<CensusRow[]>([]);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);

  function reset() {
    setFileName(null);
    setRows([]);
    setPreview(null);
  }

  async function run(dryRun: boolean, data: CensusRow[], name: string | null) {
    return rpc<ImportResult>("import_units_residents", {
      p_organization_id: orgId,
      p_rows: data,
      p_dry_run: dryRun,
      p_file_name: name
    });
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    reset();
    setBusy(true);
    try {
      const parsed = mapCensusSheet(await readSheet(file));
      if (parsed.missingRequired) throw new Error("El archivo no tiene la columna 'Unidad'. Usa la plantilla.");
      if (parsed.rows.length === 0) throw new Error("El archivo no tiene filas con datos.");
      if (parsed.unknownHeaders.length) toast.info(`Columnas ignoradas: ${parsed.unknownHeaders.join(", ")}`);
      setFileName(file.name);
      setRows(parsed.rows);
      setPreview(await run(true, parsed.rows, file.name));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function confirmImport() {
    setBusy(true);
    try {
      const result = await run(false, rows, fileName);
      if (!result.applied) {
        setPreview(result);
        throw new Error("La importación no se aplicó: revisa los errores.");
      }
      toast.success(`Importación aplicada: ${result.counts.units_created} unidades nuevas y ${result.counts.persons_created} personas.`);
      await queryClient.invalidateQueries();
      reset();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) reset();
        onOpenChange(value);
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Importar censo desde Excel</DialogTitle>
          <DialogDescription>
            Unidades, coeficientes, propietarios, ocupantes y saldos iniciales. Primero verás una simulación: nada se guarda hasta que confirmes.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button variant="outline" onClick={downloadTemplate} type="button">
            <Download className="h-4 w-4" aria-hidden /> Descargar plantilla
          </Button>
          <label className="inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90">
            <Upload className="h-4 w-4" aria-hidden />
            {busy ? "Procesando..." : "Cargar archivo (.xlsx o .csv)"}
            <input
              type="file"
              className="sr-only"
              accept=".xlsx,.xls,.csv"
              disabled={busy}
              onChange={(e) => {
                void onFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </label>
        </div>

        {preview && (
          <div className="mt-4 space-y-3">
            <p className="flex items-center gap-2 text-sm font-medium">
              <FileSpreadsheet className="h-4 w-4 text-accent" aria-hidden /> Simulación de {fileName} · {rows.length} filas
            </p>
            <ImportSummary result={preview} />
          </div>
        )}

        {preview && (
          <DialogFooter>
            <Button variant="outline" onClick={reset} disabled={busy}>Descartar</Button>
            <Button onClick={confirmImport} disabled={busy || preview.error_count > 0}>
              {busy ? "Importando..." : "Confirmar importación"}
            </Button>
          </DialogFooter>
        )}

        {!preview && <ImportHistory />}
      </DialogContent>
    </Dialog>
  );
}
