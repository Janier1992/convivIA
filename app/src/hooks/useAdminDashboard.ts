import { useQuery } from "@tanstack/react-query";
import { rpc } from "@/lib/rpc";
import type { AdminDashboard } from "@/types/domain";
import { useOrganization } from "./useOrganization";

/**
 * Cifras del tablero (una sola consulta a get_admin_dashboard). La usan el
 * inicio y los contadores del menú; se refresca cada minuto solo mientras
 * la pestaña está visible.
 */
export function useAdminDashboard() {
  const { currentOrganizationId } = useOrganization();
  return useQuery({
    queryKey: ["admin-dashboard", currentOrganizationId],
    enabled: !!currentOrganizationId,
    refetchInterval: 60_000,
    queryFn: () => rpc<AdminDashboard>("get_admin_dashboard", { p_organization_id: currentOrganizationId })
  });
}
