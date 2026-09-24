import { Navigate, Outlet } from "react-router-dom";
import { useSupportStaff } from "@/hooks/useSupportStaff";
import { FullscreenLoader } from "./RequireAuth";

/** Gatea /soporte a nivel de ruta. RLS ya lo protege a nivel de datos (esto es solo UX). */
export function RequireSupportStaff() {
  const { isSupportStaff, isLoading } = useSupportStaff();

  if (isLoading) return <FullscreenLoader />;
  if (!isSupportStaff) return <Navigate to="/dashboard" replace />;

  return <Outlet />;
}
