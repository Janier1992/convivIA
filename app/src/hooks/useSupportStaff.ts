import { useQuery } from "@tanstack/react-query";
import { insforge } from "@/lib/insforgeClient";
import { useAuth } from "./useAuth";

interface SupportStaffInfo {
  isSupportStaff: boolean;
  role: "support" | "admin" | null;
}

/**
 * Si el usuario actual es parte del equipo de soporte (tabla
 * `support_staff`, gestionada a mano por SQL — no hay UI de invitación).
 * Se usa para el link "Soporte" en el menú y para redirigir después del
 * login a quienes no administran ninguna copropiedad.
 */
export function useSupportStaff(): SupportStaffInfo & { isLoading: boolean } {
  const { user } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ["support-staff-self", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await insforge.database
        .from("support_staff")
        .select("role, active")
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data as { role: "support" | "admin"; active: boolean } | null;
    }
  });

  return {
    isSupportStaff: !!data?.active,
    role: data?.active ? data.role : null,
    isLoading
  };
}
