// SSRF host validation, shared by every server-side fetch of a user-supplied URL.
//
// Extracted so there is ONE implementation. There used to be two: this one, and a
// weaker regex-only copy in remoteImage.ts that allowed [::ffff:127.0.0.1], [::],
// CGNAT 100.64/10, multicast, and metadata.google.internal. Two guards on the same
// class of bug is how the weaker one survives.
//
// NOTE on the residual DNS-rebind TOCTOU: fetch re-resolves after hostIsPublic()
// returns, so a name that flips between resolutions is not covered. The realistic
// attack - a page redirecting to an internal address - IS covered, because callers
// re-validate every redirect hop (see safeFetchHtml / fetchGuarded).

import net from 'node:net';
import { lookup } from 'node:dns/promises';

// ── SSRF guard ──────────────────────────────────────────────────────────────
// Decodes the embedded IPv4 from an IPv4-mapped (::ffff:…) or IPv4-compatible
// (::…) IPv6 address, in EITHER dotted-decimal OR hex form. Critical because
// `new URL()` serializes these to hex (e.g. ::ffff:7f00:1, not ::ffff:127.0.0.1),
// which a dotted-only regex would miss — the SSRF-guard bypass caught in review.
export function embeddedIpv4(ipv6Low: string): string | null {
  // Collapse a leading run of explicit zero groups to '::' first. Without this the
  // patterns below are anchored to the COMPRESSED spelling only, and the fully
  // expanded 0:0:0:0:0:ffff:127.0.0.1 — which is the same address — walks straight
  // through. Found by ssrf.test.ts, not by review.
  const addr = ipv6Low.replace(/^(?:0{1,4}:){2,}/, '::');

  const dotted = addr.match(/^::(?:ffff:)?(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (dotted) return dotted[1];
  const hex = addr.match(/^::(?:ffff:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    if (Number.isFinite(hi) && Number.isFinite(lo)) {
      return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
    }
  }
  return null;
}

// Reject private / loopback / link-local / reserved IP ranges.
export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const p = ip.split('.').map(Number);
    if (p.some((n) => Number.isNaN(n))) return true;
    if (p[0] === 0 || p[0] === 10 || p[0] === 127) return true;      // 0/8, 10/8, loopback
    if (p[0] === 169 && p[1] === 254) return true;                   // link-local (incl. cloud IMDS)
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;       // 172.16/12
    if (p[0] === 192 && p[1] === 168) return true;                   // 192.168/16
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true;      // CGNAT 100.64/10
    if (p[0] >= 224) return true;                                    // multicast / reserved
    return false;
  }
  if (net.isIPv6(ip)) {
    const low = ip.toLowerCase();
    if (low === '::1' || low === '::') return true;                  // loopback / unspecified
    if (low.startsWith('fe80') || low.startsWith('fc') || low.startsWith('fd')) return true; // link-local / ULA
    // IPv4-mapped / -compatible — decode the embedded v4 (dotted OR hex) and recurse.
    const v4 = embeddedIpv4(low);
    if (v4) return isPrivateIp(v4);
    return false;
  }
  return true; // unresolvable → treat as unsafe
}

// True only if the host is a public name/IP. NOTE: there's a residual DNS-rebind
// TOCTOU (fetch re-resolves after this check) — acceptable for this reviewed,
// rare, best-effort scrape; the realistic attack (a result page redirecting to
// an internal address) IS blocked because we re-validate every redirect hop.
export async function hostIsPublic(hostname: string): Promise<boolean> {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) return false;
  if (/(^|\.)localhost$/.test(h) || /\.(local|internal)$/.test(h) || h === 'metadata.google.internal') return false;
  if (net.isIP(h)) return !isPrivateIp(h);
  try {
    const addrs = await lookup(h, { all: true });
    return addrs.length > 0 && addrs.every((a) => !isPrivateIp(a.address));
  } catch {
    return false;
  }
}
