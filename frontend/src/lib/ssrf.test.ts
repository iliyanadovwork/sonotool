/**
 * The SSRF guard, tested against the vectors that actually bypass a naive check.
 *
 * This file exists because the guard was previously implemented TWICE — once
 * correctly in search-grounding.ts and once as a weaker regex copy in
 * remoteImage.ts, which guarded an unauthenticated public route. The weak copy
 * allowed every case in the first block below. There is now one implementation,
 * and this suite is what stops a second one reappearing.
 */
import { describe, it, expect } from 'vitest';
import { isPrivateIp, embeddedIpv4 } from './ssrf';

describe('isPrivateIp — the cases a dotted-decimal regex misses', () => {
  it.each([
    // new URL() serialises [::ffff:127.0.0.1] to ::ffff:7f00:1 — hex, not dotted.
    ['::ffff:7f00:1',            'IPv4-mapped loopback, hex form'],
    ['::ffff:127.0.0.1',         'IPv4-mapped loopback, dotted form'],
    ['0:0:0:0:0:ffff:127.0.0.1', 'IPv4-mapped loopback, expanded'],
    ['::ffff:a9fe:a9fe',         'IPv4-mapped cloud metadata (169.254.169.254)'],
    ['::',                       'unspecified address'],
    ['::1',                      'IPv6 loopback'],
    ['100.64.0.1',               'CGNAT 100.64/10'],
    ['224.0.0.1',                'multicast'],
    ['0.0.0.0',                  '0/8'],
    ['fe80::1',                  'link-local'],
    ['fd00::1',                  'unique local'],
  ])('blocks %s (%s)', (ip) => {
    expect(isPrivateIp(ip)).toBe(true);
  });

  it.each([
    ['127.0.0.1', 'loopback'],
    ['10.0.0.1', '10/8'],
    ['172.16.0.1', '172.16/12'],
    ['172.31.255.255', '172.16/12 upper bound'],
    ['192.168.1.1', '192.168/16'],
    ['169.254.169.254', 'AWS/GCP IMDS'],
  ])('blocks %s (%s)', (ip) => {
    expect(isPrivateIp(ip)).toBe(true);
  });

  it.each([
    ['8.8.8.8', 'public v4'],
    ['1.1.1.1', 'public v4'],
    ['172.15.0.1', 'just below 172.16/12'],
    ['172.32.0.1', 'just above 172.16/12'],
    ['100.63.255.255', 'just below CGNAT'],
    ['100.128.0.1', 'just above CGNAT'],
    ['223.255.255.255', 'just below multicast'],
    ['2606:4700:4700::1111', 'public v6'],
  ])('allows %s (%s)', (ip) => {
    expect(isPrivateIp(ip)).toBe(false);
  });

  it('treats anything unresolvable as unsafe', () => {
    expect(isPrivateIp('not-an-ip')).toBe(true);
    expect(isPrivateIp('')).toBe(true);
  });
});

describe('embeddedIpv4', () => {
  it('decodes both the hex and dotted encodings', () => {
    expect(embeddedIpv4('::ffff:7f00:1')).toBe('127.0.0.1');
    expect(embeddedIpv4('::ffff:127.0.0.1')).toBe('127.0.0.1');
    expect(embeddedIpv4('::ffff:a9fe:a9fe')).toBe('169.254.169.254');
  });

  it('returns null when there is no embedded v4', () => {
    expect(embeddedIpv4('2606:4700:4700::1111')).toBeNull();
  });
});
