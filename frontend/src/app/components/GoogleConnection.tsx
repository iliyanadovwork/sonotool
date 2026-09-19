'use client';

// App-global Google Sheets connection.
//
// The real access/refresh tokens live only in the httpOnly `google_token` cookie
// + the team-shared row; every /api/video-reels/google/* route reads them
// server-side. This provider tracks ONLY whether we're connected (a boolean —
// never the token), handles the ?google=connected OAuth return, and exposes
// connect/disconnect/refresh so the sidebar control and the posting sub-view share
// one source of truth. The OAuth/token flow (google/auth, google/callback,
// google/me) is unchanged — this only wraps it.

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { restoreMetaAccounts } from '@/lib/video-reels/client-sync';

interface GoogleConnection {
  connected: boolean;
  loading: boolean;
  connect: () => Promise<void>;
  disconnect: () => Promise<boolean>; // resolves true when blocked by the team-password gate
  refresh: () => Promise<void>;
}

const Ctx = createContext<GoogleConnection | null>(null);

export function useGoogleConnection(): GoogleConnection {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useGoogleConnection must be used within GoogleConnectionProvider');
  return ctx;
}

export function GoogleConnectionProvider({ children }: { children: React.ReactNode }) {
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  // Supersede-not-skip (same as InstagramConnection): newest refresh wins.
  const seqRef = useRef(0);
  const lastRefreshAt = useRef(0);

  const refresh = useCallback(async () => {
    const seq = ++seqRef.current;
    lastRefreshAt.current = Date.now();
    try {
      const res = await fetch('/api/video-reels/google/me');
      let next: boolean | undefined; // undefined = keep previous
      if (res.ok) next = true;
      else if (res.status === 401 || res.status === 403) next = false;
      // 5xx/transient: leave undefined so a blip can't flip Sheets to disconnected.
      if (seq !== seqRef.current) return; // superseded
      if (next !== undefined) setConnected(next);
    } catch {
      /* network hiccup — keep previous state */
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Handle the OAuth return (?google=connected / ?google_error=…) app-wide, then
    // strip ONLY the google params (preserve everything else — the Instagram
    // provider strips only ?meta so the two don't clobber each other's params).
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.has('google') || params.has('google_error')) {
        params.delete('google');
        params.delete('google_error');
        const qs = params.toString();
        window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''));
      }
    } catch {
      /* ignore */
    }
    // Reconcile the team-shared connections into this browser (seeds the google_token
    // cookie on a fresh browser/device) BEFORE the first /google/me read, so a
    // teammate's already-connected Sheets shows without a redundant reconnect.
    // Best-effort + idempotent; no-ops when logged out. (The IG provider also calls
    // restore — running it from both is safe.)
    (async () => {
      try { await restoreMetaAccounts(); } catch { /* best-effort */ }
      refresh();
    })();
    const onFocus = () => { if (Date.now() - lastRefreshAt.current > 60_000) refresh(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);

  const connect = useCallback(async () => {
    // Preserve today's flow: clear this browser's cookie first to force fresh
    // consent, then hit the UNCHANGED /google/auth. On a 403 { locked } (team
    // password gate on) this no-ops — mirrors InstagramSidebarItem; the posting
    // sub-view still owns the unlock prompt.
    try { await fetch('/api/video-reels/google/me', { method: 'DELETE' }); } catch { /* none to clear */ }
    setConnected(false);
    try {
      const r = await fetch('/api/video-reels/google/auth', { cache: 'no-store' });
      const d = await r.json().catch(() => ({}));
      // NOTE: /google/auth returns `authUrl` (NOT `url` like /meta/auth).
      if (d?.authUrl) window.location.href = d.authUrl; // OAuth; returns to /?google=connected
    } catch {
      /* ignore */
    }
  }, []);

  const disconnect = useCallback(async (): Promise<boolean> => {
    try {
      // ?shared=1 clears this cookie AND deletes the team-shared row. A 403 means
      // the team-password gate is on and this browser isn't unlocked — report it
      // (don't refresh, which would just reassert connected) so the caller can hint.
      const res = await fetch('/api/video-reels/google/me?shared=1', { method: 'DELETE' });
      if (res.status === 403) return true;
    } catch {
      /* ignore */
    }
    await refresh();
    return false;
  }, [refresh]);

  return (
    <Ctx.Provider value={{ connected, loading, connect, disconnect, refresh }}>
      {children}
    </Ctx.Provider>
  );
}

const SHEETS_ICON = (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="4" y="3" width="16" height="18" rx="2" />
    <line x1="4" y1="9" x2="20" y2="9" />
    <line x1="4" y1="15" x2="20" y2="15" />
    <line x1="10" y1="9" x2="10" y2="21" />
  </svg>
);

// The one global Google Sheets control (lives in the Sidebar): connect when
// disconnected; when connected, click to open a popover with Disconnect.
export function GoogleSidebarItem() {
  const { connected, loading, connect, disconnect, refresh } = useGoogleConnection();
  const [open, setOpen] = useState(false);
  const [locked, setLocked] = useState(false);
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
        <span className="shrink-0">{SHEETS_ICON}</span>
        <span className="truncate">Google Sheets…</span>
      </div>
    );
  }

  if (!connected) {
    return (
      <button
        type="button"
        onClick={connect}
        className="w-full flex items-center gap-3 h-9 px-3 rounded-md text-body-sm font-medium text-label-secondary hover:text-label hover:bg-surface-2 transition-colors"
      >
        <span className="shrink-0">{SHEETS_ICON}</span>
        <span className="truncate">Connect Google Sheets</span>
      </button>
    );
  }

  return (
    <div ref={boxRef} className="relative">
      {open && (
        <div className="absolute bottom-full left-0 right-0 mb-1 rounded-md bg-surface-2 border border-separator shadow-lg overflow-hidden">
          {locked && (
            <div className="px-3 py-2 text-caption-sm text-label-tertiary border-b border-separator">
              Enter the team password in Video Reels to disconnect.
            </div>
          )}
          <button
            type="button"
            onClick={async () => { const wasLocked = await disconnect(); if (wasLocked) setLocked(true); else setOpen(false); }}
            className="w-full text-left px-3 py-2 text-body-sm text-label-secondary hover:text-danger hover:bg-surface-1 transition-colors"
          >
            Disconnect
          </button>
        </div>
      )}
      <button
        type="button"
        title="Google Sheets"
        onClick={() => setOpen(o => { const next = !o; if (next) { setLocked(false); refresh(); } return next; })}
        className="w-full flex items-center gap-3 h-9 px-3 rounded-md text-body-sm font-medium text-label-secondary hover:text-label hover:bg-surface-2 transition-colors"
      >
        <span className="shrink-0 text-success">{SHEETS_ICON}</span>
        <span className="truncate">Google Sheets</span>
        <span className="ml-auto shrink-0 text-success text-caption">✓</span>
      </button>
    </div>
  );
}
