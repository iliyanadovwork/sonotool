import { describe, it, expect } from 'vitest';
import { scryptSync, randomBytes } from 'crypto';
import { verifyPasswordHash, signUnlockToken, checkUnlockToken } from './meta-unlock';

function makeHash(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

const SECRET = 'test-unlock-secret-abc123';
const NOW = 1_000_000_000_000;

describe('verifyPasswordHash', () => {
  const stored = makeHash('OwenLovesSonotrade9!');

  it('accepts the correct password', () => {
    expect(verifyPasswordHash('OwenLovesSonotrade9!', stored)).toBe(true);
  });

  it('rejects wrong passwords (incl. case/whitespace variants)', () => {
    expect(verifyPasswordHash('owenlovessonotrade9!', stored)).toBe(false);
    expect(verifyPasswordHash('OwenLovesSonotrade9', stored)).toBe(false);
    expect(verifyPasswordHash('OwenLovesSonotrade9! ', stored)).toBe(false);
    expect(verifyPasswordHash('', stored)).toBe(false);
  });

  it('rejects when the hash is missing or malformed', () => {
    expect(verifyPasswordHash('x', undefined)).toBe(false);
    expect(verifyPasswordHash('x', '')).toBe(false);
    expect(verifyPasswordHash('x', 'nosalt')).toBe(false);
    expect(verifyPasswordHash('x', ':abcd')).toBe(false);
    expect(verifyPasswordHash('x', 'salt:nothex!!')).toBe(false);
  });

  it('rejects a non-string password', () => {
    expect(verifyPasswordHash(undefined, stored)).toBe(false);
    expect(verifyPasswordHash(12345, stored)).toBe(false);
  });
});

describe('signUnlockToken / checkUnlockToken', () => {
  it('round-trips a valid, unexpired token', () => {
    const tok = signUnlockToken(NOW + 60_000, SECRET);
    expect(checkUnlockToken(tok, SECRET, NOW)).toBe(true);
  });

  it('rejects an expired token', () => {
    const tok = signUnlockToken(NOW - 1, SECRET);
    expect(checkUnlockToken(tok, SECRET, NOW)).toBe(false);
  });

  it('rejects a token signed with a different secret', () => {
    const tok = signUnlockToken(NOW + 60_000, 'other-secret');
    expect(checkUnlockToken(tok, SECRET, NOW)).toBe(false);
  });

  it('rejects a tampered expiry (signature no longer matches)', () => {
    const tok = signUnlockToken(NOW + 60_000, SECRET);
    const forged = `${NOW + 999_999_999}.${tok.split('.')[1]}`;
    expect(checkUnlockToken(forged, SECRET, NOW)).toBe(false);
  });

  it('rejects malformed / empty / non-string tokens', () => {
    expect(checkUnlockToken('', SECRET, NOW)).toBe(false);
    expect(checkUnlockToken('nodot', SECRET, NOW)).toBe(false);
    expect(checkUnlockToken('.sig', SECRET, NOW)).toBe(false);
    expect(checkUnlockToken(undefined, SECRET, NOW)).toBe(false);
    expect(checkUnlockToken(signUnlockToken(NOW + 1000, SECRET), undefined, NOW)).toBe(false);
  });
});
