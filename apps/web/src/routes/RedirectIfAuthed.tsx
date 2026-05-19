import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";

import { useAuth } from "../auth/AuthProvider";
import { BootSplash } from "../components/BootSplash";
import { devBypassAuth } from "../lib/devBypass";

export function RedirectIfAuthed({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();

  if (loading && !devBypassAuth) return <BootSplash />;
  if (user || devBypassAuth) {
    return <Navigate to="/app" replace />;
  }
  return <>{children}</>;
}
