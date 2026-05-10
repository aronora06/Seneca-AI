import { createClient } from "@supabase/supabase-js";
import { env } from "../env.js";

/**
 * Service-role client. Bypasses RLS, used for trusted server-side writes
 * (transcript saves, whiteboard persistence). NEVER expose this key to
 * the browser.
 *
 * Lazy: in DEV_BYPASS_AUTH mode we never call this, and we don't want a
 * missing Supabase URL to crash the boot. Calling supabaseAdmin() without
 * Supabase configured throws a clear error.
 */
let _admin: ReturnType<typeof createClient> | null = null;
export function supabaseAdmin() {
  if (_admin) return _admin;
  if (!env.supabaseUrl || !env.supabaseServiceRoleKey) {
    throw new Error(
      "Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in apps/api/.env, or set DEV_BYPASS_AUTH=true.",
    );
  }
  _admin = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _admin;
}

/**
 * Builds a per-request client scoped to the user's JWT. This client goes
 * through Postgres RLS, so it can only see/modify rows the user actually
 * owns. We use it for any read-then-act-on-behalf flow where we want the
 * policy engine to be the source of truth.
 */
export function supabaseForUser(jwt: string) {
  if (!env.supabaseUrl || !env.supabaseAnonKey) {
    throw new Error(
      "Supabase is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY in apps/api/.env, or set DEV_BYPASS_AUTH=true.",
    );
  }
  return createClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
}
