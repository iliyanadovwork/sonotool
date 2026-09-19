'use client';

// App-global Instagram (Meta) connection.
//
// The connection itself was always app-wide — the IG tokens live in the httpOnly
// `meta_token` cookie shared by every /api/video-reels/meta/* route — but each section used
// to ship its own check/connect UI. This provider centralizes that: it loads the state
// once, handles the OAuth return params, and exposes connect/switch/disconnect to any
// section, while `InstagramSidebarItem` gives the one always-visible control.
//
// Calling /me here also back-fills igUserId/igUsername into the cookie, which the reels
// publish route depends on — so the provider doubles as that required warm-up call.

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { restoreMetaAccounts } from '@/lib/video-reels/client-sync';

export type IgUser = { id: string; username: string };
export type IgAccount = { igUserId?: string; igUsername?: string; isActive: boolean };

interface InstagramConnection {
  igUser: IgUser | null;
  accounts: IgAccount[];
  loading: boolean;
  connect: () => Promise<void>;
  // Resolves to the active user after re-reading /me: an IgUser on success, null
  // when disconnected, or undefined when the read was superseded or a transient
  // 5xx left the previous state in place (callers use this to confirm a switch).
  refresh: () => Promise<IgUser | null | undefined>;
  switchAccount: (igUserId: string) => Promise<void>;
  disconnect: (igUserId?: string) => Promise<void>;
}

const Ctx = createContext<InstagramConnection | null>(null);

export function useInstagramConnection(): InstagramConnection {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useInstagramConnection must be used within InstagramConnectionProvider');
  return ctx;
}

export function InstagramConnectionProvider({ children }: { children: React.ReactNode }) {
  const [igUser, setIgUser] = useState<IgUser | null>(null);
  const [accounts, setAccounts] = useState<IgAccount[]>([]);
  const [loading, setLoading] = useState(true);
  // Refreshes are superseded, never skipped: every call runs, but only the NEWEST one may
  // apply its results. Skipping (a plain in-flight guard) silently dropped the refresh that
  // follows switch/disconnect when a menu-open/focus refresh was still in flight, leaving
  // stale state; superseding also discards out-of-order responses carrying pre-mutation data.
  const seqRef = useRef(0);
  const lastRefreshAt = useRef(0);

  const refresh = useCallback(async () => {
    const seq = ++seqRef.current;
    lastRefreshAt.current = Date.now();
    try {
      const [meRes, accRes] = await Promise.all([
        fetch('/api/video-reels/meta/me'),
        fetch('/api/video-reels/meta/accounts'),
      ]);
      // Only auth statuses mean "not connected" — /me proxies the Graph API and returns
      // 5xx/504 on transient upstream failures, which must NOT flip the app to disconnected.
      let nextUser: IgUser | null | undefined; // undefined = keep previous state
      if (meRes.ok) {
        const d = await meRes.json() as { id?: string; username?: string };
        nextUser = d?.id && d?.username ? { id: d.id, username: d.username } : null;
      } else if (meRes.status === 401 || meRes.status === 403) {
        nextUser = null;
      }
      let nextAccounts: IgAccount[] | undefined;
      if (accRes.ok) {
        const d = await accRes.json() as { accounts?: IgAccount[] };
        nextAccounts = d.accounts ?? [];
      } else if (accRes.status === 401 || accRes.status === 403) {
        nextAccounts = [];
      }
      // /me proxies the Graph API, so it also fails for a page whose app-level API
      // access is blocked — the same failure that empties that page's analytics.
      // /accounts answers from the server-side account store with no Graph call, so
      // fall back to whichever account it reports active. Without this, igUser stays
      // stuck on the PREVIOUS page after a switch: the sidebar shows the wrong
      // @username and Video Reels' post flow can never confirm the switch, so it
      // loops on "please click Post again" forever. Only on `undefined` (unknown) —
      // a 401/403 means genuinely disconnected and must still win.
      if (nextUser === undefined && nextAccounts) {
        const active = nextAccounts.find((a) => a.isActive);
        if (active?.igUserId && active?.igUsername) {
          nextUser = { id: active.igUserId, username: active.igUsername };
        }
      }
      if (seq !== seqRef.current) return undefined; // superseded by a newer refresh
      if (nextUser !== undefined) setIgUser(nextUser);
      if (nextAccounts !== undefined) setAccounts(nextAccounts);
      return nextUser; // resolved active user (undefined = kept previous, e.g. transient 5xx)
    } catch { /* network hiccup — keep previous state */ }
    finally { if (seq === seqRef.current) setLoading(false); }
    return undefined;
  }, []);

  useEffect(() => {
    // Handle the OAuth return (?meta=connected / ?meta_error=…) at the app level, so the
    // round-trip works no matter which section is active when the user connects.
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.has('meta') || params.has('meta_error')) {
        params.delete('meta'); params.delete('meta_error');
        const qs = params.toString();
        window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''));
      }
    } catch { /* ignore */ }
    // Reconcile this browser's cookie to the logged-in user and pull the team-
    // shared IG + Google connections BEFORE the first read, so a fresh browser or
    // new device shows the connected accounts instead of empty. Best-effort — the
    // /meta/restore route also seeds the Google cookie that GoogleConnection reads.
    (async () => {
      try { await restoreMetaAccounts(); } catch { /* best-effort */ }
      refresh();
    })();
    // Re-check on focus so changes made elsewhere (other tab, Video Reels' own switcher) catch
    // up — throttled, since each /me is a live Graph API call sharing the publish rate limit.
    const onFocus = () => { if (Date.now() - lastRefreshAt.current > 60_000) refresh(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);

  const connect = useCallback(async () => {
    try {
      const r = await fetch('/api/video-reels/meta/auth', { cache: 'no-store' });
      const d = await r.json().catch(() => ({}));
      if (d?.url) window.location.href = d.url; // OAuth; returns to /?meta=connected
    } catch { /* ignore */ }
  }, []);

  const switchAccount = useCallback(async (igUserId: string) => {
    try {
      await fetch('/api/video-reels/meta/switch', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ igUserId }),
      });
    } catch { /* ignore */ }
    await refresh();
  }, [refresh]);

  const disconnect = useCallback(async (igUserId?: string) => {
    try {
      await fetch('/api/video-reels/meta/disconnect', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(igUserId ? { igUserId } : {}),
      });
    } catch { /* ignore */ }
    await refresh();
  }, [refresh]);

  return (
    <Ctx.Provider value={{ igUser, accounts, loading, connect, refresh, switchAccount, disconnect }}>
      {children}
    </Ctx.Provider>
  );
}

const IG_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
    <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
    <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
  </svg>
);

// The one global control (lives in the Sidebar): connect when disconnected; when connected,
// shows the active @username and opens a menu to switch / add / disconnect accounts.
export function InstagramSidebarItem() {
  const { igUser, accounts, loading, connect, refresh, switchAccount, disconnect } = useInstagramConnection();
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!boxRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  if (loading) {
    return (
      <div className="w-full flex items-center gap-3 h-9 px-3 text-body-sm text-label-tertiary">
        <span className="shrink-0">{IG_ICON}</span>
        <span className="truncate">Instagram…</span>
      </div>
    );
  }

  if (!igUser) {
    return (
      <button
        type="button"
        onClick={connect}
        className="w-full flex items-center gap-3 h-9 px-3 rounded-md text-body-sm font-medium text-label-secondary hover:text-label hover:bg-surface-2 transition-colors"
      >
        <span className="shrink-0">{IG_ICON}</span>
        <span className="truncate">Connect Instagram</span>
      </button>
    );
  }

  return (
    <div ref={boxRef} className="relative">
      {open && (
        <div className="absolute bottom-full left-0 right-0 mb-1 rounded-md bg-surface-2 border border-separator shadow-lg overflow-hidden">
          {accounts.map(a => (
            <div key={a.igUserId ?? a.igUsername ?? 'unknown'} className="flex items-center">
              <button
                type="button"
                onClick={() => { if (a.igUserId && !a.isActive) switchAccount(a.igUserId); setOpen(false); }}
                className={`flex-1 min-w-0 text-left px-3 py-2 text-body-sm truncate transition-colors ${
                  a.isActive ? 'text-label font-medium' : 'text-label-secondary hover:text-label hover:bg-surface-1'
                }`}
              >
                @{a.igUsername ?? a.igUserId ?? 'unknown'}{a.isActive ? ' ✓' : ''}
              </button>
              {a.igUserId && (
                <button
                  type="button"
                  title="Disconnect this account"
                  onClick={() => disconnect(a.igUserId)}
                  className="shrink-0 px-2 py-2 text-label-tertiary hover:text-danger transition-colors"
                >
                  ×
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={() => { setOpen(false); connect(); }}
            className="w-full text-left px-3 py-2 text-body-sm text-label-secondary hover:text-label hover:bg-surface-1 border-t border-separator transition-colors"
          >
            + Add account
          </button>
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen(o => { const next = !o; if (next) refresh(); return next; })}
        title="Instagram accounts"
        className="w-full flex items-center gap-3 h-9 px-3 rounded-md text-body-sm font-medium text-label-secondary hover:text-label hover:bg-surface-2 transition-colors"
      >
        <span className="shrink-0">{IG_ICON}</span>
        <span className="truncate">@{igUser.username}</span>
      </button>
    </div>
  );
}
