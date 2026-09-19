import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Service-role Supabase client for headless (CLI / render) use. It bypasses RLS,
// so callers MUST supply user_id explicitly (the requesting human's id). Reads env
// — a standalone script must load .env.local first (see scripts/load-env.ts).
export function createAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    throw new Error(
      'createAdminClient: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be set (load .env.local first).',
    );
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
