import { describe, it, expect } from 'vitest';
import { statesMatch } from './oauth-state';

describe('statesMatch', () => {
  it('matches two identical non-empty states', () => {
    const s = 'b3f1c0de-1234-4a56-8bcd-abcdef012345';
    expect(statesMatch(s, s)).toBe(true);
  });

  it('rejects a mismatch', () => {
    expect(statesMatch('aaaa', 'bbbb')).toBe(false);
  });

  it('rejects different lengths (no partial/prefix match)', () => {
    expect(statesMatch('abc', 'abcd')).toBe(false);
    expect(statesMatch('abcd', 'abc')).toBe(false);
  });

  it('rejects an absent expected state (missing cookie)', () => {
    expect(statesMatch('abc', undefined)).toBe(false);
    expect(statesMatch('abc', null)).toBe(false);
    expect(statesMatch('abc', '')).toBe(false);
  });

  it('rejects an absent received state (missing param)', () => {
    expect(statesMatch(undefined, 'abc')).toBe(false);
    expect(statesMatch(null, 'abc')).toBe(false);
    expect(statesMatch('', 'abc')).toBe(false);
  });

  it('rejects two empty/absent states (never vacuously true)', () => {
    expect(statesMatch('', '')).toBe(false);
    expect(statesMatch(null, null)).toBe(false);
    expect(statesMatch(undefined, undefined)).toBe(false);
  });
});
