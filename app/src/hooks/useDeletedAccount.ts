import { useQuery } from "@tanstack/react-query";
import { insforge } from "@/lib/insforgeClient";
import { useAuth } from "./useAuth";

/**
 * Si la copropiedad de este usuario fue eliminada por un admin de soporte
 * (tabla `deleted_user_accounts`, poblada por un trigger cuando se borra
 * una organización desde /soporte — ver migración *_platform.sql). InsForge no
 * permite eliminar la cuenta de auth en sí, así que esta es la señal que
 * usa RequireOrganization para no mandar a esta persona de nuevo al wizard
 * de onboarding como si fuera una cuenta nueva.
 */
export function useDeletedAccount(): { isDeletedAccount: boolean; isLoading: boolean } {
  const { user } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ["deleted-account-self", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await insforge.database.from("deleted_user_accounts").select("user_id").eq("user_id", user!.id).maybeSingle();
      if (error) throw error;
      return !!data;
    }
  });

  return { isDeletedAccount: !!data, isLoading };
}
