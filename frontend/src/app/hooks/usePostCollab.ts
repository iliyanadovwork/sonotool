'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';

// ── Realtime collaboration on a single post ──────────────────────────────────
// One Supabase Realtime channel per post (`post:{postId}`) carries everything:
//  • Presence  — who is in the post + which slide they're on (Phase 2)
//  • Broadcast 'cursor' — live peer cursors (Phase 3)
//  • Broadcast 'lock'   — who is editing which element (Phase 4)
// All ephemeral; no DB writes. Identity is the Sonotool user id + a derived colour.

export interface CollabMe {
  id: string;
  name: string;   // display name (email, usually)
  color: string;  // hex, derived from id
}

export interface Peer {
  id: string;
  name: string;
  color: string;
  slideId: string | null;
}

export interface PeerCursor {
  id: string;
  name: string;
  color: string;
  slideId: string | null;
  x: number;   // design-space coords (0..CAROUSEL_W / 0..CAROUSEL_H)
  y: number;
  t: number;   // last-update timestamp (ms) for staleness pruning
}

// Element currently held by a peer: `${kind}:${id}` → peer.
export interface PeerLock { key: string; peer: Peer }

// Stable, pleasant colour from a user id (HSL → hex, fixed S/L, hue from a hash).
export function colorForUser(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  // HSL(h, 70%, 55%) → hex
  const s = 0.7, l = 0.55;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const to = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

/**
 * Subscribe to a post's collab channel. Returns live peers (presence), peer cursors, and peer
 * locks, plus senders for this client's cursor + lock. No-ops (empty) when postId/me is null.
 */
export function usePostCollab(
  postId: string | null,
  me: CollabMe | null,
  activeSlideId: string | null,
) {
  const [peers, setPeers] = useState<Peer[]>([]);
  const [cursors, setCursors] = useState<Record<string, PeerCursor>>({});
  const [locks, setLocks] = useState<Record<string, Peer>>({});
  const channelRef = useRef<RealtimeChannel | null>(null);
  // Latest slide/identity for the channel callbacks + senders. Synced in effects (not during
  // render) so the senders always read fresh values without re-subscribing.
  const slideRef = useRef<string | null>(activeSlideId);
  const meRef = useRef<CollabMe | null>(me);
  useEffect(() => { meRef.current = me; }, [me]);

  // (Re)build the channel when the post or identity changes. No reset here (initial state is empty
  // and the cleanup below resets on teardown) — avoids a synchronous setState in the effect body.
  useEffect(() => {
    if (!postId || !me) return;
    const meId = me.id;
    const ch = supabase.channel(`post:${postId}`, { config: { presence: { key: meId } } });
    channelRef.current = ch;

    ch.on('presence', { event: 'sync' }, () => {
      const state = ch.presenceState<{ id: string; name: string; color: string; slideId: string | null }>();
      const list: Peer[] = [];
      const present = new Set<string>();
      for (const key of Object.keys(state)) {
        if (key === meId) continue;                 // exclude self
        const meta = state[key]?.[0];
        if (meta) { list.push({ id: meta.id, name: meta.name, color: meta.color, slideId: meta.slideId ?? null }); present.add(meta.id); }
      }
      setPeers(list);
      // Drop cursors + locks belonging to peers who have left.
      setCursors(prev => {
        const next: Record<string, PeerCursor> = {}; let changed = false;
        for (const [k, v] of Object.entries(prev)) { if (present.has(v.id)) next[k] = v; else changed = true; }
        return changed ? next : prev;
      });
      setLocks(prev => {
        const next: Record<string, Peer> = {}; let changed = false;
        for (const [k, v] of Object.entries(prev)) { if (present.has(v.id)) next[k] = v; else changed = true; }
        return changed ? next : prev;
      });
    });

    ch.on('broadcast', { event: 'cursor' }, ({ payload }) => {
      const p = payload as PeerCursor;
      if (!p || p.id === meId) return;
      setCursors(prev => ({ ...prev, [p.id]: p }));
    });

    // Peer's mouse left the canvas → drop their cursor immediately.
    ch.on('broadcast', { event: 'cursor-leave' }, ({ payload }) => {
      const pid = (payload as { id?: string })?.id;
      if (!pid || pid === meId) return;
      setCursors(prev => {
        if (!prev[pid]) return prev;
        const next = { ...prev }; delete next[pid]; return next;
      });
    });

    // A peer's lock set (full snapshot of the element keys they hold).
    ch.on('broadcast', { event: 'lock' }, ({ payload }) => {
      const p = payload as { peer: Peer; keys: string[] };
      if (!p?.peer || p.peer.id === meId) return;
      setLocks(prev => {
        const next: Record<string, Peer> = {};
        // keep other peers' locks
        for (const [k, v] of Object.entries(prev)) if (v.id !== p.peer.id) next[k] = v;
        // apply this peer's current set
        for (const k of p.keys) next[k] = p.peer;
        return next;
      });
    });

    ch.subscribe(status => {
      if (status === 'SUBSCRIBED') {
        void ch.track({ id: meId, name: me.name, color: me.color, slideId: slideRef.current });
      }
    });

    return () => {
      setPeers([]); setCursors({}); setLocks({});
      void supabase.removeChannel(ch);
      channelRef.current = null;
    };
  }, [postId, me?.id, me?.name, me?.color]); // eslint-disable-line react-hooks/exhaustive-deps

  // Update presence when this client switches slides (so the avatar follows the slide).
  useEffect(() => {
    slideRef.current = activeSlideId;
    const ch = channelRef.current;
    const m = meRef.current;
    if (!ch || !m) return;
    void ch.track({ id: m.id, name: m.name, color: m.color, slideId: activeSlideId });
  }, [activeSlideId]);

  // No idle timer: a peer's cursor shows while they're moving on this slide, and is removed when
  // their mouse LEAVES the canvas (cursor-leave below) or they disconnect (presence-sync prune).

  const sendCursor = useCallback((x: number, y: number) => {
    const ch = channelRef.current;
    const m = meRef.current;
    if (!ch || !m) return;
    void ch.send({
      type: 'broadcast', event: 'cursor',
      payload: { id: m.id, name: m.name, color: m.color, slideId: slideRef.current, x, y, t: performance.now() } as PeerCursor,
    });
  }, []);

  // Tell peers to drop our cursor (mouse left the canvas).
  const sendCursorLeave = useCallback(() => {
    const ch = channelRef.current;
    const m = meRef.current;
    if (!ch || !m) return;
    void ch.send({ type: 'broadcast', event: 'cursor-leave', payload: { id: m.id } });
  }, []);

  // Broadcast this client's full lock set (the element keys it currently holds).
  const sendLocks = useCallback((keys: string[]) => {
    const ch = channelRef.current;
    const m = meRef.current;
    if (!ch || !m) return;
    void ch.send({
      type: 'broadcast', event: 'lock',
      payload: { peer: { id: m.id, name: m.name, color: m.color, slideId: slideRef.current }, keys },
    });
  }, []);

  return { peers, cursors, locks, sendCursor, sendCursorLeave, sendLocks };
}
