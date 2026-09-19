// Lightweight idempotency store backed by Vercel KV / Upstash Redis (REST).
//
// Used to make Instagram publishing exactly-once: a request carrying an
// idempotency key atomically *claims* it before doing any work. Retries or
// platform replays of the same key short-circuit to the stored result (or a
// "still in progress" signal) instead of creating a second Reel.
//
// If KV is not configured (no KV_REST_API_URL / KV_REST_API_TOKEN), every
// function degrades to a safe no-op, so the app still works — it just falls back
// to the client-side guards + the route's maxDuration for dedup. Provision a
// Vercel KV / Upstash store (which sets those env vars) to enable true
// server-side exactly-once.

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const TTL_SECONDS = 60 * 60; // keys live 1h — long enough to dedupe retries

export function idempotencyEnabled(): boolean {
  return !!(KV_URL && KV_TOKEN);
}

// Surface the silent-degradation case once per process so a missing KV store is
// visible in logs instead of quietly turning exactly-once into best-effort.
let warnedDisabled = false;
function warnIfDisabledOnce(): void {
  if (!idempotencyEnabled() && !warnedDisabled) {
    warnedDisabled = true;
    console.warn(
      '[idempotency] KV not configured (KV_REST_API_URL / KV_REST_API_TOKEN missing) — ' +
      'publish exactly-once is DISABLED; falling back to client guards + maxDuration only.',
    );
  }
}

export type IdempotencyClaim =
  | { state: 'claimed' } // we won the claim → proceed with the work
  | { state: 'in_progress' } // another invocation is already doing the work
  | { state: 'done'; result: unknown } // already completed → reuse the result
  | { state: 'disabled' }; // KV not configured → proceed without protection

// Upstash/Vercel-KV REST always answers with a single-field JSON envelope:
// `{ result }` on success, `{ error }` on a command error.
interface KvReply {
  result?: unknown;
  error?: string;
}

// Send a single Redis command to the Upstash/Vercel-KV REST endpoint. Bounded
// by a short timeout so a hung KV endpoint can't stall a publish — callers treat
// any throw as "degrade to unprotected" rather than failing the request.
async function kv(command: (string | number)[]): Promise<KvReply> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(KV_URL!, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${KV_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(command),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`KV request failed: ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

// Atomically claim a key via `SET key value NX EX ttl`. The NX flag is the
// atomic guarantee: only the first caller creates the key, so exactly one
// invocation gets `claimed`.
export async function claimIdempotencyKey(key: string): Promise<IdempotencyClaim> {
  if (!idempotencyEnabled()) {
    warnIfDisabledOnce();
    return { state: 'disabled' };
  }
  const k = `idem:${key}`;
  try {
    const setRes = await kv(['SET', k, JSON.stringify({ status: 'in_progress' }), 'NX', 'EX', TTL_SECONDS]);
    if (setRes?.result === 'OK') return { state: 'claimed' };

    // Key already exists — read its current state.
    const getRes = await kv(['GET', k]);
    const raw = getRes?.result;
    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw);
        if (parsed?.status === 'done') return { state: 'done', result: parsed.result };
      } catch {
        /* fall through to in_progress */
      }
    }
    return { state: 'in_progress' };
  } catch (e) {
    // Never let a KV hiccup block a real publish — degrade to unprotected.
    console.error('[idempotency] claim failed, proceeding without protection:', e);
    return { state: 'disabled' };
  }
}

// Record the successful result so future requests with the same key reuse it.
export async function completeIdempotencyKey(key: string, result: unknown): Promise<void> {
  if (!idempotencyEnabled()) return;
  try {
    await kv(['SET', `idem:${key}`, JSON.stringify({ status: 'done', result }), 'EX', TTL_SECONDS]);
  } catch (e) {
    console.error('[idempotency] complete failed:', e);
  }
}

// Release a claim on failure so the user can retry the same key.
export async function releaseIdempotencyKey(key: string): Promise<void> {
  if (!idempotencyEnabled()) return;
  try {
    await kv(['DEL', `idem:${key}`]);
  } catch (e) {
    console.error('[idempotency] release failed:', e);
  }
}
