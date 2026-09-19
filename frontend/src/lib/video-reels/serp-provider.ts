// Pluggable Google-SERP provider — a morphic-style one-file swap between
// vendors. Serper.dev is the DEFAULT (pay-as-you-go on our own key); SerpApi is
// a drop-in alternative (subscription account we don't own, so opt-in only via
// SERP_PROVIDER=serpapi). Both adapters normalize to one shape and NEVER throw —
// every failure is returned as a structured outcome so callers can fall through.

export interface SerpResultItem {
  title: string;
  url: string;
  snippet: string;
  date?: string;
}

export interface SerpResponse {
  provider: 'serper' | 'serpapi';
  answer?: string;    // answer-box direct answer/snippet, when present
  knowledge?: string; // knowledge-graph facts (title/type/description/attributes)
  results: SerpResultItem[];
}

// Shape of the vendor knowledge-graph blob we actually read (both vendors send
// more fields; every one of these can be absent or a non-string in the wild).
interface SerpKnowledgeGraph {
  title?: unknown;
  type?: unknown;
  description?: unknown;
  attributes?: unknown;
}

// Flatten a knowledge-graph object (Serper camelCase or SerpApi snake_case) into
// a compact fact string. Structured attributes (Born, Genre, Albums…) are prime
// grounding material, so we keep them, not just the description.
function formatKnowledge(kg: unknown): string | undefined {
  if (!kg || typeof kg !== 'object') return undefined;
  const g = kg as SerpKnowledgeGraph;
  const attrs = g.attributes && typeof g.attributes === 'object'
    ? Object.entries(g.attributes).map(([k, v]) => `${k}: ${v}`).join('; ')
    : '';
  const parts = [g.title, g.type, g.description, attrs].filter((p): p is string => typeof p === 'string' && !!p.trim());
  return parts.length ? parts.join(' — ') : undefined;
}

// One organic result row as returned by either vendor (same field names).
interface SerpOrganicItem {
  title?: string;
  link?: string;
  snippet?: string;
  date?: string;
}

export type SerpOutcome =
  | { ok: true; data: SerpResponse }
  | { ok: false; rateLimited: boolean; status: number; detail: string };

const SERP_TIMEOUT_MS = 12_000;

// Which provider to use: honour SERP_PROVIDER when its key exists, else prefer
// Serper (our key), else SerpApi, else none.
export function serpProviderName(): 'serper' | 'serpapi' | null {
  const pref = (process.env.SERP_PROVIDER || '').trim().toLowerCase();
  const hasSerper = !!process.env.SERPER_API_KEY?.trim();
  const hasSerpapi = !!process.env.SERPAPI_KEY?.trim();
  if (pref === 'serpapi' && hasSerpapi) return 'serpapi';
  if (pref === 'serper' && hasSerper) return 'serper';
  if (hasSerper) return 'serper';
  if (hasSerpapi) return 'serpapi';
  return null;
}

export function hasSerpProvider(): boolean {
  return serpProviderName() !== null;
}

// Shared timed fetch that never leaks the AbortController timer.
async function timedFetch(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function abortStatus(e: unknown): { rateLimited: boolean; status: number; detail: string } {
  const aborted = (e as { name?: string })?.name === 'AbortError';
  return { rateLimited: false, status: aborted ? 504 : 502, detail: aborted ? 'SERP request timed out' : ((e as { message?: string })?.message || 'SERP request failed') };
}

// --- Serper.dev (POST, camelCase response) ---
async function serperSearch(query: string, num: number): Promise<SerpOutcome> {
  const key = process.env.SERPER_API_KEY?.trim();
  if (!key) return { ok: false, rateLimited: false, status: 500, detail: 'SERPER_API_KEY not set' };
  try {
    const res = await timedFetch(
      'https://google.serper.dev/search',
      {
        method: 'POST',
        headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: query, num, gl: 'us' }),
      },
      SERP_TIMEOUT_MS,
    );
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return { ok: false, rateLimited: res.status === 429, status: res.status, detail: detail.slice(0, 200) };
    }
    const d = await res.json();
    const answer: string | undefined = d.answerBox?.answer || d.answerBox?.snippet || undefined;
    const knowledge = formatKnowledge(d.knowledgeGraph);
    const results: SerpResultItem[] = (Array.isArray(d.organic) ? d.organic : [])
      .map((o: SerpOrganicItem | null) => ({ title: o?.title || '', url: o?.link || '', snippet: o?.snippet || '', date: o?.date || undefined }))
      .filter((r: SerpResultItem) => r.snippet || r.title);
    return { ok: true, data: { provider: 'serper', answer, knowledge, results } };
  } catch (e) {
    return { ok: false, ...abortStatus(e) };
  }
}

// --- SerpApi (GET, snake_case response) ---
async function serpapiSearch(query: string, num: number): Promise<SerpOutcome> {
  const key = process.env.SERPAPI_KEY?.trim();
  if (!key) return { ok: false, rateLimited: false, status: 500, detail: 'SERPAPI_KEY not set' };
  try {
    const u = new URL('https://serpapi.com/search.json');
    u.searchParams.set('engine', 'google');
    u.searchParams.set('q', query);
    u.searchParams.set('num', String(num));
    u.searchParams.set('gl', 'us');
    u.searchParams.set('api_key', key);
    const res = await timedFetch(u.toString(), { method: 'GET' }, SERP_TIMEOUT_MS);
    // SerpApi may return errors either as a non-2xx or as 200 with { error }.
    const d = await res.json().catch(() => ({}));
    if (!res.ok || d?.error) {
      const detail: string = d?.error || `HTTP ${res.status}`;
      // "Your account has run out of searches." → treat as rate-limited so the
      // caller falls through to the next tier rather than hard-failing.
      const rateLimited = res.status === 429 || /run out of searches|rate limit/i.test(detail);
      return { ok: false, rateLimited, status: rateLimited ? 429 : (res.ok ? 502 : res.status), detail: detail.slice(0, 200) };
    }
    const answer: string | undefined = d.answer_box?.answer || d.answer_box?.snippet || undefined;
    const knowledge = formatKnowledge(d.knowledge_graph);
    const results: SerpResultItem[] = (Array.isArray(d.organic_results) ? d.organic_results : [])
      .map((o: SerpOrganicItem | null) => ({ title: o?.title || '', url: o?.link || '', snippet: o?.snippet || '', date: o?.date || undefined }))
      .filter((r: SerpResultItem) => r.snippet || r.title);
    return { ok: true, data: { provider: 'serpapi', answer, knowledge, results } };
  } catch (e) {
    return { ok: false, ...abortStatus(e) };
  }
}

// Run one Google search through the configured provider. Never throws.
export async function serpSearch(query: string, num = 8): Promise<SerpOutcome> {
  const provider = serpProviderName();
  if (provider === 'serpapi') return serpapiSearch(query, num);
  if (provider === 'serper') return serperSearch(query, num);
  return { ok: false, rateLimited: false, status: 500, detail: 'No SERP provider configured (set SERPER_API_KEY or SERPAPI_KEY)' };
}
