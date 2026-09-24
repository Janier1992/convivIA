import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { insforge } from "@/lib/insforgeClient";
import { useAuth } from "./useAuth";
import type { OrganizationMembership, OrganizationRole, Permission } from "@/types/domain";

const STORAGE_KEY = "convivia:current-org";

function readStoredOrg(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeOrg(id: string) {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Navegación privada: se pierde solo la preferencia, no la sesión.
  }
}

interface OrganizationContextValue {
  memberships: OrganizationMembership[];
  currentOrganizationId: string | null;
  currentOrganization: OrganizationMembership["organizations"] | null;
  currentRole: OrganizationRole | null;
  permissions: Set<Permission>;
  /** El panel oculta lo que el rol no puede hacer; la base de datos lo impide igual (RLS). */
  can: (permission: Permission) => boolean;
  isLoading: boolean;
  setCurrentOrganizationId: (id: string) => void;
  refetch: () => void;
}

const OrganizationContext = createContext<OrganizationContextValue | null>(null);

export function OrganizationProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [currentOrganizationId, setCurrentOrganizationIdState] = useState<string | null>(readStoredOrg);

  const { data: memberships = [], isLoading } = useQuery({
    queryKey: ["organization-memberships", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await insforge.database
        .from("organization_members")
        .select("organization_id, role, organizations(*)")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as OrganizationMembership[];
    }
  });

  useEffect(() => {
    if (memberships.length === 0) return;
    if (!memberships.some((m) => m.organization_id === currentOrganizationId)) {
      setCurrentOrganizationIdState(memberships[0].organization_id);
      storeOrg(memberships[0].organization_id);
    }
  }, [memberships, currentOrganizationId]);

  const { data: permissionList = [], isLoading: permissionsLoading } = useQuery({
    queryKey: ["my-permissions", currentOrganizationId],
    enabled: !!currentOrganizationId && memberships.some((m) => m.organization_id === currentOrganizationId),
    queryFn: async () => {
      const { data, error } = await insforge.database.rpc("get_my_permissions", { p_organization_id: currentOrganizationId });
      if (error) throw error;
      return (data ?? []) as Permission[];
    }
  });

  const permissions = useMemo(() => new Set(permissionList), [permissionList]);
  const can = useCallback((permission: Permission) => permissions.has(permission), [permissions]);
  const membership = memberships.find((m) => m.organization_id === currentOrganizationId) ?? null;

  const value: OrganizationContextValue = {
    memberships,
    currentOrganizationId,
    currentOrganization: membership?.organizations ?? null,
    currentRole: membership?.role ?? null,
    permissions,
    can,
    isLoading: isLoading || (!!membership && permissionsLoading),
    setCurrentOrganizationId: (id) => {
      storeOrg(id);
      setCurrentOrganizationIdState(id);
    },
    refetch: () => queryClient.invalidateQueries({ queryKey: ["organization-memberships", user?.id] })
  };

  return <OrganizationContext.Provider value={value}>{children}</OrganizationContext.Provider>;
}

export function useOrganization() {
  const ctx = useContext(OrganizationContext);
  if (!ctx) throw new Error("useOrganization debe usarse dentro de <OrganizationProvider>");
  return ctx;
}

/** Id de la copropiedad actual; solo usar dentro de rutas protegidas por RequireOrganization. */
export function useOrgId(): string {
  const { currentOrganizationId } = useOrganization();
  return currentOrganizationId ?? "";
}
