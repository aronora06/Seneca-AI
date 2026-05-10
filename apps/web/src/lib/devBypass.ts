/**
 * Dev-bypass flag. When true, the web app skips Supabase entirely and
 * signs in as a fixed "dev" user. Set VITE_DEV_BYPASS_AUTH=true in
 * apps/web/.env (the default in .env.example).
 *
 * Must match DEV_BYPASS_AUTH on the API side.
 */

function flag(name: string): boolean {
  const v = (import.meta.env as Record<string, string | undefined>)[name];
  if (!v) return false;
  return /^(1|true|yes|on)$/i.test(v.trim());
}

export const devBypassAuth = flag("VITE_DEV_BYPASS_AUTH");

/** Stable fake user shown in the UI in dev-bypass mode. */
export const devUser = {
  id: "00000000-0000-0000-0000-000000000001",
  email: "dev@local",
};

/** A non-empty string sent as the bearer token so logging still shows
 * an Authorization header. The API ignores its contents in bypass mode. */
export const devBearer = "dev-bypass";
