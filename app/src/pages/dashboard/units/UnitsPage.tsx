import { useMemo, useState } from "react";
import { Building2, FileSpreadsheet, Layers, Pencil, Plus, Wand2 } from "lucide-react";
import { useOrganization } from "@/hooks/useOrganization";
import { useTowers, useUnits } from "@/hooks/useCatalogs";
import { formatNumber } from "@/lib/format";
import { UNIT_TYPE_LABELS } from "@/lib/labels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { QueryErrorState } from "@/components/QueryErrorState";
import type { Unit } from "@/types/domain";
import { UnitFormDialog } from "./UnitFormDialog";
import { UnitGeneratorDialog } from "./UnitGeneratorDialog";
import { TowersDialog } from "./TowersDialog";
import { ImportCensusDialog } from "./ImportCensusDialog";

const ALL = "__all__";

export function UnitsPage() {
  const { can } = useOrganization();
  const canWrite = can("residents.write");
  const { data: units = [], isLoading, isError, refetch } = useUnits();
  const { data: towers = [] } = useTowers();
  const [search, setSearch] = useState("");
  const [tower, setTower] = useState(ALL);
  const [editing, setEditing] = useState<Unit | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [generatorOpen, setGeneratorOpen] = useState(false);
  const [towersOpen, setTowersOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const filtered = useMemo(() => {
    const term = search.trim().toUpperCase();
    return units.filter((u) => (tower === ALL || u.tower_id === tower) && (!term || u.code.includes(term)));
  }, [units, search, tower]);

  const active = units.filter((u) => u.is_active);
  const coefficientSum = active.reduce((sum, u) => sum + Number(u.coefficient_pct), 0);
  const coefficientOk = Math.abs(coefficientSum - 100) < 0.01;

  function openForm(unit: Unit | null) {
    setEditing(unit);
    setFormOpen(true);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Unidades"
        description="Apartamentos, casas, locales, parqueaderos y depósitos con su coeficiente de copropiedad."
        actions={
          canWrite && (
            <>
              <Button variant="outline" onClick={() => setTowersOpen(true)}><Layers className="h-4 w-4" aria-hidden /> Torres</Button>
              <Button variant="outline" onClick={() => setGeneratorOpen(true)}><Wand2 className="h-4 w-4" aria-hidden /> Generar por pisos</Button>
              <Button variant="outline" onClick={() => setImportOpen(true)}><FileSpreadsheet className="h-4 w-4" aria-hidden /> Importar censo</Button>
              <Button onClick={() => openForm(null)}><Plus className="h-4 w-4" aria-hidden /> Nueva unidad</Button>
            </>
          )
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-sm text-muted-foreground">Unidades activas</p>
          <p className="text-2xl font-bold">{formatNumber(active.length)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-muted-foreground">Torres / bloques</p>
          <p className="text-2xl font-bold">{formatNumber(towers.length)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-muted-foreground">Suma de coeficientes</p>
          <p className={`text-2xl font-bold ${coefficientOk || active.length === 0 ? "" : "text-warning"}`}>{formatNumber(coefficientSum)}%</p>
          {!coefficientOk && active.length > 0 && <p className="text-xs text-warning">Debería sumar 100%. Revisa el reglamento o importa los coeficientes.</p>}
        </Card>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por código (ej. T1-502)" className="sm:max-w-xs" aria-label="Buscar unidad" />
        <Select value={tower} onValueChange={setTower}>
          <SelectTrigger className="sm:w-56" aria-label="Filtrar por torre"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todas las torres</SelectItem>
            {towers.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {isError ? (
        <QueryErrorState onRetry={() => refetch()} message="No se pudieron cargar las unidades." />
      ) : isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : units.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="Aún no hay unidades"
          description="Importa tu censo desde Excel o genera las unidades de cada torre por pisos."
          action={canWrite && <Button onClick={() => setImportOpen(true)}>Importar censo</Button>}
        />
      ) : (
        <Card className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>Unidad</th><th>Torre</th><th>Tipo</th><th>Piso</th><th className="text-right">Área m²</th>
                <th className="text-right">Coeficiente</th><th>Estado</th>{canWrite && <th className="w-12"><span className="sr-only">Acciones</span></th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map((unit) => (
                <tr key={unit.id}>
                  <td className="font-medium">{unit.code}</td>
                  <td>{unit.towers?.name ?? "—"}</td>
                  <td>{UNIT_TYPE_LABELS[unit.unit_type]}</td>
                  <td>{unit.floor ?? "—"}</td>
                  <td className="text-right">{formatNumber(unit.area_m2)}</td>
                  <td className="text-right tabular-nums">{formatNumber(unit.coefficient_pct)}%</td>
                  <td>{unit.is_active ? <Badge variant="success">Activa</Badge> : <Badge variant="muted">Inactiva</Badge>}</td>
                  {canWrite && (
                    <td>
                      <Button variant="ghost" size="icon" onClick={() => openForm(unit)} aria-label={`Editar ${unit.code}`}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">Ninguna unidad coincide con el filtro.</p>}
        </Card>
      )}

      <UnitFormDialog open={formOpen} onOpenChange={setFormOpen} unit={editing} />
      <UnitGeneratorDialog open={generatorOpen} onOpenChange={setGeneratorOpen} />
      <TowersDialog open={towersOpen} onOpenChange={setTowersOpen} />
      <ImportCensusDialog open={importOpen} onOpenChange={setImportOpen} />
    </div>
  );
}
