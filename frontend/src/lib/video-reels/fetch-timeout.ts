// Shared timeout wrapper for external (upstream) fetches. Every server-side
// call to a third party (Instagram Graph, Google, tikwm, Drive, market data)
// should use this so a hung upstream can't consume the whole function budget
// and surface as an opaque platform 500.
//
// On timeout the underlying fetch rejects with an AbortError — callers should
// map that to a clear 504 (use `isAbortError`).

const DEFAULT_TIMEOUT_MS = 15000;

export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

export function isAbortError(error: unknown): boolean {
  return (error as { name?: string } | null)?.name === 'AbortError';
}
