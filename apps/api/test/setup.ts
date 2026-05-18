/**
 * Vitest setup for the API workspace.
 *
 * Routes pull `env` at import time, which in turn would require real
 * env vars. We pin a deterministic test env here so unit tests never
 * depend on the developer's shell environment.
 */

process.env.NODE_ENV = "test";
process.env.DEV_BYPASS_AUTH = "true";
process.env.WEB_ORIGIN = "http://localhost:5173";
process.env.PORT = "8787";
// Anthropic and Supabase clients are mocked per-test; the keys here are
// placeholders so `env.ts` does not throw during module load.
process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
process.env.SUPABASE_URL = "http://localhost";
process.env.SUPABASE_ANON_KEY = "test-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
