// Pure helpers for the "Instagram post limit resets at" feature.
//
// Meta's content_publishing_limit endpoint returns only a usage COUNT (quota_usage)
// plus static config (quota_total, quota_duration) — it does NOT return a reset
// time, because the quota is a rolling window: each API-published post ages out
// exactly quota_duration seconds after it was posted. Per the product decision we
// show a single "fully clears" time = the newest post in the window + the window
// length (rather than a per-slot breakdown). That newest-post timestamp comes from
// the account's /media edge; these helpers turn it into a reset epoch + label.

/** Parse a Graph API timestamp (ISO8601 WITH offset, e.g. "2024-06-01T12:00:00+0000") to epoch seconds, or null. */
export function graphTimestampToEpoch(ts: string | null | undefined): number | null {
  if (!ts) return null;
  const ms = new Date(ts).getTime(); // Date honours the embedded offset — do not assume UTC.
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
}

/**
 * The reset epoch (seconds) = newest post in the window + windowSeconds.
 * Returns null when nothing is used, no post timestamp is known, or the window is invalid —
 * i.e. when there is no meaningful reset to show.
 */
export function computeResetAt(opts: {
  quotaUsage: number;
  newestPostEpoch: number | null;
  windowSeconds: number;
}): number | null {
  const { quotaUsage, newestPostEpoch, windowSeconds } = opts;
  if (!Number.isFinite(quotaUsage) || quotaUsage <= 0) return null; // nothing used → nothing to reset
  if (newestPostEpoch == null || !Number.isFinite(newestPostEpoch)) return null;
  if (!Number.isFinite(windowSeconds) || windowSeconds <= 0) return null;
  return newestPostEpoch + windowSeconds;
}

/**
 * Relative countdown to a reset epoch: "now", "<1m", "12m", "3h 20m", "~24h".
 * Capped at ~24h (a rolling window can never be further out than one window length).
 * Returns null for a null/invalid input.
 */
export function formatResetIn(resetAtEpochSeconds: number | null, nowMs: number = Date.now()): string | null {
  if (resetAtEpochSeconds == null || !Number.isFinite(resetAtEpochSeconds)) return null;
  const deltaSec = resetAtEpochSeconds - Math.floor(nowMs / 1000);
  if (deltaSec <= 0) return 'now';
  if (deltaSec < 60) return '<1m';
  const totalMin = Math.floor(deltaSec / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h >= 24) return '~24h';
  if (h <= 0) return `${m}m`;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

/** Absolute local wall-clock time for a hover title, e.g. "6:45 PM". Null for invalid input. */
export function formatResetAbsolute(resetAtEpochSeconds: number | null): string | null {
  if (resetAtEpochSeconds == null || !Number.isFinite(resetAtEpochSeconds)) return null;
  const d = new Date(resetAtEpochSeconds * 1000);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
