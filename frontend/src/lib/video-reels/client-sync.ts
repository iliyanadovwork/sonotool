import { supabase } from '@/lib/supabase';

// Client helpers that sync this browser's Instagram connection with the user's
// server-side copy (public.meta_accounts). Both are best-effort and no-op when
// logged out. The meta_token cookie stays the runtime store; these keep it in
// sync with the DB so the accounts follow the user across browsers/devices.

const SYNC_TIMEOUT_MS = 8000;

/** The Supabase Bearer header for authenticating meta sync/connect calls. */
export async function getAuthHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// Bounded POST that never throws. Returns true only when the route answered 2xx;
// a non-2xx, network error, or 8s timeout returns false so callers can fail closed.
async function syncPost(path: string, headers: Record<string, string>, body?: unknown): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SYNC_TIMEOUT_MS);
  try {
    const res = await fetch(path, {
      method: 'POST',
      headers: { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
      signal: controller.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Reconcile the cookie to the logged-in user + load their server copy. Returns
 * true only when the reconcile actually completed (route answered ok). Callers
 * MUST NOT read cookie-backed IG state when this returns false — the cookie may
 * still hold a previous user's session (fail closed).
 */
export async function restoreMetaAccounts(): Promise<boolean> {
  let headers: Record<string, string> = {};
  try {
    headers = await getAuthHeader();
  } catch {
    return false;
  }
  if (!headers.Authorization) return false;
  return syncPost('/api/video-reels/meta/restore', headers);
}

/** GET the access-gate status: whether a password is configured and this browser is unlocked. */
export async function fetchUnlockStatus(): Promise<{ configured: boolean; unlocked: boolean }> {
  try {
    const res = await fetch('/api/video-reels/meta/unlock', { cache: 'no-store' });
    if (!res.ok) return { configured: false, unlocked: true };
    return await res.json();
  } catch {
    return { configured: false, unlocked: true };
  }
}

/** Submit the team password. Returns true on success (unlock cookie set). */
export async function submitUnlock(password: string): Promise<boolean> {
  try {
    const auth = await getAuthHeader();
    const res = await fetch('/api/video-reels/meta/unlock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth },
      body: JSON.stringify({ password }),
      cache: 'no-store',
    });
    const data = await res.json().catch(() => ({}));
    return res.ok && data?.ok === true;
  } catch {
    return false;
  }
}
