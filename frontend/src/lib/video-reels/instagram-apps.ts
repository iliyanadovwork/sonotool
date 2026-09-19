// Registry of Instagram OAuth apps. The tool can be wired to several Meta apps
// at once (one per Instagram profile): the app is only needed at CONNECT time
// (the OAuth code→token exchange), so the user picks which app to connect
// through, and every connected account then lives together in the account
// switcher. Publishing / refresh use the stored per-account token and never
// touch these credentials.
//
// Config source (server-only — contains secrets):
//   INSTAGRAM_APPS = JSON array of { key?, label?, appId, appSecret }
// Falls back to the legacy single-app vars (INSTAGRAM_APP_ID / _APP_SECRET) so
// nothing breaks when only one app is configured. The shared redirect URI stays
// in INSTAGRAM_REDIRECT_URI (every app registers the same callback).

export interface InstagramAppConfig {
  key: string;      // stable slug used in the ?app= param + oauth cookie
  label: string;    // human label shown in the connect picker (the profile name)
  appId: string;
  appSecret: string;
}

// key-safe slug: lowercase, non-alphanumerics collapsed to '-'.
function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'app';
}

/**
 * Pure parser (no process.env) so it's unit-testable. Builds the app list from
 * the INSTAGRAM_APPS JSON, and if that yields nothing, from the single-app
 * fallback fields. Invalid entries (missing appId/appSecret) are skipped; keys
 * are derived from label when absent and de-duplicated.
 */
export function parseInstagramApps(
  rawApps: string | undefined | null,
  fallbackId?: string | null,
  fallbackSecret?: string | null,
  fallbackLabel?: string | null,
): InstagramAppConfig[] {
  const out: InstagramAppConfig[] = [];
  const seen = new Set<string>();

  const pushUniqueKey = (base: string): string => {
    let key = base;
    if (seen.has(key)) {
      let i = 2;
      while (seen.has(`${base}-${i}`)) i++;
      key = `${base}-${i}`;
    }
    seen.add(key);
    return key;
  };

  if (typeof rawApps === 'string' && rawApps.trim()) {
    let parsed: unknown = null;
    try { parsed = JSON.parse(rawApps); } catch { parsed = null; }
    if (Array.isArray(parsed)) {
      for (const entry of parsed) {
        if (!entry || typeof entry !== 'object') continue;
        const e = entry as Record<string, unknown>;
        const appId = typeof e.appId === 'string' ? e.appId.trim() : '';
        const appSecret = typeof e.appSecret === 'string' ? e.appSecret.trim() : '';
        if (!appId || !appSecret) continue;
        const rawKey = typeof e.key === 'string' && e.key.trim() ? e.key.trim() : '';
        const label = typeof e.label === 'string' && e.label.trim()
          ? e.label.trim()
          : (rawKey || appId);
        const key = pushUniqueKey(slugify(rawKey || label));
        out.push({ key, label, appId, appSecret });
      }
    }
  }

  if (out.length === 0) {
    const id = typeof fallbackId === 'string' ? fallbackId.trim() : '';
    const secret = typeof fallbackSecret === 'string' ? fallbackSecret.trim() : '';
    if (id && secret) {
      out.push({
        key: 'default',
        label: (typeof fallbackLabel === 'string' && fallbackLabel.trim()) || 'Instagram',
        appId: id,
        appSecret: secret,
      });
    }
  }

  return out;
}

/** All configured apps (with secrets — server-only). */
export function getInstagramApps(): InstagramAppConfig[] {
  return parseInstagramApps(
    process.env.INSTAGRAM_APPS,
    process.env.INSTAGRAM_APP_ID,
    process.env.INSTAGRAM_APP_SECRET,
  );
}

/** The app matching `key`, or null when the key is absent/unknown. */
export function getInstagramApp(key: string | null | undefined): InstagramAppConfig | null {
  if (!key) return null;
  return getInstagramApps().find(a => a.key === key) ?? null;
}

/** The first configured app — used as the default when no key is supplied. */
export function getDefaultInstagramApp(): InstagramAppConfig | null {
  return getInstagramApps()[0] ?? null;
}

/** Secret-free list for the client's connect picker. */
export function getPublicInstagramApps(): { key: string; label: string }[] {
  return getInstagramApps().map(a => ({ key: a.key, label: a.label }));
}
