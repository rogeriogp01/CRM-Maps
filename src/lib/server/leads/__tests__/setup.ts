/**
 * Loaded BEFORE any test file via `--import` so that modules which throw at
 * import time on missing env (e.g. supabase-admin) have safe defaults.
 *
 * These values are fake — the tests never make real network calls. Adapters
 * accept injected clients/stores to keep tests hermetic.
 */
process.env.NEXT_PUBLIC_SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? "test-service-role-key";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "test-anon-key";
