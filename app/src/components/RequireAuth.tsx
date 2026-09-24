import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";

export function RequireAuth() {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <FullscreenLoader />;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;

  return <Outlet />;
}

export function FullscreenLoader() {
  return (
    <div className="flex h-screen w-full items-center justify-center bg-background">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  );
}
