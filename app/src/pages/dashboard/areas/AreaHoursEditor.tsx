import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { insforge } from "@/lib/insforgeClient";
import { assertOk, errorMessage } from "@/lib/rpc";
import { useOrgId } from "@/hooks/useOrganization";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CommonAreaHour } from "@/types/domain";

const DAYS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

/** Horario semanal de una zona común: un rango por día (abierto/cerrado). */
export function AreaHoursEditor({ areaId }: { areaId: string }) {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const { data: hours = [] } = useQuery({
    queryKey: ["area-hours", areaId],
    queryFn: async () => {
      const { data, error } = await insforge.database.from("common_area_hours").select("*").eq("area_id", areaId).order("day_of_week");
      if (error) throw error;
      return data as CommonAreaHour[];
    }
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["area-hours", areaId] });

  async function setDay(dow: number, opensAt: string | null, closesAt: string | null) {
    try {
      const existing = hours.find((h) => h.day_of_week === dow);
      if (!opensAt || !closesAt) {
        if (existing) assertOk(await insforge.database.from("common_area_hours").delete().eq("id", existing.id).select("id"));
      } else if (existing) {
        assertOk(await insforge.database.from("common_area_hours").update({ opens_at: opensAt, closes_at: closesAt }).eq("id", existing.id).select("id"));
      } else {
        assertOk(await insforge.database.from("common_area_hours").insert([{ organization_id: orgId, area_id: areaId, day_of_week: dow, opens_at: opensAt, closes_at: closesAt }]).select("id"));
      }
      await refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <div className="space-y-2">
      <Label>Horario semanal</Label>
      {DAYS.map((label, dow) => {
        const day = hours.find((h) => h.day_of_week === dow);
        const open = !!day;
        return (
          <div key={dow} className="flex items-center gap-3">
            <Switch
              checked={open}
              onCheckedChange={(checked) => setDay(dow, checked ? "08:00" : null, checked ? "20:00" : null)}
              aria-label={`${label} ${open ? "abierto" : "cerrado"}`}
            />
            <span className="w-24 text-sm">{label}</span>
            {open ? (
              <div className="flex items-center gap-1.5">
                <Input type="time" className="h-8 w-28" value={day.opens_at.slice(0, 5)} onChange={(e) => setDay(dow, e.target.value, day.closes_at.slice(0, 5))} />
                <span className="text-xs text-muted-foreground">a</span>
                <Input type="time" className="h-8 w-28" value={day.closes_at.slice(0, 5)} onChange={(e) => setDay(dow, day.opens_at.slice(0, 5), e.target.value)} />
              </div>
            ) : (
              <span className="text-xs text-muted-foreground">Cerrado</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
