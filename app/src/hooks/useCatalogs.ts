import { useQuery } from "@tanstack/react-query";
import { insforge } from "@/lib/insforgeClient";
import type { Asset, CommonArea, PqrsCategory, Tower, Unit, Vendor } from "@/types/domain";
import { useOrganization } from "./useOrganization";

// Catálogos pequeños que usan varias pantallas (selectores de unidad,
// torre, zona, categoría). Una sola consulta por copropiedad, en caché.

export function useTowers() {
  const { currentOrganizationId: orgId } = useOrganization();
  return useQuery({
    queryKey: ["towers", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await insforge.database
        .from("towers")
        .select("id, organization_id, name, sort_order")
        .eq("organization_id", orgId)
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true });
      if (error) throw error;
      return data as Tower[];
    }
  });
}

export function useUnits() {
  const { currentOrganizationId: orgId } = useOrganization();
  return useQuery({
    queryKey: ["units", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await insforge.database
        .from("units")
        .select("id, organization_id, tower_id, code, unit_type, floor, area_m2, coefficient_pct, is_active, notes, towers(name)")
        .eq("organization_id", orgId)
        .order("code", { ascending: true })
        .limit(5000);
      if (error) throw error;
      return data as unknown as Unit[];
    }
  });
}

export function useCommonAreas() {
  const { currentOrganizationId: orgId } = useOrganization();
  return useQuery({
    queryKey: ["common-areas", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await insforge.database
        .from("common_areas")
        .select("*")
        .eq("organization_id", orgId)
        .order("name", { ascending: true });
      if (error) throw error;
      return data as CommonArea[];
    }
  });
}

export function usePqrsCategories() {
  const { currentOrganizationId: orgId } = useOrganization();
  return useQuery({
    queryKey: ["pqrs-categories", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await insforge.database
        .from("pqrs_categories")
        .select("id, name, sla_hours, is_active, sort_order")
        .eq("organization_id", orgId)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return data as PqrsCategory[];
    }
  });
}

export function useAssets() {
  const { currentOrganizationId: orgId } = useOrganization();
  return useQuery({
    queryKey: ["assets", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await insforge.database
        .from("assets")
        .select("*")
        .eq("organization_id", orgId)
        .order("name", { ascending: true });
      if (error) throw error;
      return data as Asset[];
    }
  });
}

export function useVendors() {
  const { currentOrganizationId: orgId } = useOrganization();
  return useQuery({
    queryKey: ["vendors", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await insforge.database
        .from("vendors")
        .select("*")
        .eq("organization_id", orgId)
        .order("name", { ascending: true });
      if (error) throw error;
      return data as Vendor[];
    }
  });
}
