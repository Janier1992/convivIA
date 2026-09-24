import { useQuery } from "@tanstack/react-query";
import { insforge } from "@/lib/insforgeClient";
import type { PropertyProfile } from "@/types/domain";
import { useOrganization } from "./useOrganization";

/** Perfil completo de la copropiedad actual (compartido por varias pantallas vía caché). */
export function usePropertyProfile() {
  const { currentOrganizationId } = useOrganization();
  return useQuery({
    queryKey: ["property-profile", currentOrganizationId],
    enabled: !!currentOrganizationId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await insforge.database
        .from("property_profiles")
        .select("*")
        .eq("organization_id", currentOrganizationId)
        .single();
      if (error) throw error;
      return data as PropertyProfile;
    }
  });
}
