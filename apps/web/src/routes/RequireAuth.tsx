import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";

import { useAuth } from "../auth/AuthProvider";
import { BootSplash } from "../components/BootSplash";
import { devBypassAuth } from "../lib/devBypass";

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading && !devBypassAuth) return <BootSplash />;
  if (!user && !devBypassAuth) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return <>{children}</>;
}
