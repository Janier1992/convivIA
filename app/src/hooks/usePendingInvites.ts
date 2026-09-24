import { useQuery } from "@tanstack/react-query";
import { insforge } from "@/lib/insforgeClient";
import { useAuth } from "./useAuth";
import type { OrganizationRole } from "@/types/domain";

export interface PendingInvite {
  id: string;
  organization_id: string;
  email: string;
  role: Exclude<OrganizationRole, "owner">;
  status: "pending" | "accepted" | "revoked";
  organizations?: { name: string } | null;
}

/** Invitaciones pendientes dirigidas al email del usuario logueado (para aceptarlas). */
export function usePendingInvitesForMe() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["pending-invites-for-me", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await insforge.database
        .from("organization_invites")
        .select("*, organizations(name)")
        .eq("status", "pending");
      if (error) throw error;
      const rows = (data ?? []) as PendingInvite[];
      return rows.filter((r) => r.email.toLowerCase() === user!.email.toLowerCase());
    }
  });
}
