import { createClient } from "@supabase/supabase-js";
import { devBypassAuth } from "./devBypass";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!devBypassAuth && (!url || !anonKey)) {
  // We don't throw here so the missing-env UI in App.tsx can render a
  // friendly message instead of a blank white screen.
  console.warn(
    "[seneca] Supabase env vars missing. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in apps/web/.env, or set VITE_DEV_BYPASS_AUTH=true.",
  );
}

export const supabase = createClient(
  url ?? "https://invalid",
  anonKey ?? "invalid",
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  },
);

export function hasSupabaseEnv(): boolean {
  return Boolean(url && anonKey);
}
