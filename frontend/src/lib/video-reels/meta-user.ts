import { createClient } from '@supabase/supabase-js';

// Resolve the logged-in app user from a request's `Authorization: Bearer <jwt>`
// header (the Supabase access token the client attaches). Verified against
// Supabase Auth with the anon key. Returns the user id, or null when the header
// is missing/invalid — callers treat null as "not authenticated". Used only by
// the per-user token backup/restore routes, so a user's IG accounts sync to
// their own login and no one else's.

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export async function getRequestUserId(request: Request): Promise<string | null> {
  try {
    if (!url || !anonKey) return null;
    const header = request.headers.get('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) return null;

    const supa = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await supa.auth.getUser(token);
    if (error || !data?.user?.id) return null;
    return data.user.id;
  } catch {
    return null;
  }
}
