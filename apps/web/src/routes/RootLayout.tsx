import { Outlet } from "react-router-dom";

import { MissingEnv } from "../components/MissingEnv";
import { devBypassAuth } from "../lib/devBypass";
import { hasSupabaseEnv } from "../lib/supabase";
import { HashRedirect } from "./HashRedirect";

export function RootLayout() {
  if (!devBypassAuth && !hasSupabaseEnv()) {
    return <MissingEnv />;
  }
  return (
    <>
      <HashRedirect />
      <Outlet />
    </>
  );
}
