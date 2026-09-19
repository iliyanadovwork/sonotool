import { describe, it, expect } from 'vitest';
import {
  graphTimestampToEpoch,
  computeResetAt,
  formatResetIn,
  formatResetAbsolute,
} from './publish-reset';

const DAY = 86400;
const NOW_MS = 1_700_000_000_000; // fixed "now" for deterministic countdowns
const NOW_S = Math.floor(NOW_MS / 1000);

describe('graphTimestampToEpoch', () => {
  it('parses an ISO8601 timestamp with a +0000 offset', () => {
    // 2023-11-14T22:13:20+0000 == 1700000000
    expect(graphTimestampToEpoch('2023-11-14T22:13:20+0000')).toBe(1700000000);
  });

  it('honours a non-UTC offset rather than assuming UTC', () => {
    // Same wall-clock but +0100 means one hour earlier in absolute terms.
    const utc = graphTimestampToEpoch('2023-11-14T22:13:20+0000')!;
    const plus1 = graphTimestampToEpoch('2023-11-14T22:13:20+0100')!;
    expect(utc - plus1).toBe(3600);
  });

  it('returns null for null/empty/garbage', () => {
    expect(graphTimestampToEpoch(null)).toBeNull();
    expect(graphTimestampToEpoch(undefined)).toBeNull();
    expect(graphTimestampToEpoch('')).toBeNull();
    expect(graphTimestampToEpoch('not-a-date')).toBeNull();
  });
});

describe('computeResetAt', () => {
  it('returns newest post + window when usage > 0', () => {
    expect(computeResetAt({ quotaUsage: 3, newestPostEpoch: NOW_S, windowSeconds: DAY })).toBe(NOW_S + DAY);
  });

  it('returns null when nothing has been used (nothing to reset)', () => {
    expect(computeResetAt({ quotaUsage: 0, newestPostEpoch: NOW_S, windowSeconds: DAY })).toBeNull();
  });

  it('returns null when the newest-post timestamp is unknown', () => {
    expect(computeResetAt({ quotaUsage: 5, newestPostEpoch: null, windowSeconds: DAY })).toBeNull();
  });

  it('returns null for a non-positive or non-finite window', () => {
    expect(computeResetAt({ quotaUsage: 5, newestPostEpoch: NOW_S, windowSeconds: 0 })).toBeNull();
    expect(computeResetAt({ quotaUsage: 5, newestPostEpoch: NOW_S, windowSeconds: NaN })).toBeNull();
  });
});

describe('formatResetIn', () => {
  it('formats hours and minutes', () => {
    expect(formatResetIn(NOW_S + 3 * 3600 + 20 * 60, NOW_MS)).toBe('3h 20m');
  });

  it('drops the minutes segment on a whole hour', () => {
    expect(formatResetIn(NOW_S + 5 * 3600, NOW_MS)).toBe('5h');
  });

  it('shows minutes only under an hour', () => {
    expect(formatResetIn(NOW_S + 12 * 60, NOW_MS)).toBe('12m');
  });

  it('floors sub-minute deltas to "<1m"', () => {
    expect(formatResetIn(NOW_S + 30, NOW_MS)).toBe('<1m');
  });

  it('clamps a past/zero delta to "now"', () => {
    expect(formatResetIn(NOW_S - 500, NOW_MS)).toBe('now');
    expect(formatResetIn(NOW_S, NOW_MS)).toBe('now');
  });

  it('caps at "~24h" (a rolling window cannot exceed one window length)', () => {
    expect(formatResetIn(NOW_S + DAY, NOW_MS)).toBe('~24h');
    expect(formatResetIn(NOW_S + 25 * 3600, NOW_MS)).toBe('~24h');
  });

  it('returns null for null/invalid input', () => {
    expect(formatResetIn(null, NOW_MS)).toBeNull();
    expect(formatResetIn(NaN, NOW_MS)).toBeNull();
  });
});

describe('formatResetAbsolute', () => {
  it('returns a wall-clock time string for a valid epoch', () => {
    const out = formatResetAbsolute(NOW_S);
    expect(typeof out).toBe('string');
    expect(out).toMatch(/\d/);
  });

  it('returns null for null/invalid input', () => {
    expect(formatResetAbsolute(null)).toBeNull();
    expect(formatResetAbsolute(NaN)).toBeNull();
  });
});
