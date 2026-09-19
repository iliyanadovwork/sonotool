'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import type { CarouselSettings } from '../components/templateEditorTypes';
import { stripUnfilledPlaceholders } from '../components/templateEditorTypes';
import {
  rowToSettings, slideToRow, rowToSlide, cloneSettings,
  TEMPLATE_TABLES, POST_TABLES,
} from '@/lib/template-editor/slide-serde';
import type { SlideRow, TableConfig } from '@/lib/template-editor/slide-serde';

// Re-export the serde shapes so existing consumers keep importing them from this hook.
export type { SlideRow, TableConfig } from '@/lib/template-editor/slide-serde';
export { TEMPLATE_TABLES, POST_TABLES } from '@/lib/template-editor/slide-serde';

// ── Public types ─────────────────────────────────────────────────────────────

export interface TemplateRow {
  id: string;
  name: string;
  position: number;
  userId?: string;   // owner id; for posts this distinguishes shared-with-me (userId !== me) from mine
}

// A soft-deleted template/post, surfaced in the "Recently deleted" restore list.
export interface DeletedTemplateRow {
  id: string;
  name: string;
  deletedAt: string;
}

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

// (SlideRow, TableConfig, TEMPLATE_TABLES, POST_TABLES now live in
// @/lib/template-editor/slide-serde and are imported + re-exported above.)

// ── Tuning ───────────────────────────────────────────────────────────────────

const AUTOSAVE_DEBOUNCE_MS = 500;
const SAVED_FLASH_MS = 1500;
const HISTORY_DEBOUNCE_MS = 400;   // rapid edits within this window coalesce into one undo step
const HISTORY_LIMIT = 100;

// Undo/redo snapshot of a slide's editable state
type HistorySnap = { headline: string; subheadline: string; caption: string; settings: CarouselSettings };
function snapOfSlide(slide: SlideRow | undefined): HistorySnap | null {
  return slide
    ? { headline: slide.headline, subheadline: slide.subheadline, caption: slide.caption, settings: cloneSettings(slide.settings) }
    : null;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useTemplateEditor(userId: string | null, tables: TableConfig = TEMPLATE_TABLES) {
  // Stable primitive copies so callback/effect deps compare by value, not object identity.
  const { parent: PARENT_TABLE, slides: SLIDES_TABLE, slideFk: SLIDE_FK } = tables;

  // localStorage keys for "land back where you were" — namespaced per table-set
  // so the templates editor and the posts editor don't collide.
  const LAST_DESIGN_KEY = `sonotool:lastDesign:${PARENT_TABLE}`;
  const LAST_SLIDE_KEY  = `sonotool:lastSlide:${PARENT_TABLE}`;

  const [templates, setTemplates]               = useState<TemplateRow[]>([]);
  const [activeTemplateId, setActiveTemplateId] = useState<string | null>(null);
  const [slides, setSlides]                     = useState<SlideRow[]>([]);
  const [activeSlideId, setActiveSlideId]       = useState<string | null>(null);
  const [loading, setLoading]                   = useState(true);
  const [saveState, setSaveState]               = useState<SaveState>('idle');
  const [error, setError]                       = useState<string | null>(null);
  const [deletedTemplates, setDeletedTemplates] = useState<DeletedTemplateRow[]>([]);

  // Per-slide debounce timers
  const saveTimersRef  = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const savedFlashRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const slidesRef      = useRef<SlideRow[]>([]);
  slidesRef.current    = slides;

  // ── Optimistic-concurrency (shared posts only) ──────────────────────────────
  // Posts can be edited by multiple collaborators. Each save is gated on the slide's last-known
  // updated_at; if a teammate wrote a newer version, the save no-ops (0 rows) and we reload theirs
  // + notify, instead of silently clobbering. Saves are chained per slide so the token stays fresh.
  // Both posts and templates are team-shared + editable by everyone, so both get the guard.
  const CONCURRENCY = SLIDES_TABLE === POST_TABLES.slides || SLIDES_TABLE === TEMPLATE_TABLES.slides;
  const knownUpdatedAtRef = useRef<Map<string, string>>(new Map());
  const inFlightRef       = useRef<Map<string, Promise<void>>>(new Map());
  const [conflictNotice, setConflictNotice] = useState<string | null>(null);
  const conflictTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Parent ids WE soft-deleted — so the realtime echo of our own delete doesn't
  // flash a bogus "deleted elsewhere" notice before the channel tears down.
  const selfDeletedRef    = useRef<Set<string>>(new Set());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rememberUpdatedAt = (raw: any) => {
    if (CONCURRENCY && raw?.id && raw?.updated_at) knownUpdatedAtRef.current.set(raw.id, raw.updated_at);
  };
  const flashConflict = (msg: string) => {
    setConflictNotice(msg);
    if (conflictTimerRef.current) clearTimeout(conflictTimerRef.current);
    conflictTimerRef.current = setTimeout(() => setConflictNotice(null), 6000);
  };

  // ── Undo / redo state (per slide; rapid edits coalesce into one step) ───────
  const historyRef       = useRef<Map<string, { past: HistorySnap[]; future: HistorySnap[] }>>(new Map());
  const pendingBaseRef   = useRef<Map<string, HistorySnap>>(new Map());
  const histTimerRef     = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const activeSlideIdRef = useRef<string | null>(activeSlideId);
  activeSlideIdRef.current = activeSlideId;
  const [histTick, setHistTick] = useState(0);

  // Load a parent's slides (a template's or a post's) and reset undo history.
  // A plain function (recreated per render) that captures the stable table config — wrapping it in
  // useCallback makes the React-compiler lint surface ref-during-render violations elsewhere, so we keep
  // it plain and accept the (harmless) exhaustive-deps notes on its callers.
  async function loadSlidesFor(templateId: string) {
    historyRef.current.clear();
    pendingBaseRef.current.clear();
    histTimerRef.current.forEach(t => clearTimeout(t));
    histTimerRef.current.clear();
    setHistTick(t => t + 1);
    const { data, error: err } = await supabase
      .from(SLIDES_TABLE)
      .select('*')
      .eq(SLIDE_FK, templateId)
      .order('position');
    if (err) { setError(err.message); return; }
    knownUpdatedAtRef.current.clear();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = (data ?? []) as Record<string, any>[];
    raw.forEach(rememberUpdatedAt);
    const list = raw.map(rowToSlide);
    setSlides(list);
    // Prefer the last-active slide (persisted per table-set) when it still exists
    // in this design; otherwise fall back to the first slide. A stale id from a
    // different design simply won't match, so cross-design restores are inert.
    let initialSlideId = list[0]?.id ?? null;
    try {
      const stored = typeof window !== 'undefined' ? window.localStorage.getItem(LAST_SLIDE_KEY) : null;
      if (stored && list.some(s => s.id === stored)) initialSlideId = stored;
    } catch { /* storage unavailable — fall back to first slide */ }
    setActiveSlideId(initialSlideId);
  }

  // ── Load on userId change ─────────────────────────────────────────────────
  useEffect(() => {
    if (!userId) {
      setTemplates([]);
      setSlides([]);
      setActiveTemplateId(null);
      setActiveSlideId(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    async function load(uid: string) {
      setLoading(true);
      // No user_id filter: RLS scopes the result. Everything is team-shared (posts AND templates),
      // so this returns the whole team's items; the ones you created sort first, then by position.
      const { data, error: err } = await supabase
        .from(PARENT_TABLE)
        .select('id, name, position, user_id')
        .is('deleted_at', null)   // hide soft-deleted rows (restorable via Recently deleted)
        .order('position');
      if (cancelled) return;
      if (err) { setError(err.message); setLoading(false); return; }

      const list = ((data ?? []) as Array<{ id: string; name: string; position: number; user_id: string }>)
        .map(r => ({ id: r.id, name: r.name, position: r.position, userId: r.user_id }))
        .sort((a, b) => (a.userId === uid ? 0 : 1) - (b.userId === uid ? 0 : 1) || a.position - b.position);
      setTemplates(list);
      if (list.length > 0) {
        // Prefer the last-open design (persisted) if it's still in the list;
        // otherwise fall back to the first (existing behavior).
        let initialId = list[0].id;
        try {
          const stored = typeof window !== 'undefined' ? window.localStorage.getItem(LAST_DESIGN_KEY) : null;
          if (stored && list.some(t => t.id === stored)) initialId = stored;
        } catch { /* storage unavailable — fall back to first */ }
        await loadSlidesFor(initialId);
        if (cancelled) return;
        setActiveTemplateId(initialId);
      } else {
        setSlides([]);
        setActiveSlideId(null);
      }
      setLoading(false);
    }
    void load(userId);
    return () => { cancelled = true; };
    // loadSlidesFor is a stable-by-value plain fn; intentionally not a dep (would re-run every render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, PARENT_TABLE]);

  // ── Persist last-open design + slide (restored by the load path above) ────
  useEffect(() => {
    if (!activeTemplateId || typeof window === 'undefined') return;
    try { window.localStorage.setItem(LAST_DESIGN_KEY, activeTemplateId); } catch { /* ignore */ }
  }, [activeTemplateId, LAST_DESIGN_KEY]);
  useEffect(() => {
    if (!activeSlideId || typeof window === 'undefined') return;
    try { window.localStorage.setItem(LAST_SLIDE_KEY, activeSlideId); } catch { /* ignore */ }
  }, [activeSlideId, LAST_SLIDE_KEY]);

  // ── Debounced autosave ────────────────────────────────────────────────────
  const scheduleSave = useCallback((slideId: string) => {
    const existing = saveTimersRef.current.get(slideId);
    if (existing) clearTimeout(existing);

    setSaveState('saving');
    if (savedFlashRef.current) {
      clearTimeout(savedFlashRef.current);
      savedFlashRef.current = null;
    }

    const timer = setTimeout(() => {
      saveTimersRef.current.delete(slideId);
      // Chain after any in-flight save for this slide so the updated_at token stays fresh
      // (prevents a self-inflicted false conflict from two overlapping saves).
      const prev = inFlightRef.current.get(slideId);
      const run = (async () => {
        if (prev) await prev.catch(() => {});
        const slide = slidesRef.current.find(s => s.id === slideId);
        if (!slide) return;
        const row = slideToRow(slide);

        if (CONCURRENCY) {
          const known = knownUpdatedAtRef.current.get(slideId);
          if (!known) {
            // Never write unguarded — a missing token means this snapshot's lineage is
            // unprovable, and a full-row write could clobber newer CLI/teammate work
            // (observed in prod: images wiped by a stale-tab save). Adopt the server's
            // version instead of writing.
            const { data: fresh0 } = await supabase.from(SLIDES_TABLE).select('*').eq('id', slideId).maybeSingle();
            if (fresh0) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const freshRow0 = fresh0 as Record<string, any>;
              rememberUpdatedAt(freshRow0);
              const reloaded0 = rowToSlide(freshRow0);
              setSlides(cur => cur.map(s => (s.id === slideId ? reloaded0 : s)));
              historyRef.current.delete(slideId);
              pendingBaseRef.current.delete(slideId);
              flashConflict('This slide was refreshed from the server — re-apply your last change if needed.');
            }
            return;
          }
          let q = supabase.from(SLIDES_TABLE).update(row).eq('id', slideId);
          if (known) q = q.eq('updated_at', known);
          const { data, error: err } = await q.select('updated_at').maybeSingle();
          if (err) { setSaveState('error'); setError(err.message); return; }
          if (!data) {
            // 0 rows matched: the row was deleted, or a teammate saved a newer version.
            const { data: fresh } = await supabase.from(SLIDES_TABLE).select('*').eq('id', slideId).maybeSingle();
            if (fresh) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const freshRow = fresh as Record<string, any>;
              rememberUpdatedAt(freshRow);
              const reloaded = rowToSlide(freshRow);
              setSlides(cur => cur.map(s => (s.id === slideId ? reloaded : s)));
              historyRef.current.delete(slideId);     // its baseline changed under us
              pendingBaseRef.current.delete(slideId);
              flashConflict('A teammate edited this slide — reloaded their version. Re-apply your change if needed.');
            }
            return;   // (fresh === null → deleted elsewhere; keep local view)
          }
          rememberUpdatedAt({ id: slideId, updated_at: (data as { updated_at: string }).updated_at });
        } else {
          const { error: err } = await supabase.from(SLIDES_TABLE).update(row).eq('id', slideId);
          if (err) { setSaveState('error'); setError(err.message); return; }
        }

        // Only flash 'saved' if no other saves are still pending
        if (saveTimersRef.current.size === 0) {
          setSaveState('saved');
          savedFlashRef.current = setTimeout(() => {
            setSaveState(prev2 => (prev2 === 'saved' ? 'idle' : prev2));
            savedFlashRef.current = null;
          }, SAVED_FLASH_MS);
        }
      })();
      inFlightRef.current.set(slideId, run);
      void run.finally(() => { if (inFlightRef.current.get(slideId) === run) inFlightRef.current.delete(slideId); });
    }, AUTOSAVE_DEBOUNCE_MS);

    saveTimersRef.current.set(slideId, timer);
  }, [SLIDES_TABLE]);  // eslint-disable-line react-hooks/exhaustive-deps

  // ── History (undo/redo) helpers ─────────────────────────────────────────────
  const recordHistory = useCallback((id: string, beforeSlide: SlideRow) => {
    // First edit of a burst captures the pre-edit state as the undo point
    if (!pendingBaseRef.current.has(id)) {
      const snap = snapOfSlide(beforeSlide);
      if (snap) { pendingBaseRef.current.set(id, snap); setHistTick(t => t + 1); }
    }
    const existing = histTimerRef.current.get(id);
    if (existing) clearTimeout(existing);
    histTimerRef.current.set(id, setTimeout(() => {
      histTimerRef.current.delete(id);
      const base = pendingBaseRef.current.get(id);
      pendingBaseRef.current.delete(id);
      if (!base) return;
      const h = historyRef.current.get(id) ?? { past: [], future: [] };
      h.past.push(base);
      if (h.past.length > HISTORY_LIMIT) h.past.shift();
      h.future = [];
      historyRef.current.set(id, h);
      setHistTick(t => t + 1);
    }, HISTORY_DEBOUNCE_MS));
  }, []);

  // Commit any in-progress burst immediately (so undo right after an edit works)
  const flushPending = useCallback((id: string) => {
    const timer = histTimerRef.current.get(id);
    if (timer) { clearTimeout(timer); histTimerRef.current.delete(id); }
    const base = pendingBaseRef.current.get(id);
    if (!base) return;
    pendingBaseRef.current.delete(id);
    const h = historyRef.current.get(id) ?? { past: [], future: [] };
    h.past.push(base);
    if (h.past.length > HISTORY_LIMIT) h.past.shift();
    h.future = [];
    historyRef.current.set(id, h);
  }, []);

  // Restore a snapshot without recording it as a new edit
  const applySnap = useCallback((id: string, snap: HistorySnap) => {
    setSlides(prev => prev.map(sl => sl.id === id
      ? { ...sl, headline: snap.headline, subheadline: snap.subheadline, caption: snap.caption, settings: cloneSettings(snap.settings) }
      : sl));
    scheduleSave(id);
  }, [scheduleSave]);

  const undo = useCallback(() => {
    const id = activeSlideIdRef.current;
    if (!id) return;
    flushPending(id);
    const h = historyRef.current.get(id);
    if (!h || h.past.length === 0) return;
    const cur = snapOfSlide(slidesRef.current.find(s => s.id === id));
    const prev = h.past.pop();
    if (!cur || !prev) return;
    h.future.push(cur);
    applySnap(id, prev);
    setHistTick(t => t + 1);
  }, [flushPending, applySnap]);

  const redo = useCallback(() => {
    const id = activeSlideIdRef.current;
    if (!id) return;
    flushPending(id);
    const h = historyRef.current.get(id);
    if (!h || h.future.length === 0) return;
    const cur = snapOfSlide(slidesRef.current.find(s => s.id === id));
    const next = h.future.pop();
    if (!cur || !next) return;
    h.past.push(cur);
    applySnap(id, next);
    setHistTick(t => t + 1);
  }, [flushPending, applySnap]);

  // Cancel pending timers on unmount
  useEffect(() => {
    const timers = saveTimersRef.current;
    const histTimers = histTimerRef.current;
    return () => {
      timers.forEach(t => clearTimeout(t));
      timers.clear();
      histTimers.forEach(t => clearTimeout(t));
      histTimers.clear();
      if (savedFlashRef.current) clearTimeout(savedFlashRef.current);
      if (conflictTimerRef.current) clearTimeout(conflictTimerRef.current);
    };
  }, []);

  // ── Live content sync (Supabase Realtime) ─────────────────────────────────
  // One channel per ACTIVE design, rebuilt when activeTemplateId changes and torn
  // down on unmount/design switch. Adopts remote slide writes (CLI, teammates)
  // into local state so no refresh is needed — but NEVER clobbers a slide that
  // has unsaved local edits. Applies to both table-sets (templates AND posts).
  useEffect(() => {
    if (!activeTemplateId) return;
    let disposed = false;

    // A slide is DIRTY when any local machinery still owns it: a pending debounced
    // save, an in-flight save, or an uncommitted undo burst. Adoption is only safe
    // when the slide is clean.
    const isDirty = (id: string) =>
      saveTimersRef.current.has(id) ||
      inFlightRef.current.has(id) ||
      pendingBaseRef.current.has(id) ||
      histTimerRef.current.has(id);

    // Realtime payloads for these tables can be truncated (large JSONB columns).
    // If the row doesn't look complete, refetch it by id before adopting.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const looksComplete = (row: Record<string, any>) =>
      typeof row.name === 'string' && typeof row.position === 'number' &&
      'text_boxes' in row && 'image_boxes' in row && 'layer_order_ids' in row;

    // Clear one slide's undo machinery — a remote adoption invalidates its local
    // snapshots (mirrors what a design switch does, but per slide).
    const resetSlideHistory = (id: string) => {
      historyRef.current.delete(id);
      pendingBaseRef.current.delete(id);
      const ht = histTimerRef.current.get(id);
      if (ht) { clearTimeout(ht); histTimerRef.current.delete(id); }
      setHistTick(t => t + 1);
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const adoptRow = (row: Record<string, any>) => {
      rememberUpdatedAt(row);
      const adopted = rowToSlide(row);
      // Content-identical echo (e.g. our own reorder racing its REST response):
      // record the fresh token but keep local state + undo history untouched.
      const local = slidesRef.current.find(s => s.id === adopted.id);
      if (local && JSON.stringify(local) === JSON.stringify(adopted)) return;
      // Position-only change (a remote reorder): move it, but DON'T wipe this
      // slide's undo history — nothing about its content changed.
      const positionOnly = !!local &&
        JSON.stringify({ ...local, position: 0 }) === JSON.stringify({ ...adopted, position: 0 });
      setSlides(prev => {
        const next = prev.some(s => s.id === adopted.id)
          ? prev.map(s => (s.id === adopted.id ? adopted : s))
          : [...prev, adopted];
        return next.sort((a, b) => a.position - b.position);
      });
      if (!positionOnly) resetSlideHistory(adopted.id);
    };

    // Remote-vs-known ordering: true when the event is our own echo or STALE (older
    // than what we already hold) — equality alone let an out-of-order event regress
    // the token and clobber newer state.
    const isEchoOrStale = (id: string, remoteUpdatedAt: string | undefined): boolean => {
      if (!remoteUpdatedAt) return false;
      const known = knownUpdatedAtRef.current.get(id);
      if (!known) return false;
      if (known === remoteUpdatedAt) return true;
      const kt = Date.parse(known), rt = Date.parse(remoteUpdatedAt);
      return Number.isFinite(kt) && Number.isFinite(rt) && rt <= kt;
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const onSlideUpsert = async (eventType: 'INSERT' | 'UPDATE', newRow: Record<string, any>) => {
      const id = newRow?.id as string | undefined;
      if (!id) return;
      const remoteUpdatedAt = newRow?.updated_at as string | undefined;

      // Own-write suppression: this event is our own echo, or STALE — at or behind
      // the token our save response already recorded.
      if (isEchoOrStale(id, remoteUpdatedAt)) return;

      // If our own save for this slide is in flight, its echo may have raced ahead
      // of the REST response. Wait for the save to settle (the response refreshes
      // the token; its 0-row conflict path already reloads + notifies), re-check.
      const inflight = inFlightRef.current.get(id);
      if (inflight) {
        await inflight.catch(() => {});
        if (disposed) return;
        if (isEchoOrStale(id, remoteUpdatedAt)) return;
      }

      // UPDATE for a slide we no longer hold (deleted locally, or a stray event) → ignore.
      if (eventType === 'UPDATE' && !slidesRef.current.some(s => s.id === id)) return;

      if (isDirty(id)) {
        // Never clobber unsaved local edits. The save path's optimistic-concurrency
        // guard reconciles on the next save attempt (0 rows → reload theirs + notify).
        flashConflict('This slide was updated elsewhere — kept your unsaved edits; saving will reconcile with the latest.');
        return;
      }

      let row = newRow;
      if (!looksComplete(row)) {
        const { data } = await supabase.from(SLIDES_TABLE).select('*').eq('id', id).maybeSingle();
        if (disposed || !data) return;
        if (isDirty(id)) return;   // an edit started while we were fetching
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        row = data as Record<string, any>;
      }
      adoptRow(row);
    };

    // DELETE events bypass the postgres_changes filter (payload.old carries only
    // the replica identity, i.e. the id) — so membership in our local list is the
    // real guard against other designs' deletions.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const onSlideDelete = (oldRow: Record<string, any>) => {
      const id = oldRow?.id as string | undefined;
      if (!id || !slidesRef.current.some(s => s.id === id)) return;
      if (isDirty(id)) {
        // Never destroy unsaved local edits: keep the slide on screen and let the
        // save path's 0-row branch ("deleted elsewhere") reconcile on the next save.
        flashConflict('This slide was deleted elsewhere — your unsaved edits are kept on screen.');
        return;
      }
      const st = saveTimersRef.current.get(id);
      if (st) { clearTimeout(st); saveTimersRef.current.delete(id); }
      inFlightRef.current.delete(id);
      knownUpdatedAtRef.current.delete(id);
      resetSlideHistory(id);
      const remaining = slidesRef.current.filter(s => s.id !== id);
      setSlides(prev => prev.filter(s => s.id !== id));
      if (activeSlideIdRef.current === id) setActiveSlideId(remaining[0]?.id ?? null);
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const onParentUpdate = (newRow: Record<string, any>) => {
      const id = newRow?.id as string | undefined;
      if (!id || id !== activeTemplateId) return;
      if (newRow.deleted_at) {
        // Soft-deleted elsewhere (the app's delete IS a soft delete) — unless WE did it.
        if (selfDeletedRef.current.has(id)) return;
        flashConflict('This design was deleted elsewhere — restore it from Recently deleted, or pick another design.');
        return;
      }
      if (typeof newRow.name === 'string') {
        setTemplates(prev => prev.map(t => (t.id === id ? { ...t, name: newRow.name } : t)));
      }
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const onParentDelete = (oldRow: Record<string, any>) => {
      const id = oldRow?.id as string | undefined;
      if (!id) return;
      if (id === activeTemplateId) {
        if (!selfDeletedRef.current.has(id)) {
          flashConflict('This design was deleted elsewhere — pick another design.');
        }
        return;   // keep current editor state on screen; don't yank it away
      }
      // A non-active design hard-deleted elsewhere: quietly drop it from the list.
      setTemplates(prev => prev.filter(t => t.id !== id));
    };

    const channel = supabase
      .channel(`editor-live:${PARENT_TABLE}:${activeTemplateId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: SLIDES_TABLE, filter: `${SLIDE_FK}=eq.${activeTemplateId}` },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (payload: any) => {
          if (disposed) return;
          if (payload.eventType === 'DELETE') onSlideDelete(payload.old);
          else void onSlideUpsert(payload.eventType, payload.new);
        })
      .on('postgres_changes',
        { event: '*', schema: 'public', table: PARENT_TABLE, filter: `id=eq.${activeTemplateId}` },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (payload: any) => {
          if (disposed) return;
          if (payload.eventType === 'DELETE') onParentDelete(payload.old);
          else if (payload.eventType === 'UPDATE') onParentUpdate(payload.new);
        })
      .subscribe();

    return () => {
      disposed = true;
      void supabase.removeChannel(channel);
    };
    // flashConflict/rememberUpdatedAt only touch refs + setState — safe to omit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTemplateId, PARENT_TABLE, SLIDES_TABLE, SLIDE_FK]);

  // ── Template ops ──────────────────────────────────────────────────────────
  const createTemplate = useCallback(async (name?: string): Promise<string | null> => {
    if (!userId) return null;
    const position = templates.length;
    const finalName = name ?? `Template ${position + 1}`;
    const { data, error: err } = await supabase
      .from(PARENT_TABLE)
      .insert({ user_id: userId, name: finalName, position })
      .select('id, name, position')
      .single();
    if (err || !data) { setError(err?.message ?? 'Failed to create template'); return null; }

    const t: TemplateRow = { ...(data as TemplateRow), userId: userId ?? undefined };
    setTemplates(prev => [...prev, t]);
    setActiveTemplateId(t.id);

    // Auto-create the initial 'main' slide (no circle layers — clean start)
    const { data: slideData, error: slideErr } = await supabase
      .from(SLIDES_TABLE)
      .insert({ [SLIDE_FK]: t.id, name: 'main', position: 0, layer_order: ['background', 'subject'] })
      .select('*')
      .single();
    if (slideErr || !slideData) {
      setError(slideErr?.message ?? 'Failed to create initial slide');
      return t.id;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const newSlide = rowToSlide(slideData as Record<string, any>);
    setSlides([newSlide]);
    setActiveSlideId(newSlide.id);
    return t.id;
  }, [userId, templates.length, PARENT_TABLE, SLIDES_TABLE, SLIDE_FK]);

  // Create a POST by deep-cloning a template's slides (snapshot). Reads the source slides from the
  // template tables and writes the clones into THIS hook's parent (post) tables, recording provenance in
  // source_template_id. Only meaningful when the hook is configured for posts (POST_TABLES). RLS on the
  // source template tables already restricts the read to templates the user owns.
  const createFromTemplate = useCallback(async (sourceTemplateId: string, name?: string): Promise<string | null> => {
    if (!userId) return null;
    const source = TEMPLATE_TABLES;
    // 1. Fetch the source template's slides in order.
    const { data: srcRows, error: srcErr } = await supabase
      .from(source.slides)
      .select('*')
      .eq(source.slideFk, sourceTemplateId)
      .order('position');
    if (srcErr) { setError(srcErr.message); return null; }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const srcSlides = ((srcRows ?? []) as Record<string, any>[]).map(rowToSlide);
    // A real template always has ≥1 slide; 0 rows means a missing/not-owned id (RLS blocks the read) —
    // fail fast instead of creating an empty post.
    if (srcSlides.length === 0) { setError('That template could not be found, or has no slides to copy.'); return null; }

    // 2. Create the post (parent), recording which template it came from.
    const position = templates.length;
    const finalName = name ?? `Post ${position + 1}`;
    const { data: parent, error: pErr } = await supabase
      .from(PARENT_TABLE)
      .insert({ user_id: userId, name: finalName, position, source_template_id: sourceTemplateId })
      .select('id, name, position')
      .single();
    if (pErr || !parent) { setError(pErr?.message ?? 'Failed to create post'); return null; }
    const p: TemplateRow = { ...(parent as TemplateRow), userId: userId ?? undefined };

    // 3. Deep-clone the slides into the post (fresh ids; preserve order). slideToRow omits id/FK/timestamps
    //    and drops image-type divider sub-slots (ephemeral blob URLs) — matching template save behaviour.
    //    Unfilled image placeholders are template-only design visuals — they don't transfer to posts.
    const rows = srcSlides.map((sl, i) => ({
      ...slideToRow({ ...sl, position: i, settings: stripUnfilledPlaceholders(sl.settings) }),
      [SLIDE_FK]: p.id,
    }));
    const { data: insRows, error: sErr } = await supabase.from(SLIDES_TABLE).insert(rows).select('*');
    if (sErr || (insRows?.length ?? 0) === 0) {
      // No client-side transactions — roll back the just-created post so we don't leave a slide-less orphan.
      await supabase.from(PARENT_TABLE).delete().eq('id', p.id);
      setError(sErr?.message ?? 'Failed to copy the template slides into the post.');
      return null;
    }
    knownUpdatedAtRef.current.clear();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const insRaw = (insRows ?? []) as Record<string, any>[];
    insRaw.forEach(rememberUpdatedAt);
    const newSlides = insRaw.map(rowToSlide).sort((a, b) => a.position - b.position);

    // 4. Reset undo history and switch the editor to the new post.
    historyRef.current.clear();
    pendingBaseRef.current.clear();
    histTimerRef.current.forEach(t => clearTimeout(t));
    histTimerRef.current.clear();
    setHistTick(t => t + 1);
    setTemplates(prev => [...prev, p]);
    setActiveTemplateId(p.id);
    setSlides(newSlides);
    setActiveSlideId(newSlides[0]?.id ?? null);
    return p.id;
  }, [userId, templates.length, PARENT_TABLE, SLIDES_TABLE, SLIDE_FK]);

  // Duplicate a template/post in place: new parent + a deep clone of every slide (fresh ids,
  // preserved order), named "<source> copy". Same-tables clone — mirrors createFromTemplate but
  // stays within THIS hook's tables instead of crossing template→post. Switches to the copy.
  const duplicateTemplate = useCallback(async (sourceId: string, name?: string): Promise<string | null> => {
    if (!userId) return null;
    // 1. Fetch the source's slides in order (RLS restricts this to rows the user can read).
    const { data: srcRows, error: srcErr } = await supabase
      .from(SLIDES_TABLE)
      .select('*')
      .eq(SLIDE_FK, sourceId)
      .order('position');
    if (srcErr) { setError(srcErr.message); return null; }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const srcSlides = ((srcRows ?? []) as Record<string, any>[]).map(rowToSlide);
    if (srcSlides.length === 0) { setError('That template could not be found, or has no slides to copy.'); return null; }

    // 2. Create the new parent, appending "copy" to the source name.
    const srcName = templates.find(t => t.id === sourceId)?.name ?? 'Untitled';
    const position = templates.length;
    const finalName = name ?? `${srcName} copy`;
    const { data: parent, error: pErr } = await supabase
      .from(PARENT_TABLE)
      .insert({ user_id: userId, name: finalName, position })
      .select('id, name, position')
      .single();
    if (pErr || !parent) { setError(pErr?.message ?? 'Failed to duplicate'); return null; }
    const p: TemplateRow = { ...(parent as TemplateRow), userId: userId ?? undefined };

    // 3. Deep-clone the slides (slideToRow omits id/FK/timestamps + drops ephemeral blob sub-slots).
    const rows = srcSlides.map((sl, i) => ({ ...slideToRow({ ...sl, position: i }), [SLIDE_FK]: p.id }));
    const { data: insRows, error: sErr } = await supabase.from(SLIDES_TABLE).insert(rows).select('*');
    if (sErr || (insRows?.length ?? 0) === 0) {
      // No client-side transactions — roll back the just-created parent so we don't orphan it.
      await supabase.from(PARENT_TABLE).delete().eq('id', p.id);
      setError(sErr?.message ?? 'Failed to copy the slides into the duplicate.');
      return null;
    }
    knownUpdatedAtRef.current.clear();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const insRaw = (insRows ?? []) as Record<string, any>[];
    insRaw.forEach(rememberUpdatedAt);
    const newSlides = insRaw.map(rowToSlide).sort((a, b) => a.position - b.position);

    // 4. Reset undo history and switch the editor to the duplicate.
    historyRef.current.clear();
    pendingBaseRef.current.clear();
    histTimerRef.current.forEach(t => clearTimeout(t));
    histTimerRef.current.clear();
    setHistTick(t => t + 1);
    setTemplates(prev => [...prev, p]);
    setActiveTemplateId(p.id);
    setSlides(newSlides);
    setActiveSlideId(newSlides[0]?.id ?? null);
    return p.id;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, templates, PARENT_TABLE, SLIDES_TABLE, SLIDE_FK]);

  const selectTemplate = useCallback(async (id: string) => {
    if (id === activeTemplateId) return;
    setActiveTemplateId(id);
    await loadSlidesFor(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTemplateId]);

  const renameTemplate = useCallback(async (id: string, name: string) => {
    setTemplates(prev => prev.map(t => (t.id === id ? { ...t, name } : t)));
    const { error: err } = await supabase
      .from(PARENT_TABLE)
      .update({ name })
      .eq('id', id);
    if (err) setError(err.message);
  }, [PARENT_TABLE]);

  const sortByOwnerThenPosition = useCallback((list: TemplateRow[]) =>
    [...list].sort((a, b) => (a.userId === userId ? 0 : 1) - (b.userId === userId ? 0 : 1) || a.position - b.position),
    [userId]);

  // SOFT delete: stamp deleted_at (restorable) rather than removing the row. The
  // DB write happens FIRST; local state (list removal + active-selection switch)
  // changes only on success, so a failed write leaves the editor exactly as it was.
  // Returns true on success so the caller only shows its "Undo" affordance then.
  const deleteTemplate = useCallback(async (id: string): Promise<boolean> => {
    const victim = templates.find(t => t.id === id);
    const deletedAt = new Date().toISOString();
    // Mark BEFORE the write: the realtime echo can arrive before the response,
    // and must not be mistaken for a teammate's delete.
    selfDeletedRef.current.add(id);
    const { error: err } = await supabase
      .from(PARENT_TABLE)
      .update({ deleted_at: deletedAt })
      .eq('id', id);
    if (err) { selfDeletedRef.current.delete(id); setError(err.message); return false; }

    setTemplates(prev => prev.filter(t => t.id !== id));
    if (activeTemplateId === id) {
      const remaining = templates.filter(t => t.id !== id);
      if (remaining.length > 0) {
        setActiveTemplateId(remaining[0].id);
        await loadSlidesFor(remaining[0].id);
      } else {
        setActiveTemplateId(null);
        setSlides([]);
        setActiveSlideId(null);
      }
    }
    if (victim) setDeletedTemplates(prev => [{ id, name: victim.name, deletedAt }, ...prev.filter(d => d.id !== id)]);
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTemplateId, templates, PARENT_TABLE]);

  // Restore a soft-deleted template/post: clear deleted_at, APPEND it to the end
  // (a FRESH position — never reuse the stale one, which could collide with a live
  // row) and, if the library is currently empty, open it. Its slides were never
  // removed, so the design returns intact.
  const restoreTemplate = useCallback(async (id: string) => {
    const nextPos = templates.length ? Math.max(...templates.map(t => t.position)) + 1 : 0;
    const { data, error: err } = await supabase
      .from(PARENT_TABLE)
      .update({ deleted_at: null, position: nextPos })
      .eq('id', id)
      .select('id, name, position, user_id')
      .maybeSingle();
    if (err) { setError(err.message); return; }
    if (!data) return;
    const row = data as { id: string; name: string; position: number; user_id: string };
    const restored: TemplateRow = { id: row.id, name: row.name, position: row.position, userId: row.user_id };
    selfDeletedRef.current.delete(id);   // it's live again — future remote deletes should notify
    setTemplates(prev => prev.some(t => t.id === restored.id) ? prev : sortByOwnerThenPosition([...prev, restored]));
    setDeletedTemplates(prev => prev.filter(d => d.id !== id));
    if (activeTemplateId === null) {   // library was empty → open the restored one
      setActiveTemplateId(restored.id);
      await loadSlidesFor(restored.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templates, activeTemplateId, PARENT_TABLE, sortByOwnerThenPosition]);

  // Load the recently-deleted templates/posts for the Restore list (most recent first).
  const loadDeletedTemplates = useCallback(async () => {
    const { data, error: err } = await supabase
      .from(PARENT_TABLE)
      .select('id, name, deleted_at')
      .not('deleted_at', 'is', null)
      .order('deleted_at', { ascending: false })
      .limit(50);
    if (err) { setError(err.message); return; }
    setDeletedTemplates(((data ?? []) as Array<{ id: string; name: string; deleted_at: string }>)
      .map(r => ({ id: r.id, name: r.name, deletedAt: r.deleted_at })));
  }, [PARENT_TABLE]);

  const reorderTemplates = useCallback(async (orderedIds: string[]) => {
    const positionById = new Map(orderedIds.map((id, i) => [id, i]));
    const reordered = [...templates]
      .sort((a, b) => (positionById.get(a.id) ?? 0) - (positionById.get(b.id) ?? 0))
      .map((t, i) => ({ ...t, position: i }));
    setTemplates(reordered);
    await Promise.all(reordered.map(t =>
      supabase.from(PARENT_TABLE).update({ position: t.position }).eq('id', t.id)
    ));
  }, [templates, PARENT_TABLE]);

  // ── Slide ops ─────────────────────────────────────────────────────────────
  const addSlide = useCallback(async (name?: string): Promise<string | null> => {
    if (!activeTemplateId) return null;
    const position = slides.length;
    const finalName = name ?? (position === 0 ? 'main' : `supporting_${position}`);
    const { data, error: err } = await supabase
      .from(SLIDES_TABLE)
      .insert({
        [SLIDE_FK]: activeTemplateId,
        name: finalName,
        position,
        // Override DB DEFAULT for layer_order: drop the two circle layers on
        // fresh slides so the starting template is clean. The CIRCLE/CIRCLE 2
        // settings still exist if the user wants to re-add them.
        layer_order: ['background', 'subject'],
      })
      .select('*')
      .single();
    if (err || !data) { setError(err?.message ?? 'Failed to add slide'); return null; }
    rememberUpdatedAt(data);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const newSlide = rowToSlide(data as Record<string, any>);
    // Dedupe: the realtime INSERT echo may have adopted this row already.
    setSlides(prev => prev.some(s => s.id === newSlide.id)
      ? prev.map(s => (s.id === newSlide.id ? newSlide : s))
      : [...prev, newSlide]);
    setActiveSlideId(newSlide.id);
    return newSlide.id;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTemplateId, slides.length, SLIDES_TABLE, SLIDE_FK]);

  // Add a slide that's a deep copy of an existing one (used by the "Add slide → from template" picker).
  // slideToRow is the canonical serializer (also used by createFromTemplate), so it captures the full
  // design — settings, image/text boxes, layer order, fade — with a fresh id + next position.
  const duplicateSlide = useCallback(async (sourceSlideId: string): Promise<string | null> => {
    if (!activeTemplateId) return null;
    const src = slides.find(s => s.id === sourceSlideId);
    if (!src) return null;
    const position = slides.length;
    const finalName = position === 0 ? 'main' : `supporting_${position}`;
    const row = { ...slideToRow({ ...src, position, name: finalName }), [SLIDE_FK]: activeTemplateId };
    const { data, error: err } = await supabase.from(SLIDES_TABLE).insert(row).select('*').single();
    if (err || !data) { setError(err?.message ?? 'Failed to add slide'); return null; }
    rememberUpdatedAt(data);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const newSlide = rowToSlide(data as Record<string, any>);
    // Dedupe: the realtime INSERT echo may have adopted this row already.
    setSlides(prev => prev.some(s => s.id === newSlide.id)
      ? prev.map(s => (s.id === newSlide.id ? newSlide : s))
      : [...prev, newSlide]);
    setActiveSlideId(newSlide.id);
    return newSlide.id;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTemplateId, slides, SLIDES_TABLE, SLIDE_FK]);

  const selectSlide = useCallback((id: string) => {
    setActiveSlideId(id);
  }, []);

  const renameSlide = useCallback(async (id: string, name: string) => {
    setSlides(prev => prev.map(s => (s.id === id ? { ...s, name } : s)));
    // Name changes go through the same debounced save; the next slideToRow
    // upsert will include the new name.
    scheduleSave(id);
  }, [scheduleSave]);

  const deleteSlide = useCallback(async (id: string) => {
    historyRef.current.delete(id);
    pendingBaseRef.current.delete(id);
    knownUpdatedAtRef.current.delete(id);
    inFlightRef.current.delete(id);
    const ht = histTimerRef.current.get(id);
    if (ht) { clearTimeout(ht); histTimerRef.current.delete(id); }
    const remaining = slides.filter(s => s.id !== id);
    setSlides(remaining);
    if (activeSlideId === id) setActiveSlideId(remaining[0]?.id ?? null);
    const { error: err } = await supabase
      .from(SLIDES_TABLE)
      .delete()
      .eq('id', id);
    if (err) setError(err.message);
  }, [activeSlideId, slides, SLIDES_TABLE]);

  const reorderSlides = useCallback(async (orderedIds: string[]) => {
    const positionById = new Map(orderedIds.map((id, i) => [id, i]));
    const reordered = [...slides]
      .sort((a, b) => (positionById.get(a.id) ?? 0) - (positionById.get(b.id) ?? 0))
      .map((s, i) => ({ ...s, position: i }));
    setSlides(reordered);
    await Promise.all(reordered.map(async s => {
      const { data } = await supabase.from(SLIDES_TABLE)
        .update({ position: s.position }).eq('id', s.id)
        .select('id, updated_at').maybeSingle();
      if (data) rememberUpdatedAt(data);   // keep the token fresh so the next edit doesn't false-conflict
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slides, SLIDES_TABLE]);

  // ── Settings update with debounced autosave ───────────────────────────────
  const updateSlide = useCallback((
    id: string,
    partial: { headline?: string; subheadline?: string; caption?: string; settings?: Partial<CarouselSettings> },
  ) => {
    const before = slidesRef.current.find(s => s.id === id);
    if (before) recordHistory(id, before);
    setSlides(prev => prev.map(s => {
      if (s.id !== id) return s;
      return {
        ...s,
        headline:    partial.headline    ?? s.headline,
        subheadline: partial.subheadline ?? s.subheadline,
        caption:     partial.caption     ?? s.caption,
        settings:    partial.settings ? { ...s.settings, ...partial.settings } : s.settings,
      };
    }));
    scheduleSave(id);
  }, [scheduleSave, recordHistory]);

  // ── Derived ───────────────────────────────────────────────────────────────
  const activeTemplate = templates.find(t => t.id === activeTemplateId) ?? null;
  const activeSlide    = slides.find(s => s.id === activeSlideId)       ?? null;

  const canUndo = useMemo(() => {
    if (!activeSlideId) return false;
    const h = historyRef.current.get(activeSlideId);
    return (h?.past.length ?? 0) > 0 || pendingBaseRef.current.has(activeSlideId);
  }, [histTick, activeSlideId]);
  const canRedo = useMemo(() => {
    if (!activeSlideId) return false;
    return (historyRef.current.get(activeSlideId)?.future.length ?? 0) > 0;
  }, [histTick, activeSlideId]);

  return {
    templates,
    activeTemplate,
    activeTemplateId,
    slides,
    activeSlide,
    activeSlideId,
    loading,
    saveState,
    error,
    setError,
    createTemplate,
    createFromTemplate,
    duplicateTemplate,
    selectTemplate,
    renameTemplate,
    deleteTemplate,
    restoreTemplate,
    deletedTemplates,
    loadDeletedTemplates,
    reorderTemplates,
    addSlide,
    duplicateSlide,
    selectSlide,
    renameSlide,
    deleteSlide,
    reorderSlides,
    updateSlide,
    undo,
    redo,
    canUndo,
    canRedo,
    conflictNotice,
    clearConflictNotice: () => setConflictNotice(null),
  };
}
