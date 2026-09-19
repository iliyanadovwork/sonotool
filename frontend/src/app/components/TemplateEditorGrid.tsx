'use client';

import { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo, useId } from 'react';
import { zip } from 'fflate';
import TemplateEditorCanvas, { CAROUSEL_PREVIEW_W, LOGO_PH, hasLayerClipboard } from './TemplateEditorCanvas';
import { CAROUSEL_W, CAROUSEL_H } from './TemplateEditorCanvas/constants';
import { TemplateEditorSettingsPanel } from './TemplateEditorSettingsPanel';
import { defaultCarouselSettings, orderedLayerIds, defaultTextBox, defaultImagePlaceholder, FADE_LAYER_ID } from './templateEditorTypes';
import type { TemplateEditorCanvasRef, CarouselSettings, CarouselBgLayerState, SidebarElementData, ImageBox, ImageBoxCrop, PerspectiveMode, SelectedElement } from './templateEditorTypes';
import type { RecordingState } from './TikTokCanvas/types';
import type { BrandProps } from '../types';
import { UploadsGallery } from './UploadsGallery';
import { submitUnlock } from '@/lib/video-reels/client-sync';
import { OVERLAY_IDS, overlayUrl, overlayThumbUrl } from './overlayLibrary';
import { BTN_TEXT } from '@/lib/ui-constants';
import { supabase } from '@/lib/supabase';
import { useTemplateEditor, TEMPLATE_TABLES, POST_TABLES, type TemplateRow } from '../hooks/useTemplateEditor';
import { TemplatesListRail } from './TemplatesListRail';
import { SlidesStrip } from './SlidesStrip';
import { EditorScrollBar } from './EditorScrollBar';
import { useWheelZoom } from '../hooks/useWheelZoom';
import { PostInstagramPublishDialog, type IgPublishProgress } from './PostInstagramPublishDialog';
import { usePostCollab, colorForUser, type CollabMe, type PeerCursor, type Peer } from '../hooks/usePostCollab';
import { ChartSearchCard } from './ChartSearchCard';

// Floating element-rail chrome (digitalestate2 ElementRail port). A rail icon
// button (36px) + its Miro-style hover tooltip (label pill to the right).
const RAIL_ICON_BTN =
  'w-9 h-9 rounded-xl flex items-center justify-center transition-colors ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';
const RAIL_TOOLTIP =
  'pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-3 z-[1000] whitespace-nowrap rounded-lg bg-surface-2 border border-separator shadow-lg px-2.5 py-1 text-caption-sm text-label opacity-0 group-hover/rail:opacity-100 transition-opacity duration-200 motion-reduce:transition-none';


// Per-slide ephemeral state (not persisted — refreshes every session).
// imageSrc is intentionally ephemeral: the Template editor defines styles, not
// per-post content. Users bring their own image when applying the template.
interface LocalSlideState {
  imageSrc: string;
  bgState: CarouselBgLayerState;
  scale: number;
  recordingState: RecordingState | null;
}

function makeLocal(): LocalSlideState {
  return {
    imageSrc: '',
    bgState: { fgMaskReady: false, isBgProcessing: false, bgProcessError: false },
    scale: 1,
    recordingState: null,
  };
}

// Public URL marker for the post-images bucket. Lets the tray re-derive itself
// from a reopened post's image_boxes (URLs that point at this bucket).
const POST_IMAGE_MARKER = '/post-images/';
// Same idea for uploaded videos (post-videos bucket). A video box's url/videoUrl points here.
const POST_VIDEO_MARKER = '/post-videos/';
const isVideoUrl = (url: string) => url.includes(POST_VIDEO_MARKER) || /\.mp4($|\?)/i.test(url);

// ── Per-post tray persistence ────────────────────────────────────────────────
// The tray's upload list used to hydrate from a user-wide storage listing, so
// every post shared one pool. Posts are agnostic of each other now: each post
// carries its OWN tray in template_editor_posts.tray_urls (text[], newest
// first — images and videos in the same column). Explicit tray uploads/pastes
// append there (state + DB) and dismiss (×) removes there (state + DB), so the
// tray survives reloads, section switches, and post switches without leaking
// between posts. Machine-generated uploads — IG-publish slide renders
// (`ig-publish/…`) and BRIA crop/expand intermediates — never append; media
// placed on slides still surfaces via the slide walk in the tray derivation.
// Posts created before the column exists have tray_urls = '{}' — their tray
// shows only in-use media, by design.

// Session cache: postId → tray_urls (newest first). Module-level so a section
// switch (which unmounts the editor) doesn't refetch; a page reload refetches.
const trayUrlsCache = new Map<string, string[]>();
// Per-post chain of pending tray mutations, so rapid add/dismiss from this
// client read-modify-write in order (races with teammates stay last-write-wins
// on the whole array — accepted as low-stakes).
const trayMutationQueue = new Map<string, Promise<void>>();

// Read the post's persisted tray (cache-first). Throws on a failed DB read so
// callers never mistake "couldn't read" for "empty tray".
async function fetchTrayUrls(postId: string): Promise<string[]> {
  const cached = trayUrlsCache.get(postId);
  if (cached) return cached;
  const { data, error } = await supabase
    .from('template_editor_posts')
    .select('tray_urls')
    .eq('id', postId)
    .maybeSingle();
  if (error) throw error;
  // A mutation may have seeded the cache while the select was in flight — it
  // wins (it merged on top of its own fresh read).
  const raced = trayUrlsCache.get(postId);
  if (raced) return raced;
  const raw: unknown = data?.tray_urls;
  const urls = Array.isArray(raw) ? raw.filter((u): u is string => typeof u === 'string') : [];
  trayUrlsCache.set(postId, urls);
  return urls;
}

function loadImageEl(url: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('image load failed'));
    img.src = url;
  });
}

// Render only the visible (cropped) region of an image to a PNG blob, at native crop resolution.
// Used before BRIA expand so the model receives exactly what the box shows, not the full source.
async function renderCroppedBlob(url: string, crop: ImageBoxCrop): Promise<Blob | null> {
  const img = await loadImageEl(url);
  const sW = img.naturalWidth, sH = img.naturalHeight;
  const cL = crop.left ?? 0, cR = crop.right ?? 0, cT = crop.top ?? 0, cB = crop.bottom ?? 0;
  const sx = cL * sW, sy = cT * sH;
  const sw = Math.max(1, (1 - cL - cR) * sW), sh = Math.max(1, (1 - cT - cB) * sH);
  const cv = document.createElement('canvas');
  cv.width  = Math.max(1, Math.round(sw));
  cv.height = Math.max(1, Math.round(sh));
  const ctx = cv.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, cv.width, cv.height);
  return new Promise(res => cv.toBlob(b => res(b), 'image/png'));
}

function makeDragHandlers(data: SidebarElementData, setDragging: (v: boolean) => void) {
  return {
    draggable: true as const,
    onDragStart: (e: React.DragEvent) => {
      setDragging(true);
      e.dataTransfer.setData('application/carousel-element', JSON.stringify(data));
      e.dataTransfer.setData('application/carousel-element-type/' + data.type, '');
      e.dataTransfer.effectAllowed = 'copy';
      // Use the thumbnail itself as the drag ghost. The default snapshot of the
      // dragged element gets blanked when an ancestor has backdrop-filter/
      // transform (true for the sidebar), so set it explicitly from the <img>.
      const thumb = (e.currentTarget as HTMLElement).querySelector('img, video') as HTMLElement | null;
      if (thumb && thumb.clientWidth > 0) {
        e.dataTransfer.setDragImage(thumb, thumb.clientWidth / 2, thumb.clientHeight / 2);
      }
    },
    onDragEnd: () => setDragging(false),
  };
}

// Collapsible group inside the Elements drawer. Progressive disclosure: each
// section header toggles its content, with aria-expanded / aria-controls wired
// so the disclosure is announced. Sections share a steady rhythm (header +
// gap-2 content) and are separated by space, not boxes (layout.md, deference.md).
function CollapsibleSection({
  label,
  description,
  defaultOpen = false,
  children,
}: {
  label: string;
  description?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const contentId = useId();
  return (
    <section className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-controls={contentId}
        className="flex items-center justify-between gap-2 -mx-1 px-1 py-0.5 rounded-sm text-label font-semibold text-label-secondary hover:text-label transition-colors ease-out"
      >
        <span>{label}</span>
        <svg
          width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          className="text-label-quaternary"
          style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 150ms var(--ease-out)' }}
        >
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>
      {open && (
        <div id={contentId} className="flex flex-col gap-2">
          {description && <p className="text-caption-sm text-label-quaternary leading-relaxed">{description}</p>}
          {children}
        </div>
      )}
    </section>
  );
}

// Quiet, centered empty state for a drawer section: icon + one neutral line.
// Distinct from an error (uses label-tertiary, not danger). empty-states.md.
function DrawerEmptyState({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-md bg-surface-1 px-3 py-6 text-center">
      <span className="text-label-quaternary" aria-hidden="true">{icon}</span>
      <p className="text-caption-sm text-label-tertiary">{children}</p>
    </div>
  );
}

// Live peer cursors over the canvas. Positions are design-space (0..CAROUSEL_W/H); the overlay
// fills the canvas wrapper so percentage coords are zoom-independent. Filtered to the active slide.
function PeerCursors({ cursors, activeSlideId }: { cursors: Record<string, PeerCursor>; activeSlideId: string | null }) {
  const list = Object.values(cursors).filter(c => c.slideId === activeSlideId);
  if (list.length === 0) return null;
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none z-30">
      {list.map(c => (
        <div
          key={c.id}
          className="absolute"
          style={{
            left: `${(c.x / CAROUSEL_W) * 100}%`,
            top: `${(c.y / CAROUSEL_H) * 100}%`,
            transition: 'left 90ms linear, top 90ms linear',
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill={c.color} stroke="#fff" strokeWidth="1.5" style={{ filter: 'drop-shadow(0 1px 1.5px rgba(0,0,0,0.35))' }}>
            <path d="M4 2 L4 19 L8.5 14.5 L11.2 20.5 L13.8 19.4 L11.2 13.6 L17.5 13.6 Z" />
          </svg>
          <span
            className="absolute left-4 top-3 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold text-white whitespace-nowrap"
            style={{ backgroundColor: c.color }}
          >
            {c.name}
          </span>
        </div>
      ))}
    </div>
  );
}

// Colored outline + name badge on elements a teammate is editing (advisory locks). Geometry comes
// from the slide settings (every box carries design-space x/y/width/height), so no canvas coupling.
function PeerLocks({ locks, activeSlideId, settings }: { locks: Record<string, Peer>; activeSlideId: string | null; settings: CarouselSettings }) {
  const items: { key: string; peer: Peer; x: number; y: number; w: number; h: number }[] = [];
  for (const [key, peer] of Object.entries(locks)) {
    const sep = key.indexOf(':');
    const sep2 = key.indexOf(':', sep + 1);
    const slideId = key.slice(0, sep);
    const kind = key.slice(sep + 1, sep2);
    const idx = Number(key.slice(sep2 + 1));
    if (slideId !== activeSlideId || !Number.isFinite(idx)) continue;
    const box = kind === 'text' ? settings.textBoxes?.[idx]
      : kind === 'image' ? settings.imageBoxes?.[idx]
      : kind === 'chart' ? settings.chartBoxes?.[idx] : undefined;
    if (!box) continue;
    items.push({ key, peer, x: box.x, y: box.y, w: box.width, h: box.height });
  }
  if (items.length === 0) return null;
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none z-20">
      {items.map(it => (
        <div
          key={it.key}
          className="absolute rounded-[2px]"
          style={{
            left: `${(it.x / CAROUSEL_W) * 100}%`,
            top: `${(it.y / CAROUSEL_H) * 100}%`,
            width: `${(it.w / CAROUSEL_W) * 100}%`,
            height: `${(it.h / CAROUSEL_H) * 100}%`,
            outline: `2px solid ${it.peer.color}`,
          }}
        >
          <span
            className="absolute left-0 -top-[15px] inline-block rounded-t px-1 py-px text-[9px] font-semibold text-white whitespace-nowrap leading-tight"
            style={{ backgroundColor: it.peer.color }}
          >
            {it.peer.name}
          </span>
        </div>
      ))}
    </div>
  );
}

// Stacked avatars of teammates currently in this post (presence). Empty when alone.
function PresenceAvatars({ peers }: { peers: { id: string; name: string; color: string }[] }) {
  if (peers.length === 0) return null;
  const shown = peers.slice(0, 4);
  const extra = peers.length - shown.length;
  return (
    <div className="flex items-center -space-x-1.5" role="group" aria-label="People in this post">
      {shown.map(p => (
        <span
          key={p.id}
          title={p.name}
          className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold text-white uppercase ring-2 ring-surface"
          style={{ backgroundColor: p.color }}
        >
          {p.name.slice(0, 1)}
        </span>
      ))}
      {extra > 0 && (
        <span className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold text-label-secondary bg-surface-2 ring-2 ring-surface">
          +{extra}
        </span>
      )}
    </div>
  );
}

function AutosaveChip({ state }: { state: 'idle' | 'saving' | 'saved' | 'error' }) {
  if (state === 'idle')   return null;
  if (state === 'saving') return <span className="text-micro text-label-tertiary select-none">Saving…</span>;
  if (state === 'saved')  return <span className="text-micro text-success select-none">Saved</span>;
  return <span className="text-micro text-danger select-none">Save failed</span>;
}

// djb2 hash → short base36 string. Used to build a stable idempotency key per publish
// so a lost-response retry reuses the key and the server short-circuits instead of double-posting.
function hashStr(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export function TemplateEditorGrid({ brand, userId, userName = null, mode = 'templates' }: { brand: BrandProps; userId: string | null; userName?: string | null; mode?: 'templates' | 'posts' }) {
  const isPosts = mode === 'posts';
  const editor = useTemplateEditor(userId, isPosts ? POST_TABLES : TEMPLATE_TABLES);
  // Posts mode: a "new post" picks a template to clone. Fetch the user's templates for that picker.
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [pickerTemplates, setPickerTemplates] = useState<TemplateRow[]>([]);
  useEffect(() => {
    if (!isPosts || !userId) return;
    let cancelled = false;
    void supabase.from(TEMPLATE_TABLES.parent).select('id, name, position').eq('user_id', userId).is('deleted_at', null).order('position')
      .then(({ data }) => { if (!cancelled) setPickerTemplates((data ?? []) as TemplateRow[]); });
    return () => { cancelled = true; };
  }, [isPosts, userId]);
  const [viewScale, setViewScale] = useState(0.9);
  const [isDraggingElement, setIsDraggingElement] = useState(false);
  const [selectedImageBox, setSelectedImageBox] = useState<number | null>(null);
  // Unified selection (text/image) mirrored from the canvas — drives the inspector's element accordion.
  const [selectedElement, setSelectedElement] = useState<SelectedElement | null>(null);
  const [textEdit, setTextEdit] = useState<{ boxIndex: number | null; hasSelection: boolean }>({ boxIndex: null, hasSelection: false });
  const [lockImageAspect, setLockImageAspect] = useState(true);
  // Per-image-box subject-split bg-removal status (keyed by box id), reported up from the canvas.
  const [imageBoxBgState, setImageBoxBgState] = useState<Record<string, 'processing' | 'error'>>({});
  // Per-image-box BRIA expansion status (keyed by box id).
  const [imageBoxExpandState, setImageBoxExpandState] = useState<Record<string, 'processing' | 'error'>>({});
  // The box currently in expand-preview (its fill area is shaded on the canvas); null = not previewing.
  const [expandPreviewBoxId, setExpandPreviewBoxId] = useState<string | null>(null);
  // Perspective/distort: the box whose 4 corner handles are shown on the canvas, and the active mode.
  const [perspectiveBoxId, setPerspectiveBoxId] = useState<string | null>(null);
  const [perspectiveMode, setPerspectiveMode] = useState<PerspectiveMode>('distort');
  const [cleanView, setCleanView] = useState(false);   // hide editor outlines/chrome for a clean preview
  // Left drawer: which panel is open (null = collapsed). Templates and Elements share one drawer, one at a time.
  const [localStates, setLocalStates] = useState<Record<string, LocalSlideState>>({});

  // Grid-level Undo snackbar for template/post deletes — lives HERE (not in the
  // rail) so it survives the rail unmounting when the left-drawer tab switches.
  const [undoItem, setUndoItem] = useState<{ id: string; name: string } | null>(null);
  useEffect(() => {
    if (!undoItem) return;
    const t = setTimeout(() => setUndoItem(null), 7000);
    return () => clearTimeout(t);
  }, [undoItem]);
  // Only show "Undo" when the soft-delete write actually succeeded (deleteTemplate
  // resolves true), so a failed delete never falsely claims success.
  const deleteTemplateWithUndo = async (id: string, name: string) => {
    const ok = await editor.deleteTemplate(id);
    if (ok) setUndoItem({ id, name });
  };
  // Restore from either the snackbar or the Recently-deleted list, clearing the
  // snackbar if it was pointing at this item (keeps the two in sync).
  const restoreTemplateAndClear = async (id: string) => {
    await editor.restoreTemplate(id);
    setUndoItem(u => (u?.id === id ? null : u));
  };

  // ── Header template switcher (replaces the old left Library rail) ──
  // A centered dropdown in the top bar: switch/create/rename/delete + the
  // "Recently deleted → Restore" safeguard, so removing the left list loses nothing.
  const [showTemplateMenu, setShowTemplateMenu] = useState(false);
  const [renamingTemplateId, setRenamingTemplateId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [showDeletedInMenu, setShowDeletedInMenu] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<{ top: number; left: number } | null>(null);
  const templateMenuWrapRef = useRef<HTMLDivElement | null>(null);
  const templateMenuPanelRef = useRef<HTMLDivElement | null>(null);
  const templateTriggerRef = useRef<HTMLButtonElement | null>(null);
  const editorHeaderRef = useRef<HTMLDivElement | null>(null);

  // Anchor the fixed panel below the FULL header, centered on the trigger (measured once on open).
  const openTemplateMenu = () => {
    setRenamingTemplateId(null);
    setShowTemplateMenu(v => {
      if (!v && templateTriggerRef.current) {
        const r = templateTriggerRef.current.getBoundingClientRect();
        const headerBottom = editorHeaderRef.current?.getBoundingClientRect().bottom ?? r.bottom;
        setMenuAnchor({ top: headerBottom + 8, left: r.left + r.width / 2 });
      }
      return !v;
    });
  };
  // Commit an in-progress rename before the menu tears down (blur is unreliable then).
  const flushTemplateRename = () => {
    const v = renameValue.trim();
    if (renamingTemplateId && v) editor.renameTemplate(renamingTemplateId, v);
    setRenamingTemplateId(null);
  };
  useEffect(() => {
    if (!showTemplateMenu) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (templateMenuWrapRef.current?.contains(t) || templateMenuPanelRef.current?.contains(t)) return;
      flushTemplateRename();
      setShowTemplateMenu(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;  // let the rename input cancel itself
      setShowTemplateMenu(false);
    };
    const onResize = () => {
      const trig = templateTriggerRef.current;
      if (!trig) return;
      const r = trig.getBoundingClientRect();
      const headerBottom = editorHeaderRef.current?.getBoundingClientRect().bottom ?? r.bottom;
      setMenuAnchor({ top: headerBottom + 8, left: r.left + r.width / 2 });
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    return () => { window.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey); window.removeEventListener('resize', onResize); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showTemplateMenu, renamingTemplateId, renameValue]);

  const noun = isPosts ? 'post' : 'template';

  // ── Floating element rail (replaces the docked Elements drawer) ──
  // openIsland = which rail island's 268px flyout is showing (overlays the canvas).
  const [openIsland, setOpenIsland] = useState<string | null>(null);
  const railWrapRef = useRef<HTMLDivElement | null>(null);
  const flyoutRef = useRef<HTMLDivElement | null>(null);
  const [flyoutTop, setFlyoutTop] = useState<number | null>(null);

  // Vertically centre the flyout on its opening island button, clamped 12px off the
  // screen edges; re-measure on resize + when the flyout's own height changes.
  useLayoutEffect(() => {
    if (!openIsland) { setFlyoutTop(null); return; }
    const measure = () => {
      const btn = railWrapRef.current?.querySelector(`[data-island="${openIsland}"]`) as HTMLElement | null;
      const fly = flyoutRef.current;
      if (!btn || !fly) return;
      const r = btn.getBoundingClientRect();
      const h = fly.offsetHeight;
      const m = 12;
      const centre = r.top + r.height / 2;
      setFlyoutTop(Math.max(56, Math.min(centre - h / 2, window.innerHeight - h - m)));   // 56 = header (48) + 8px, never over the header
    };
    measure();
    window.addEventListener('resize', measure);
    const fly = flyoutRef.current;
    const ro = fly ? new ResizeObserver(measure) : null;
    if (fly && ro) ro.observe(fly);
    return () => { window.removeEventListener('resize', measure); ro?.disconnect(); };
  }, [openIsland]);

  // Close the flyout on outside-click / Escape (Escape ignored while typing in a field).
  useEffect(() => {
    if (!openIsland) return;
    const onDown = (e: MouseEvent) => { if (railWrapRef.current && !railWrapRef.current.contains(e.target as Node)) setOpenIsland(null); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      setOpenIsland(null);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey); };
  }, [openIsland]);

  // (Miro-style pan/overview bar is the ported EditorScrollBar component, rendered near the bottom;
  // it owns its own scroll geometry via rAF — no per-zoom listener re-registration.)

  // ── Focal-anchored zoom (digitalestate2 parity). CSS `zoom` changes layout size, so without
  // re-anchoring the scroll the canvas drifts sideways as you zoom. Capture the content-fraction
  // under the viewport centre BEFORE each setViewScale, then restore it to centre after commit. ──
  const captureFocal = useCallback(() => {
    const el = scrollAreaRef.current, content = stageContentRef.current;
    if (!el || !content) return;
    const vr = el.getBoundingClientRect();
    const cr = content.getBoundingClientRect();
    if (cr.width > 0 && cr.height > 0) {
      zoomFocalRef.current = {
        fx: (vr.left + vr.width / 2 - cr.left) / cr.width,
        fy: (vr.top + vr.height / 2 - cr.top) / cr.height,
      };
    }
  }, []);
  useLayoutEffect(() => {
    const el = scrollAreaRef.current, content = stageContentRef.current;
    if (!el || !content) return;
    const vr = el.getBoundingClientRect();
    const cr = content.getBoundingClientRect();
    if (cr.width <= 0 || cr.height <= 0) return;
    const focalX = el.scrollLeft + (cr.left + zoomFocalRef.current.fx * cr.width) - (vr.left + vr.width / 2);
    const focalY = el.scrollTop + (cr.top + zoomFocalRef.current.fy * cr.height) - (vr.top + vr.height / 2);
    const anchor = (focal: number, max: number, soft: number) => {
      if (max <= 0) return 0;
      const clamped = Math.max(0, Math.min(max, focal));
      const wgt = soft > 0 ? Math.max(0, Math.min(1, 1 - max / soft)) : 1;
      return clamped * (1 - wgt) + (max / 2) * wgt;
    };
    const prevBehavior = el.style.scrollBehavior;
    el.style.scrollBehavior = 'auto';   // force instant re-anchor (belt-and-suspenders vs any smooth scroll-behavior)
    el.scrollLeft = anchor(focalX, el.scrollWidth - el.clientWidth, el.clientWidth / 2);
    el.scrollTop = anchor(focalY, el.scrollHeight - el.clientHeight, el.clientHeight / 2);
    el.style.scrollBehavior = prevBehavior;
  }, [viewScale]);

  // ── Post images: this post's media tray (posts mode only) ──────────────────
  // Images/videos uploaded/pasted while building THIS post. They are NOT brand
  // assets — files live in the 'post-images'/'post-videos' buckets and never
  // write a brand_kit_logos row, so they never appear in Branding. The tray
  // list itself persists per post in template_editor_posts.tray_urls (hydrated
  // below), so it survives reloads, section switches, and post switches without
  // leaking between posts. The tray just lists media to drag onto the canvas —
  // a placed ImageBox.url persists in image_boxes.
  const activePostId = isPosts ? editor.activeTemplateId : null;
  // postId → persisted tray_urls (newest first). Session-keyed per post so
  // switching back to a post doesn't refetch; hydrated from trayUrlsCache / DB.
  const [trayMap, setTrayMap] = useState<Record<string, string[]>>({});
  useEffect(() => {
    if (!isPosts || !activePostId) return;
    const pid = activePostId;
    const cached = trayUrlsCache.get(pid);
    if (cached) {
      setTrayMap(prev => (prev[pid] === cached ? prev : { ...prev, [pid]: cached }));
      return;
    }
    let cancelled = false;
    void fetchTrayUrls(pid)
      .then(urls => { if (!cancelled) setTrayMap(prev => ({ ...prev, [pid]: urls })); })
      .catch(() => {});   // read failed → tray shows only in-use media until it succeeds
    return () => { cancelled = true; };
  }, [isPosts, activePostId]);
  // ── Per-slide Instagram caption ─────────────────────────────────────────────
  // The caption lives ON each slide row (SlideRow.caption) — edited via
  // editor.updateSlide like headline, so it rides the editor's debounced
  // autosave, undo history, and the concurrency-token guard for free. The old
  // POST-level caption column survives only as a publish-dialog fallback for
  // rows written before the migration.
  const POST_CAPTION_MAX = 2199;   // one under Instagram's 2200 (DB check constraints agree)

  const [postImgUploading, setPostImgUploading] = useState(false);
  const [postImgMsg, setPostImgMsg] = useState<string | null>(null);
  const postImgMsgTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const postImageInputRef = useRef<HTMLInputElement | null>(null);

  // ── Posts → Instagram carousel publishing ──────────────────────────────────
  const [igPublishOpen, setIgPublishOpen] = useState(false);
  const [igProgress, setIgProgress]       = useState<IgPublishProgress>({ phase: 'idle' });

  // ── Realtime collaboration (posts only): presence + cursors + locks on the active post ──
  const me = useMemo<CollabMe | null>(
    () => (isPosts && userId) ? { id: userId, name: userName || 'You', color: colorForUser(userId) } : null,
    [isPosts, userId, userName],
  );
  const collab = usePostCollab(isPosts ? activePostId : null, me, editor.activeSlideId);

  // Broadcast which element this client is editing (advisory lock). Re-sent when a peer joins
  // (collab.peers.length changes) so late joiners see the current lock.
  const sendLocks = collab.sendLocks;
  const peerCount = collab.peers.length;
  useEffect(() => {
    if (!isPosts || !me) return;
    const sid = editor.activeSlideId;
    const keys = (selectedElement && sid) ? [`${sid}:${selectedElement.kind}:${selectedElement.index}`] : [];
    sendLocks(keys);
    // editor is an unstable object; we depend on its activeSlideId only.
     
  }, [isPosts, me, selectedElement, editor.activeSlideId, peerCount, sendLocks]);

  // Throttled cursor broadcast: convert client px → design space via the canvas wrapper's rect
  // (which already reflects the zoom), so peers map it back zoom-independently.
  const lastCursorSent = useRef(0);
  const onStagePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isPosts || !me) return;
    const now = performance.now();
    if (now - lastCursorSent.current < 40) return;
    lastCursorSent.current = now;
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    collab.sendCursor(
      ((e.clientX - rect.left) / rect.width) * CAROUSEL_W,
      ((e.clientY - rect.top) / rect.height) * CAROUSEL_H,
    );
  }, [isPosts, me, collab]);

  // Tray = this post's persisted tray_urls (newest first) ∪ media already
  // placed on THIS post's slides (covers teammates' placements + posts that
  // predate the tray_urls column). Deduped, persisted list first. Strictly
  // per-post — no cross-post pool. Derived in render — no sync effect.
  // A URL dismissed from tray_urls but still used on a slide keeps surfacing
  // via the slide walk — by design (dismiss edits the list, not the slides).
  const trayUrls: string[] = (() => {
    if (!activePostId) return [];
    const out: string[] = [];
    const push = (u: string) => { if (u && !out.includes(u)) out.push(u); };
    for (const u of (trayMap[activePostId] ?? [])) push(u);
    // Only read slides once they belong to the active post (avoid a mid-switch flash).
    if (isPosts && editor.slides.every(s => s.templateId === activePostId)) {
      for (const s of editor.slides)
        for (const b of (s.settings.imageBoxes ?? [])) {
          if (b.videoUrl && b.videoUrl.includes(POST_VIDEO_MARKER)) push(b.videoUrl);
          else if (b.url && b.url.includes(POST_IMAGE_MARKER)) push(b.url);
        }
    }
    return out;
  })();

  const flashPostImgMsg = useCallback((text: string) => {
    setPostImgMsg(text);
    if (postImgMsgTimer.current) clearTimeout(postImgMsgTimer.current);
    postImgMsgTimer.current = setTimeout(() => setPostImgMsg(null), 3000);
  }, []);

  // Read-modify-write against the post's persisted tray: read current (cache
  // or DB), apply fn, then write the whole merged array back. Queued per post
  // so this client's rapid mutations can't reorder each other's writes.
  const mutateTray = useCallback((pid: string, fn: (cur: string[]) => string[]) => {
    const step = async () => {
      let cur: string[];
      try {
        cur = await fetchTrayUrls(pid);
      } catch {
        // Couldn't read the persisted tray — keep the change visible this
        // session, but skip the write (a blind write could clobber entries we
        // never saw).
        setTrayMap(prev => ({ ...prev, [pid]: fn(prev[pid] ?? []) }));
        return;
      }
      const next = fn(cur);
      trayUrlsCache.set(pid, next);
      setTrayMap(prev => ({ ...prev, [pid]: next }));
      if (next.length === cur.length && next.every((u, i) => u === cur[i])) return;   // no-op (dup add / miss remove)
      const { error } = await supabase.from('template_editor_posts').update({ tray_urls: next }).eq('id', pid);
      if (error) flashPostImgMsg(`Couldn’t save tray: ${error.message}`);
    };
    const prev = trayMutationQueue.get(pid) ?? Promise.resolve();
    trayMutationQueue.set(pid, prev.then(step, step));
  }, [flashPostImgMsg]);

  // EXPLICIT user tray additions only (Upload button, Paste button, ⌘V paste).
  // Machine-generated uploads — IG-publish renders, crop/expand intermediates,
  // canvas/inspector image drops that go straight into a box — must NOT call
  // this: the per-post tray is "things I put in the tray", not machine output.
  const addToTray = useCallback((pid: string, url: string) => {
    mutateTray(pid, cur => (cur.includes(url) ? cur : [url, ...cur]));
  }, [mutateTray]);

  // Dismiss (×) is persistent: the URL leaves this post's tray_urls (state +
  // DB). The file itself stays in storage; if it's placed on a slide it still
  // surfaces via the slide walk above.
  const removeFromTray = useCallback((pid: string, url: string) => {
    mutateTray(pid, cur => cur.filter(u => u !== url));
  }, [mutateTray]);

  // Upload to the post-images bucket; returns the public URL (or null on error).
  const uploadPostImage = useCallback(async (file: File): Promise<string | null> => {
    if (!userId) return null;
    setPostImgUploading(true);
    // Sanitise the filename: keep it a single flat path segment (no '/' subfolders),
    // strip anything outside [A-Za-z0-9._-] so the storage key and its public URL agree.
    const safeName = (file.name.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'image').slice(0, 100);
    const path = `${userId}/${Date.now()}_${safeName}`;
    const { error: upErr } = await supabase.storage.from('post-images').upload(path, file);
    if (upErr) {
      setPostImgUploading(false);
      flashPostImgMsg(`Upload failed: ${upErr.message}`);
      return null;
    }
    const { data: { publicUrl } } = supabase.storage.from('post-images').getPublicUrl(path);
    setPostImgUploading(false);
    return publicUrl;
  }, [userId, flashPostImgMsg]);

  // Upload an mp4 to the post-videos bucket; returns the public URL (or null on error).
  const uploadPostVideo = useCallback(async (file: File): Promise<string | null> => {
    if (!userId) return null;
    setPostImgUploading(true);
    const safeName = (file.name.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'video').slice(0, 100);
    const path = `${userId}/${Date.now()}_${safeName}`;
    const { error: upErr } = await supabase.storage.from('post-videos').upload(path, file, { contentType: 'video/mp4' });
    if (upErr) {
      setPostImgUploading(false);
      flashPostImgMsg(`Upload failed: ${upErr.message}`);
      return null;
    }
    const { data: { publicUrl } } = supabase.storage.from('post-videos').getPublicUrl(path);
    setPostImgUploading(false);
    return publicUrl;
  }, [userId, flashPostImgMsg]);

  // File-picker upload (tray "Upload" button) — images → post-images, mp4 → post-videos; both join the tray.
  async function handlePostImageFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !activePostId) return;
    if (file.type.startsWith('video/')) {
      if (file.type !== 'video/mp4') { flashPostImgMsg('Only MP4 videos are supported.'); return; }
      const url = await uploadPostVideo(file);
      if (url) addToTray(activePostId, url);
      return;
    }
    const url = await uploadPostImage(file);
    if (url) addToTray(activePostId, url);
  }

  // Clipboard-read upload (tray "Paste" button) — mirrors BrandKitPanel.handlePaste.
  async function handlePostImagePasteButton() {
    if (!activePostId) return;
    if (typeof navigator === 'undefined' || !navigator.clipboard?.read) {
      flashPostImgMsg('Your browser doesn’t support reading the clipboard');
      return;
    }
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imageType = item.types.find(t => t.startsWith('image/'));
        if (!imageType) continue;
        const blob = await item.getType(imageType);
        const ext  = imageType.split('/')[1] || 'png';
        const file = new File([blob], `pasted-${Date.now()}.${ext}`, { type: imageType });
        const url = await uploadPostImage(file);
        if (url) addToTray(activePostId, url);
        return;
      }
      flashPostImgMsg('No image in clipboard');
    } catch {
      flashPostImgMsg('Clipboard permission denied');
    }
  }

  const canvasRef = useRef<TemplateEditorCanvasRef | null>(null);
  const scrollAreaRef = useRef<HTMLDivElement | null>(null);
  const stageContentRef = useRef<HTMLDivElement | null>(null);   // the CSS-zoomed stage column — for focal-anchored zoom
  const zoomFocalRef = useRef({ fx: 0.5, fy: 0.5 });             // content-fraction under the viewport centre, captured before each zoom

  // ── Adapter: combine persistent slide (from hook) + local ephemeral state ─
  const activeSlideId = editor.activeSlideId;
  const activePersistent = editor.activeSlide;
  const activeHasVideo = (activePersistent?.settings.imageBoxes ?? []).some(b => !!b.videoUrl)
    || (activePersistent?.settings.chartBoxes ?? []).some(c => !!c.animate && !c.hidden);
  const activeLocal = activeSlideId ? (localStates[activeSlideId] ?? makeLocal()) : makeLocal();

  // Per-slide media kind in carousel order (a slide with any video box publishes as a video item).
  const slideKinds = editor.slides.map(
    s => (((s.settings.imageBoxes ?? []).some(b => !!b.videoUrl)
        || (s.settings.chartBoxes ?? []).some(c => !!c.animate && !c.hidden)) ? 'video' as const : 'image' as const),
  );
  // Pre-fill the caption from the first slide's text (the user can edit/clear it).
  const igInitialCaption = editor.slides[0]
    ? [editor.slides[0].headline, editor.slides[0].subheadline].filter(Boolean).join('\n\n')
    : '';
  // Designated caption stored on the post (CLI `set-caption`, ≤2199 chars) — fetched fresh when
  // the publish dialog opens so a CLI write moments earlier is picked up; wins over the fallback.
  const [igStoredCaption, setIgStoredCaption] = useState<string | null>(null);
  async function openIgPublish() {
    setIgProgress({ phase: 'idle' });
    // The carousel publishes with ONE caption: the FIRST slide's. Read it from
    // live editor state (always current, even mid-debounce); fall back to the
    // legacy post-level column for posts written before slide captions existed.
    let stored: string | null = editor.slides[0]?.caption || null;
    if (!stored && activePostId) {
      const { data } = await supabase.from('template_editor_posts').select('caption').eq('id', activePostId).maybeSingle();
      stored = (data as { caption?: string | null } | null)?.caption ?? null;
    }
    setIgStoredCaption(stored);
    setIgPublishOpen(true);
  }

  // ── Export all slides ── flip through every slide (one canvas is mounted at a time, same
  // trick as the Instagram publish below), render each at Download-PNG quality (MP4 when the
  // slide has live video), and bundle everything into ONE ZIP that unpacks to a single folder
  // of numbered, carousel-ordered files. Each slide that has a caption also gets a .txt
  // sidecar on the same stem. Store-only (level 0) — the PNG/MP4 that dominate the archive
  // are already compressed; same fflate pattern as Chart Reels' Download All.
  const [exportAllBusy, setExportAllBusy] = useState<{ index: number; total: number } | null>(null);
  async function exportAllSlides() {
    const slides = editor.slides;
    if (slides.length === 0 || exportAllBusy) return;
    const base = (editor.activeTemplate?.name ?? 'design')
      .replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'design';
    const original = editor.activeSlideId;
    let currentActiveId = editor.activeSlideId;
    const waitReady = (prev: TemplateEditorCanvasRef | null, alreadyActive: boolean) => new Promise<void>(resolve => {
      const start = Date.now();
      const tick = () => {
        const c = canvasRef.current;
        const remounted = alreadyActive || (!!c && c !== prev);
        if (c && remounted && c.isReadyForPublish()) { resolve(); return; }
        if (Date.now() - start > 20000) { resolve(); return; }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    try {
      const files: Record<string, Uint8Array> = {};
      for (let i = 0; i < slides.length; i++) {
        const slide = slides[i];
        const hasVideo = (slide.settings.imageBoxes ?? []).some(b => !!b.videoUrl)
          || (slide.settings.chartBoxes ?? []).some(c => !!c.animate && !c.hidden);
        setExportAllBusy({ index: i, total: slides.length });
        const prev = canvasRef.current;
        const alreadyActive = currentActiveId === slide.id;
        if (!alreadyActive) { editor.selectSlide(slide.id); currentActiveId = slide.id; }
        await waitReady(prev, alreadyActive);
        const canvas = canvasRef.current;
        if (!canvas) continue;
        const blob = hasVideo ? await canvas.renderVideoBlob() : await canvas.renderPngBlob();
        const slideName = (slide.name || `slide-${i + 1}`).replace(/[^A-Za-z0-9._-]+/g, '-').toLowerCase();
        const stem = `${base}/${String(i + 1).padStart(2, '0')}-${slideName}`;
        files[`${stem}.${hasVideo ? 'mp4' : 'png'}`] = new Uint8Array(await blob.arrayBuffer());
        // The caption is the other half of a slide, not metadata about it: every
        // slide carries a full standalone caption (CAPTIONS.md), and a slide
        // exported on its own gets POSTED on its own. Without this the per-slide
        // captions have no way out of the app but copy-paste, since the only other
        // consumer is publishToInstagram and that reads slide 1's alone.
        // Same stem as the artwork so the pair sorts together in the folder.
        const caption = slide.caption?.trim();
        if (caption) files[`${stem}.txt`] = new TextEncoder().encode(caption);
      }
      const zipped = await new Promise<Uint8Array>((resolve, reject) =>
        zip(files, { level: 0 }, (err, data) => (err ? reject(err) : resolve(data))));
      const url = URL.createObjectURL(new Blob([zipped as BlobPart], { type: 'application/zip' }));
      Object.assign(document.createElement('a'), { href: url, download: `${base}.zip` }).click();
      URL.revokeObjectURL(url);
    } finally {
      if (original && currentActiveId !== original) editor.selectSlide(original);
      setExportAllBusy(null);
    }
  }

  // Render every slide to a JPEG/MP4, upload each to the public buckets, then hand the URLs to
  // the carousel publish route. We must switch the active slide to render it (one canvas is
  // mounted at a time), waiting for each slide's assets to load before capturing.
  async function publishToInstagram(caption: string) {
    const slides = editor.slides;
    if (slides.length === 0) { setIgProgress({ phase: 'error', message: 'This post has no slides.' }); return; }
    if (slides.length > 10)  { setIgProgress({ phase: 'error', message: 'Instagram allows at most 10 slides per carousel.' }); return; }

    const postId  = activePostId ?? 'post';
    const original = editor.activeSlideId;
    let currentActiveId = editor.activeSlideId;   // tracked locally: editor.activeSlideId won't update inside this closure
    const items: { kind: 'image' | 'video'; url: string }[] = [];

    // Resolve once the mounted canvas reflects the just-selected slide (remounted) and its assets
    // have loaded; falls through after 20s so a stuck asset can't hang the publish forever.
    const waitReady = (prev: TemplateEditorCanvasRef | null, alreadyActive: boolean) => new Promise<void>(resolve => {
      const start = Date.now();
      const tick = () => {
        const c = canvasRef.current;
        const remounted = alreadyActive || (!!c && c !== prev);
        if (c && remounted && c.isReadyForPublish()) { resolve(); return; }
        if (Date.now() - start > 20000) { resolve(); return; }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    try {
      for (let i = 0; i < slides.length; i++) {
        const slide    = slides[i];
        const hasVideo = (slide.settings.imageBoxes ?? []).some(b => !!b.videoUrl)
          || (slide.settings.chartBoxes ?? []).some(c => !!c.animate && !c.hidden);
        setIgProgress({ phase: 'rendering', index: i, total: slides.length });

        const prev = canvasRef.current;
        const alreadyActive = currentActiveId === slide.id;
        if (!alreadyActive) { editor.selectSlide(slide.id); currentActiveId = slide.id; }
        await waitReady(prev, alreadyActive);

        const canvas = canvasRef.current;
        if (!canvas) throw new Error(`Slide ${i + 1}: canvas unavailable`);
        const blob = hasVideo ? await canvas.renderVideoBlob() : await canvas.renderImageBlob();

        setIgProgress({ phase: 'uploading', index: i, total: slides.length });
        const ext  = hasVideo ? 'mp4' : 'jpg';
        const file = new File([blob], `ig-publish/${postId}-${i}.${ext}`, { type: hasVideo ? 'video/mp4' : 'image/jpeg' });
        const url  = hasVideo ? await uploadPostVideo(file) : await uploadPostImage(file);
        if (!url) throw new Error(`Failed to upload slide ${i + 1}`);
        items.push({ kind: hasVideo ? 'video' : 'image', url });
      }

      // Restore the slide the user was editing before the publish flip-through.
      if (original && currentActiveId !== original) { editor.selectSlide(original); currentActiveId = original; }

      setIgProgress({ phase: 'publishing' });
      const idempotencyKey = `post_${postId}_${items.length}_${hashStr(items.map(it => it.url).join('|') + '|' + caption)}`;
      const publishReq = () => fetch('/api/posts/instagram/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items, caption, idempotencyKey }),
      });
      let res = await publishReq();
      let data = await res.json();
      // Password-gated: prompt for the team password once, then retry.
      if (res.status === 403 && data?.locked) {
        const pw = typeof window !== 'undefined'
          ? window.prompt('Enter the team password to publish to Instagram:')
          : null;
        if (!pw || !(await submitUnlock(pw))) {
          throw new Error('Team password required to publish.');
        }
        res = await publishReq();
        data = await res.json();
      }
      if (!res.ok) throw new Error(data.error || 'Failed to publish');
      setIgProgress({ phase: 'done', permalink: data.permalink });
    } catch (err) {
      if (original && currentActiveId !== original) editor.selectSlide(original);
      setIgProgress({ phase: 'error', message: err instanceof Error ? err.message : 'Failed to publish' });
    }
  }

  function updateLocal(slideId: string, partial: Partial<LocalSlideState>) {
    setLocalStates(prev => {
      const current = prev[slideId] ?? makeLocal();
      return { ...prev, [slideId]: { ...current, ...partial } };
    });
  }

  function updateSettings(slideId: string, partial: Partial<CarouselSettings>) {
    editor.updateSlide(slideId, { settings: partial });
  }

  // ── Fade layer: delete / re-add ─────────────────────────────────────────────
  // The fade is a slide SETTING that presents as a layer, so "deleting" it means
  // marking it removed, clearing both edges, and dropping the __fade__ sentinel
  // from the z-order — nothing then reserves a layer slot or draws. Re-adding
  // restores the bottom edge at its existing floor/reach/intensity values (they
  // were never destroyed), placed at the bottom of the stack like a fresh fade.
  const removeFadeFromActive = () => {
    const slide = editor.activeSlide;
    if (!slide) return;
    // fadeRemoved alone decides existence — deliberately DON'T clear showFade /
    // showTopFade / fadeHidden. Clearing them made remove→re-add lossy (a
    // top-only fade came back as a bottom one) for no benefit: nothing draws or
    // renders a card while fadeRemoved is true.
    const order = slide.settings.layerOrderIds?.filter(id => id !== FADE_LAYER_ID);
    updateSettings(slide.id, {
      fadeRemoved: true,
      ...(order ? { layerOrderIds: order } : {}),
    });
  };
  const addFadeToActive = () => {
    const slide = editor.activeSlide;
    if (!slide) return;
    const s = slide.settings;
    const cur = s.layerOrderIds;
    // Bottom of the stack = the fade's original position, under all content.
    const order = cur && !cur.includes(FADE_LAYER_ID) ? [FADE_LAYER_ID, ...cur] : cur;
    updateSettings(slide.id, {
      fadeRemoved: false,
      // "Add" must produce something VISIBLE: un-hide, and light the bottom edge
      // only if neither edge survived from before (so a top-only fade stays top-only).
      fadeHidden: false,
      ...(!s.showFade && !s.showTopFade ? { showFade: true } : {}),
      ...(order ? { layerOrderIds: order } : {}),
    });
  };

  // Add a text box to the active slide — invoked by the rail's "Text" island.
  // (This control used to live in the inspector; digitalestate2 puts it in the rail.)
  const addTextBoxToActive = () => {
    const slide = editor.activeSlide;
    if (!slide) return;
    const arr = [...(slide.settings.textBoxes ?? [])];
    const tb = defaultTextBox();
    tb.y = Math.min(CAROUSEL_H - 150, 250 + arr.length * 120);
    arr.push(tb);
    updateSettings(slide.id, { textBoxes: arr });
  };

  // Add an empty image placeholder (slot) to the active slide — invoked by the rail's "Image" island.
  // A sensible centered default (600×600 in the 1080×1350 canvas); goes to the top of the stack + into
  // layerOrderIds, matching how the other image-insert handlers (addOverlay/addLightLeak) order new boxes.
  const addImagePlaceholderToActive = () => {
    const slide = editor.activeSlide;
    if (!slide) return;
    const fs = slide.settings;
    const w = 600, h = 600;
    const box = defaultImagePlaceholder({
      x: Math.round((CAROUSEL_W - w) / 2),
      y: Math.round((CAROUSEL_H - h) / 2),
      width: w, height: h,
    });
    const imageBoxes = [...(fs.imageBoxes ?? []), box];
    const fadeOn = !!(fs.showFade || fs.showTopFade);
    const order = orderedLayerIds(fs.imageBoxes ?? [], fs.textBoxes ?? [], fs.layerOrderIds, fadeOn, fs.chartBoxes ?? []).map(x => x.id);
    const layerOrderIds = [...order, box.id];   // top of the stack
    updateSettings(slide.id, { imageBoxes, layerOrderIds });
  };

  // Freshest active slide, so the async expand patches against current state (not a stale snapshot).
  const activeSlideRef = useRef(editor.activeSlide);
  useEffect(() => { activeSlideRef.current = editor.activeSlide; });

  // BRIA image expansion: outpaint the selected box's image so it fills the whole slide based on the
  // box's current placement, then replace the box in place (full-slide) with the result.
  async function handleExpandImageBox(boxId: string) {
    const slide = editor.activeSlide;
    if (!slide) return;
    const box = (slide.settings.imageBoxes ?? []).find(b => b.id === boxId);
    if (!box?.url) return;
    const slideId = slide.id;
    setImageBoxExpandState(prev => ({ ...prev, [boxId]: 'processing' }));
    try {
      // If the box is cropped, send BRIA exactly what's shown (the cropped region), not the full
      // source — otherwise the placement/size it's told wouldn't match the visible pixels.
      const cp = box.crop;
      const cropped = !!cp && ((cp.left ?? 0) + (cp.right ?? 0) > 0.0001 || (cp.top ?? 0) + (cp.bottom ?? 0) > 0.0001);
      let sourceUrl = box.url;
      if (cropped) {
        const croppedBlob = await renderCroppedBlob(box.url, cp!);
        const croppedUrl = croppedBlob && await uploadPostImage(new File([croppedBlob], `crop-${boxId}.png`, { type: 'image/png' }));
        if (!croppedUrl) throw new Error('failed to prepare cropped image');
        sourceUrl = croppedUrl;
      }
      const res = await fetch('/api/ai/expand-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageUrl: sourceUrl,
          canvasSize: [CAROUSEL_W, CAROUSEL_H],
          originalImageSize: [box.width, box.height],
          originalImageLocation: [box.x, box.y],
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({} as { error?: string }));
        throw new Error(j.error || `expand failed (${res.status})`);
      }
      // The route returns the expanded image bytes (server-proxied from BRIA, no client CORS).
      // Persist into our post-images bucket so it survives reload/export and is CORS-safe.
      const blob = await res.blob();
      const publicUrl = await uploadPostImage(new File([blob], `expand-${boxId}.png`, { type: blob.type || 'image/png' }));
      if (!publicUrl) throw new Error('upload failed');
      // Replace in place against the FRESHEST boxes (preserve concurrent edits; abort if the slide changed).
      const fresh = activeSlideRef.current;
      if (!fresh || fresh.id !== slideId) throw new Error('active slide changed during expand');
      const newBoxes = (fresh.settings.imageBoxes ?? []).map((b: ImageBox) =>
        b.id === boxId
          ? { ...b, url: publicUrl, x: 0, y: 0, width: CAROUSEL_W, height: CAROUSEL_H, aspect: CAROUSEL_W / CAROUSEL_H, crop: undefined, fgUrl: undefined }
          : b
      );
      if (!newBoxes.some((b: ImageBox) => b.id === boxId)) throw new Error('box removed during expand');
      // The expanded image now fills the slide, so send it to the BACK of the layer stack — a
      // full-bleed image shouldn't cover text/logos placed on top.
      const fs = fresh.settings;
      const fadeOn = !!(fs.showFade || fs.showTopFade);
      const order = orderedLayerIds(newBoxes, fs.textBoxes ?? [], fs.layerOrderIds, fadeOn).map(x => x.id);
      const layerOrderIds = [boxId, ...order.filter(id => id !== boxId)];
      updateSettings(slideId, { imageBoxes: newBoxes, layerOrderIds });
      setImageBoxExpandState(prev => { const n = { ...prev }; delete n[boxId]; return n; });
      setExpandPreviewBoxId(null);   // leave preview mode now the expand is applied
    } catch (err) {
      console.error('[expand] failed:', err);
      setImageBoxExpandState(prev => ({ ...prev, [boxId]: 'error' }));
    }
  }


  // Auto-create a first template if user has none after load.
  useEffect(() => {
    if (!userId) return;
    if (editor.loading) return;
    // Posts start empty (created from a template via the picker); only auto-seed a first template.
    if (!isPosts && editor.templates.length === 0) {
      void editor.createTemplate('My first template');
    }
  }, [userId, editor.loading, editor.templates.length, editor.createTemplate, isPosts]);

  // Trackpad pinch / Ctrl+scroll zooms the preview (arrives as a wheel event with ctrlKey set). Bound via
  // a ref callback (useWheelZoom) so it attaches reliably in production builds. The delta is CLAMPED to
  // ±10 and the step is exponential + symmetric — a coarse mouse-wheel notch is a gentle ~16% step (not a
  // jump to min/max) while a fine trackpad pinch stays responsive. Plain two-finger scroll is left to the
  // browser to pan natively. (digitalestate2 useEditorZoomPan parity.)
  const attachScroll = useWheelZoom<HTMLDivElement>(scrollAreaRef, e => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    captureFocal();
    const dy = Math.max(-10, Math.min(10, e.deltaY));
    setViewScale(v => Math.max(0.3, Math.min(2.5, v * Math.exp(-dy * 0.015))));
  });

  // Undo / redo keyboard shortcuts (⌘/Ctrl+Z, ⌘/Ctrl+Shift+Z, Ctrl+Y).
  // Ignored while typing in a field so native text undo still works there.
  const { undo, redo } = editor;
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey)) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const k = e.key.toLowerCase();
      if (k === 'z')      { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      else if (k === 'y') { e.preventDefault(); redo(); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  // Global paste-to-upload: ⌘/Ctrl+V an image from the clipboard anywhere in the editor.
  // In POSTS it lands in the image tray (drag it onto the canvas from there); in TEMPLATES (no
  // tray) it uploads and places on the canvas — filling an empty placeholder or dropping a new
  // image box. Ignored while typing so text paste still works, and defers to the canvas's layer
  // copy/paste (when an internal layer is on the clipboard, the canvas keydown owns ⌘/Ctrl+V).
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      if (hasLayerClipboard()) return;   // canvas layer-paste owns this ⌘/Ctrl+V
      const el = document.activeElement as HTMLElement | null;
      const typing = textEdit.boxIndex != null
        || (!!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable));
      if (typing) return;
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const it of Array.from(items)) {
        if (it.kind === 'file' && it.type.startsWith('image/')) {
          const file = it.getAsFile();
          if (!file) continue;
          e.preventDefault();
          if (isPosts && activePostId) {
            setOpenIsland('images');   // reveal the tray so the pasted image is visible
            const pid = activePostId;
            void uploadPostImage(file).then(url => { if (url) addToTray(pid, url); });
          } else {
            // Templates: no tray — upload, then let the canvas fill a placeholder / add an image box.
            void uploadPostImage(file).then(url => { if (url) canvasRef.current?.pasteImageUrl(url); });
          }
          return;
        }
      }
    }
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [isPosts, activePostId, textEdit.boxIndex, uploadPostImage, addToTray]);


  // h-screen (not h-full): a definite viewport height so the inner scroll area is bounded and the page
  // never scrolls — h-full (height:100%) on a flex child can fall back to content height.
  return (
    <div className="w-full flex flex-col h-screen overflow-hidden">

      {/* Top action bar — a quiet, single-row toolbar: edit/view controls on the
          left, the one primary action (Download) plus save status on the right.
          Frequent, contextual actions only; groups separated by a divider token
          (toolbars.md, deference.md). */}
      <div
        ref={editorHeaderRef}
        role="toolbar"
        aria-label="Editor actions"
        className="relative flex items-center justify-between gap-4 px-4 h-12 shrink-0"
      >
        {/* Centered template switcher — replaces the old left Library rail.
            The absolute layer is click-through; only the pill re-enables pointer
            events, and it carries NO transform so the fixed panel resolves to the
            viewport. */}
        <div className="absolute inset-x-0 flex justify-center items-center pointer-events-none">
          <div ref={templateMenuWrapRef} className="pointer-events-auto relative flex items-center">
            <button
              ref={templateTriggerRef}
              onClick={openTemplateMenu}
              aria-haspopup="menu"
              aria-expanded={showTemplateMenu}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-surface border border-separator shadow-lg text-label hover:bg-surface-1 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-label-tertiary shrink-0">
                <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
              </svg>
              <span className="text-body-sm font-medium text-label max-w-[180px] truncate" title={editor.activeTemplate?.name ?? undefined}>
                {editor.activeTemplate?.name ?? (isPosts ? 'Posts' : 'Templates')}
              </span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-label-tertiary shrink-0"><path d="m6 9 6 6 6-6"/></svg>
            </button>

            {showTemplateMenu && menuAnchor && (
              <div
                ref={templateMenuPanelRef}
                role="menu"
                className="fixed w-[260px] bg-surface-2 border border-separator rounded-xl shadow-2xl z-[70] py-1 overflow-hidden"
                style={{ top: menuAnchor.top, left: menuAnchor.left, transform: 'translateX(-50%)' }}
              >
                <div className="max-h-[320px] overflow-y-auto [&::-webkit-scrollbar]:hidden" style={{ scrollbarWidth: 'none' }}>
                  {editor.templates.length === 0 ? (
                    <p className="text-caption-sm text-label-tertiary px-3 py-4 text-center">No {noun}s yet</p>
                  ) : editor.templates.map(t => {
                    const isActive = t.id === editor.activeTemplateId;
                    const isRenaming = renamingTemplateId === t.id;
                    return (
                      <div key={t.id} className={`flex items-center gap-1 px-2 ${isActive ? 'bg-surface-1' : ''}`}>
                        {isRenaming ? (
                          <input
                            autoFocus
                            value={renameValue}
                            onChange={e => setRenameValue(e.target.value)}
                            onFocus={e => e.currentTarget.select()}
                            onClick={e => e.stopPropagation()}
                            onBlur={() => { const v = renameValue.trim(); if (v) editor.renameTemplate(t.id, v); setRenamingTemplateId(null); }}
                            onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setRenamingTemplateId(null); }}
                            className="flex-1 min-w-0 my-1 bg-surface text-label text-body-sm px-2 py-1.5 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-focus"
                          />
                        ) : (
                          <button
                            onClick={() => { if (isActive) { setRenameValue(t.name); setRenamingTemplateId(t.id); } else { void editor.selectTemplate(t.id); setShowTemplateMenu(false); } }}
                            title={isActive ? 'Click to rename' : t.name}
                            className={`flex-1 min-w-0 flex items-center gap-2 py-2 px-1 text-body-sm text-left rounded-md transition-colors ${isActive ? 'text-label' : 'text-label-secondary hover:text-label'}`}
                          >
                            <span className="flex-1 truncate">{t.name}</span>
                          </button>
                        )}
                        {!isRenaming && (
                          <>
                            <button
                              type="button"
                              onClick={e => { e.stopPropagation(); setShowTemplateMenu(false); void editor.duplicateTemplate(t.id); }}
                              title={`Duplicate ${noun}`}
                              aria-label={`Duplicate ${t.name}`}
                              className="shrink-0 w-6 h-6 flex items-center justify-center rounded text-label-quaternary hover:text-label hover:bg-surface-1 transition-colors"
                            >
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                            </button>
                            <button
                              type="button"
                              onClick={e => { e.stopPropagation(); void deleteTemplateWithUndo(t.id, t.name); }}
                              title={`Delete ${noun}`}
                              aria-label={`Delete ${t.name}`}
                              className="shrink-0 w-6 h-6 flex items-center justify-center rounded text-label-quaternary hover:text-danger hover:bg-surface-1 transition-colors"
                            >
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                            </button>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className="border-t border-separator mt-1 pt-1">
                  <button
                    type="button"
                    onClick={() => { setShowTemplateMenu(false); setRenamingTemplateId(null); if (isPosts) { setShowTemplatePicker(true); } else { void editor.createTemplate(); } }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-body-sm text-label-secondary hover:text-label hover:bg-surface-1 transition-colors"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    New {noun}
                  </button>
                </div>

                <div className="border-t border-separator mt-1 pt-1">
                  <button
                    type="button"
                    onClick={() => { const n = !showDeletedInMenu; setShowDeletedInMenu(n); if (n) editor.loadDeletedTemplates(); }}
                    aria-expanded={showDeletedInMenu}
                    className="w-full flex items-center justify-between px-3 py-2 text-caption-sm text-label-tertiary hover:text-label-secondary transition-colors"
                  >
                    <span>Recently deleted{editor.deletedTemplates.length ? ` (${editor.deletedTemplates.length})` : ''}</span>
                    <span aria-hidden>{showDeletedInMenu ? '▾' : '▸'}</span>
                  </button>
                  {showDeletedInMenu && (
                    editor.deletedTemplates.length === 0 ? (
                      <p className="px-3 pb-2 text-caption-sm text-label-quaternary">Nothing deleted recently.</p>
                    ) : (
                      <div className="px-1 pb-1 flex flex-col gap-0.5 max-h-40 overflow-y-auto">
                        {editor.deletedTemplates.map(d => (
                          <div key={d.id} className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-md hover:bg-surface-1">
                            <span className="text-body-sm text-label-tertiary truncate" title={d.name}>{d.name}</span>
                            <button type="button" onClick={() => void restoreTemplateAndClear(d.id)} className="shrink-0 text-caption-sm font-medium text-accent hover:opacity-80">Restore</button>
                          </div>
                        ))}
                      </div>
                    )
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Left spacer — undo / redo / clean-view now live in the floating rail (middle-left),
            so the header keeps the centred template switcher + the right-aligned export group. */}
        <div aria-hidden="true" />

        {/* Export + save status group — the single primary action sits apart */}
        <div className="flex items-center gap-3" role="group" aria-label="Export">
          <AutosaveChip state={editor.saveState} />
          {activeHasVideo && (() => {
            const rec = activeLocal.recordingState;
            const busy = !!rec?.isRecording;
            return (
              <button
                onClick={() => { if (!busy) void canvasRef.current?.downloadVideo(); }}
                disabled={busy}
                title="Export this slide as an MP4 video"
                className="flex items-center gap-1.5 h-8 rounded-md bg-surface border border-separator shadow-lg px-3 text-caption-sm font-medium text-label-secondary hover:text-label hover:border-label-quaternary transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {busy ? (
                  <>
                    <span className="w-3.5 h-3.5 rounded-full border-2 border-separator border-t-label animate-spin" aria-hidden="true" />
                    Exporting… {Math.round((rec?.recProgress ?? 0) * 100)}%
                  </>
                ) : (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                    </svg>
                    Download video
                  </>
                )}
              </button>
            );
          })()}
          {isPosts && activePostId && <PresenceAvatars peers={collab.peers} />}
          {isPosts && (
            <button
              onClick={() => { void openIgPublish(); }}
              title="Publish this carousel to Instagram"
              className="flex items-center gap-1.5 h-8 rounded-md bg-surface border border-separator shadow-lg px-3 text-caption-sm font-medium text-label-secondary hover:text-label hover:border-label-quaternary transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/>
              </svg>
              Publish to Instagram
            </button>
          )}
          {editor.slides.length > 1 && (
            <button
              onClick={() => { void exportAllSlides(); }}
              disabled={!!exportAllBusy}
              title="Export every slide (numbered PNGs; MP4 for video slides) bundled in one ZIP that unpacks to a single folder"
              className="flex items-center gap-1.5 h-8 rounded-md bg-surface border border-separator shadow-lg px-3 text-caption-sm font-medium text-label-secondary hover:text-label hover:border-label-quaternary transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {exportAllBusy ? (
                <>
                  <span className="w-3.5 h-3.5 rounded-full border-2 border-separator border-t-label animate-spin" aria-hidden="true" />
                  Exporting {exportAllBusy.index + 1}/{exportAllBusy.total}…
                </>
              ) : (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/><line x1="7" y1="3" x2="17" y2="3"/>
                  </svg>
                  Export all
                </>
              )}
            </button>
          )}
          <button
            onClick={() => canvasRef.current?.startDownload()}
            title="Download this slide as a PNG"
            className="flex items-center gap-1.5 h-8 rounded-md bg-accent px-3 text-caption-sm font-medium text-on-accent shadow-lg hover:bg-accent-hover active:bg-accent-pressed transition-colors ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            Download PNG
          </button>
        </div>
      </div>

      {isPosts && (
        <PostInstagramPublishDialog
          open={igPublishOpen}
          onClose={() => setIgPublishOpen(false)}
          slideKinds={slideKinds}
          initialCaption={igStoredCaption ?? igInitialCaption}
          progress={igProgress}
          onPublish={publishToInstagram}
        />
      )}


      {editor.conflictNotice && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-3 rounded-lg bg-surface border border-separator shadow-2xl px-4 py-2.5" role="status" aria-live="polite">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-label-tertiary shrink-0"><path d="M21 12a9 9 0 1 1-6.219-8.56"/><polyline points="21 3 21 9 15 9"/></svg>
          <span className="text-footnote text-label">{editor.conflictNotice}</span>
          <button onClick={editor.clearConflictNotice} className="text-caption-sm text-label-tertiary hover:text-label shrink-0">Dismiss</button>
        </div>
      )}

      {/* Left navigation rail + one drawer (Templates OR Elements, one at a time).
          The rail is a persistent icon column with horizontal labels; the active
          tab is marked with aria-current and an accent fill; clicking the active
          tab collapses the drawer (sidebars.md). */}
      {(() => {
        const islands = ([
          (isPosts && activePostId) && { id: 'images', label: 'Post images', icon: (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
          ) },
          (isPosts && activePostId) && { id: 'charts', label: 'Artist charts', icon: (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg>
          ) },
          activePersistent && { id: 'text', label: 'Add text box', action: () => addTextBoxToActive(), icon: (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7V5h16v2"/><path d="M9 19h6"/><path d="M12 5v14"/></svg>
          ) },
          // Template mode only, mirroring the Remove button: the fade layer's
          // EXISTENCE is template-defined structure. Un-gated, this let a post add
          // a fade it had no control to remove, overriding the template's locks.
          (!isPosts && activePersistent && activePersistent.settings.fadeRemoved) && { id: 'fade', label: 'Add fade', action: () => addFadeToActive(), icon: (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 14h18" opacity="0.35"/><path d="M3 17h18" opacity="0.6"/><path d="M3 20h18"/></svg>
          ) },
          activePersistent && { id: 'image', label: 'Add image', action: () => addImagePlaceholderToActive(), icon: (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
          ) },
          (brand.logos.length > 0) && { id: 'brand', label: 'Brand assets', icon: (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M20.59 13.41 13.42 20.6a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82Z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>
          ) },
          (OVERLAY_IDS.length > 0) && { id: 'overlays', label: 'Overlays', icon: (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="14" height="14" rx="2"/><path d="M7 21h10a2 2 0 0 0 2-2V9"/></svg>
          ) },
          { id: 'leaks', label: 'Light leaks', icon: (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
          ) },
        ].filter(Boolean) as Array<{ id: string; label: string; icon: React.ReactNode; action?: () => void }>);
        const active = islands.find(i => i.id === openIsland) ?? null;
        return (
      <div
        ref={railWrapRef}
        className="fixed top-12 left-56 z-30 flex flex-col items-center justify-center pointer-events-none"
        style={{ height: 'calc(100vh - 3rem - 60px)' }}   // full height MINUS a 60px bottom dock-clearance, so justify-center places the whole rail group's midpoint ABOVE the floating dock — level with the canvas artboard (lifted by the stage dock-clearance spacer) + the inspector, not 30px below
      >
        {/* Floating pill rail (Miro-style, digitalestate2 port). BOTH pills — the element
            categories card AND the undo/redo/clean-view island — are stacked IN FLOW and the
            whole GROUP is vertically centred as one unit (its midpoint lands with the canvas +
            inspector). Clicking an icon opens a 268px flyout that OVERLAYS the canvas. */}
        <div className="ml-3 flex flex-col items-center gap-2">
          {/* Element categories card */}
          <div className="pointer-events-auto flex flex-col items-center gap-1 rounded-2xl bg-surface border border-separator shadow-lg p-1.5">
            {islands.map(isl => (
              <div key={isl.id} className="relative group/rail flex">
                <button
                  data-island={isl.id}
                  type="button"
                  onClick={() => (isl.action ? isl.action() : setOpenIsland(cur => (cur === isl.id ? null : isl.id)))}
                  aria-label={isl.label}
                  aria-pressed={isl.action ? undefined : openIsland === isl.id}
                  className={`${RAIL_ICON_BTN} ${openIsland === isl.id ? 'bg-accent/15 text-accent' : 'text-label-tertiary hover:text-label hover:bg-surface-1'}`}
                >
                  {isl.icon}
                </button>
                <span role="tooltip" className={RAIL_TOOLTIP}>{isl.label}</span>
              </div>
            ))}
          </div>

          {/* Undo / redo / clean-view island — stacked beneath the element card (in flow via the
              parent's gap-2, so the whole rail centres as a group). */}
          <div className="pointer-events-auto flex flex-col items-center gap-1 rounded-2xl bg-surface border border-separator shadow-lg p-1.5">
            <div className="relative group/rail flex">
              <button
                type="button"
                onClick={() => editor.undo()}
                disabled={!editor.canUndo}
                aria-label="Undo"
                className={`${RAIL_ICON_BTN} text-label-tertiary enabled:hover:text-label enabled:hover:bg-surface-1 disabled:opacity-35 disabled:cursor-not-allowed`}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-4"/></svg>
              </button>
              <span role="tooltip" className={RAIL_TOOLTIP}>Undo (⌘Z)</span>
            </div>
            <div className="relative group/rail flex">
              <button
                type="button"
                onClick={() => editor.redo()}
                disabled={!editor.canRedo}
                aria-label="Redo"
                className={`${RAIL_ICON_BTN} text-label-tertiary enabled:hover:text-label enabled:hover:bg-surface-1 disabled:opacity-35 disabled:cursor-not-allowed`}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h4"/></svg>
              </button>
              <span role="tooltip" className={RAIL_TOOLTIP}>Redo (⌘⇧Z)</span>
            </div>
            {/* Clean-view (preview) toggle — moved here from the header. */}
            <div className="relative group/rail flex">
              <button
                type="button"
                onClick={() => setCleanView(v => !v)}
                aria-label="Clean view"
                aria-pressed={cleanView}
                className={`${RAIL_ICON_BTN} ${cleanView ? 'bg-accent/15 text-accent' : 'text-label-tertiary hover:text-label hover:bg-surface-1'}`}
              >
                {cleanView ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                )}
              </button>
              <span role="tooltip" className={RAIL_TOOLTIP}>{cleanView ? 'Show editing outlines' : 'Clean view'}</span>
            </div>
          </div>
        </div>

        {active && (
        <aside
          ref={flyoutRef}
          aria-label={active.label}
          className="pointer-events-auto fixed w-[268px] max-h-[80vh] overflow-y-auto rounded-xl bg-surface border border-separator shadow-2xl [&::-webkit-scrollbar]:hidden"
          style={{ left: 'calc(14rem + 0.75rem + 3rem + 8px)', top: flyoutTop ?? 0, visibility: flyoutTop == null ? 'hidden' : 'visible', scrollbarWidth: 'none' as const }}
        >
        <div className="flex items-center justify-between px-4 h-11 border-b border-separator sticky top-0 bg-surface z-10">
          <h2 className="text-body-sm font-semibold text-label">{active.label}</h2>
          <button type="button" onClick={() => setOpenIsland(null)} aria-label="Close" className="w-7 h-7 -mr-1.5 flex items-center justify-center rounded text-label-tertiary hover:text-label hover:bg-surface-1 text-xl leading-none">×</button>
        </div>
        <div className="flex flex-col">

          {/* Post images — this post's media tray, persisted per post (posts mode). */}
          {openIsland === 'images' && activePostId && (
            <div className="px-4 py-4">
            <CollapsibleSection
              label="Post images"
              description="Upload an image or MP4 video (or paste ⌘/Ctrl+V an image), then drag it onto the canvas. Uploads stay with this post; stays out of Branding."
              defaultOpen
            >
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => postImageInputRef.current?.click()}
                    disabled={postImgUploading}
                    className={`${BTN_TEXT} flex-1 justify-center bg-surface border-separator text-label-secondary hover:text-label hover:border-label-quaternary`}
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                    </svg>
                    {postImgUploading ? 'Uploading…' : 'Upload'}
                  </button>
                  <button
                    type="button"
                    onClick={handlePostImagePasteButton}
                    disabled={postImgUploading}
                    className={`${BTN_TEXT} flex-1 justify-center bg-surface border-separator text-label-secondary hover:text-label hover:border-label-quaternary`}
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
                    </svg>
                    Paste
                  </button>
                  <input ref={postImageInputRef} type="file" accept="image/*,video/mp4" onChange={handlePostImageFile} className="hidden" />
                </div>
                {postImgMsg && (
                  <p className="text-caption-sm text-label-tertiary leading-relaxed" role="status" aria-live="polite">
                    {postImgMsg}
                  </p>
                )}
                {trayUrls.length > 0 ? (
                  <UploadsGallery
                    logos={trayUrls.map((u, i) => ({ id: u, url: u, position: i }))}
                    dragProps={(url) => makeDragHandlers({ type: isVideoUrl(url) ? 'video' : 'image', url }, setIsDraggingElement)}
                    onDelete={(id) => removeFromTray(activePostId, id)}
                  />
                ) : (
                  <DrawerEmptyState
                    icon={
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
                      </svg>
                    }
                  >
                    No media yet
                  </DrawerEmptyState>
                )}
              </div>
            </CollapsibleSection>
            </div>
          )}

          {/* Artist charts — search the trading site, click to add an index chart element (posts mode) */}
          {openIsland === 'charts' && (
            <div className="px-4 py-4">
            <CollapsibleSection
              label="Artist charts"
              description="Search an artist and add their Sonotrade index chart to this slide as an element."
              defaultOpen
            >
              <ChartSearchCard
                onAdd={box => {
                  const slide = activeSlideRef.current;
                  if (!slide) return;
                  const cur = [...(slide.settings.chartBoxes ?? []), box];
                  updateSettings(slide.id, { chartBoxes: cur });
                  // Select the new chart so its frame + settings section open immediately — deferred
                  // a tick so the canvas sees the updated chartBoxes first (else its stale-selection
                  // guard clears a selection that points past the old array).
                  setTimeout(() => canvasRef.current?.selectElement({ kind: 'chart', index: cur.length - 1 }), 60);
                }}
              />
            </CollapsibleSection>
            </div>
          )}

          {/* Uploads — drag an image onto the canvas to add it as a movable image element */}
          {openIsland === 'brand' && (
            <div className="px-4 py-4">
            <CollapsibleSection label="Brand assets" defaultOpen>
              <UploadsGallery
                logos={brand.logos}
                dragProps={(url) => makeDragHandlers({ type: isVideoUrl(url) ? 'video' : 'image', url }, setIsDraggingElement)}
              />
            </CollapsibleSection>
            </div>
          )}

          {/* Overlays — developer-curated textures; drag onto the canvas as an image element */}
          {openIsland === 'overlays' && (
            <div className="px-4 py-4">
            <CollapsibleSection label="Overlays" defaultOpen>
              <div className="grid grid-cols-3 gap-1">
                {OVERLAY_IDS.map(id => (
                  <button
                    key={id}
                    onClick={() => canvasRef.current?.addOverlay(overlayUrl(id))}
                    className="group rounded-md bg-surface border border-separator hover:border-label-quaternary transition-colors ease-out cursor-pointer select-none overflow-hidden p-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                    style={{ aspectRatio: '1 / 1' }}
                    title="Add this overlay to the canvas"
                    aria-label="Add overlay to canvas"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={overlayThumbUrl(id)} alt="" loading="lazy" draggable={false} className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            </CollapsibleSection>
            </div>
          )}

          {openIsland === 'leaks' && (
          <div className="px-4 py-4">
          <CollapsibleSection label="Light leaks" defaultOpen>
            <div className="flex flex-wrap gap-2">
              {['#3b82f6', '#22d3ee', '#8b5cf6', '#ec4899', '#ef4444', '#f59e0b', '#22c55e', '#ffffff'].map(c => (
                <button
                  key={c}
                  onClick={() => canvasRef.current?.addLightLeak(c)}
                  title="Add a coloured light leak"
                  aria-label={`Add ${c} light leak`}
                  className="w-7 h-7 rounded-full border border-separator hover:scale-110 transition-transform ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                  style={{ background: `radial-gradient(circle, ${c} 0%, transparent 70%), #0a0a0a` }}
                />
              ))}
              {/* Custom colour — opens the OS colour picker, then adds a light leak of that exact colour. */}
              <label
                title="Pick any colour"
                className="relative w-7 h-7 rounded-full border border-separator hover:scale-110 transition-transform ease-out cursor-pointer overflow-hidden focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus"
                style={{ background: 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)' }}
              >
                <span className="sr-only">Pick any colour light leak</span>
                <input
                  type="color"
                  defaultValue="#3b82f6"
                  aria-label="Pick any colour light leak"
                  onChange={e => canvasRef.current?.addLightLeak(e.target.value)}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
              </label>
            </div>
          </CollapsibleSection>
          </div>
          )}

        </div>
        </aside>
        )}
      </div>
        );
      })()}

      {/* Undo snackbar — grid-level; survives everything */}
      {undoItem && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-lg border border-separator bg-surface-2 px-4 py-2.5 shadow-lg">
          <span className="text-caption text-label-secondary truncate max-w-[16rem]">Deleted &ldquo;{undoItem.name}&rdquo;</span>
          <button type="button" onClick={() => void restoreTemplateAndClear(undoItem.id)} className="shrink-0 text-caption font-semibold text-accent hover:opacity-80">Undo</button>
        </div>
      )}

      {/* Canvas stage — the dominant content region. Padding clears the fixed left
          rail/drawer and the right inspector so the slide stays centred and the
          chrome defers (deference.md, layout.md). The 224px app sidebar is already
          cleared by page `ml-56`; padding here clears the 64px icon rail + drawer
          (240 templates / 300 elements) + gap. */}
      <main
        ref={attachScroll}
        aria-label="Canvas"
        // safe center on both axes (digitalestate2 parity): centres the preview when it fits, but
        // degrades to START-align (fully scrollable, no clip) the moment the zoomed content overflows —
        // so scrollLeft/scrollTop directly control position and the focal-anchored zoom stays put at high
        // zoom instead of drifting. No paddings: the artboard centres in the lane [224px, VW] (same X as
        // the 22.5rem-content-box centring did), the floating rail + inspector overlay it (like DE).
        className="flex-1 overflow-auto overscroll-none flex flex-col [align-items:safe_center] [justify-content:safe_center] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        // Clicking the empty stage (the scroll area's own box or the centred column's gutter, marked
        // data-stage-bg) deselects. Element/canvas clicks stopPropagation, so they never reach here.
        onMouseDown={e => {
          const t = e.target as HTMLElement;
          // closest() so clicks on the column's empty descendant gaps (e.g. the slide-label band)
          // also deselect. The slide strip + zoom toolbar are siblings of data-stage-bg, not
          // descendants, so clicking them never deselects; elements/canvas stopPropagation.
          if (t === e.currentTarget || t.closest('[data-stage-bg]')) canvasRef.current?.selectElement(null);
        }}
      >
        <div
          data-stage-bg
          ref={stageContentRef}
          // Vertical + horizontal centring is owned by the lane's safe-center (above); this column just
          // stacks the label + artboard. shrink-0 so it never squishes below its content height.
          className="flex flex-col items-center gap-8 py-6 px-4 shrink-0"
          style={{ zoom: viewScale }}
        >
          {(() => {
            if (!activeSlideId || !activePersistent) return null;
            const id = activeSlideId;
            const index = editor.slides.findIndex(s => s.id === id);
            const slide = {
              imageSrc:       activeLocal.imageSrc,
              headline:       activePersistent.headline,
              subheadline:    activePersistent.subheadline,
              settings:       activePersistent.settings,
              bgState:        activeLocal.bgState,
              scale:          activeLocal.scale,
              recordingState: activeLocal.recordingState,
            };
            return (
              <div key={id} className="flex flex-col gap-3" style={{ width: CAROUSEL_PREVIEW_W }}>

                {/* Slide context + label — hierarchy via the type scale, not colour
                    alone: a quiet caption above a readable heading (layout.md). */}
                <div className="flex items-baseline justify-between gap-3">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-caption-sm text-label-tertiary tabular-nums">
                      Slide {index + 1} of {editor.slides.length}
                    </span>
                    <h2 className="text-headline font-semibold text-label">
                      {index === 0 ? 'Main' : `Supporting ${index}`}
                    </h2>
                  </div>

                {/* Image processing controls — placed next to the slide they affect
                    (direct-manipulation.md); grouped with a label for assistive tech. */}
                {(() => {
                  const bgState = slide.bgState;
                  const s = slide.settings;
                  const splitActive = s.bgBlurEnabled && s.bgBlurAmount === 0 && bgState.fgMaskReady;
                  const blurActive  = s.bgBlurEnabled && s.bgBlurAmount > 0 && bgState.fgMaskReady;
                  return (
                    <div className="flex items-center justify-end gap-4" role="group" aria-label="Image processing">
                      {/* Split / BG Blur (Save is handled by autosave indicator in the top toolbar) */}
                      <div className="flex items-center gap-1.5">
                        {slide.imageSrc && (
                          <>
                            <button
                              onClick={() => canvasRef.current?.toggleSplit()}
                              disabled={bgState.isBgProcessing}
                              title={bgState.bgProcessError ? 'Split failed — try again' : 'Split the subject from the background'}
                              aria-pressed={splitActive}
                              className={`${BTN_TEXT} ${
                                splitActive
                                  ? 'bg-accent text-on-accent border-accent'
                                  : bgState.bgProcessError
                                    ? 'bg-danger/15 text-danger border-danger hover:bg-danger/25'
                                    : 'bg-surface border-separator text-label-tertiary hover:text-label-secondary hover:border-label-quaternary'
                              }`}
                            >
                              {bgState.isBgProcessing ? (
                                <>
                                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ animation: 'spin 1s linear infinite' }}>
                                    <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                                  </svg>
                                  Processing…
                                </>
                              ) : bgState.bgProcessError ? 'Retry split' : splitActive ? 'Split: on' : 'Split background'}
                            </button>

                            {bgState.fgMaskReady && (
                              <button
                                onClick={() => canvasRef.current?.toggleBlur()}
                                title="Blur the background layer"
                                aria-pressed={blurActive}
                                className={`${BTN_TEXT} ${
                                  blurActive
                                    ? 'bg-accent text-on-accent border-accent'
                                    : 'bg-surface border-separator text-label-tertiary hover:text-label-secondary hover:border-label-quaternary'
                                }`}
                              >
                                {blurActive ? 'Blur: on' : 'Blur background'}
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  );
                })()}
                </div>

                {/* Canvas — lifted with a single elevation token + hairline ring so
                    the slide reads as the focal surface without competing chrome
                    (deference.md, depth.md). */}
                <div
                  className="relative mt-1 shadow-lg ring-1 ring-separator"
                  onPointerMove={isPosts ? onStagePointerMove : undefined}
                  onPointerLeave={isPosts ? () => collab.sendCursorLeave() : undefined}
                >
                  <TemplateEditorCanvas
                    ref={r => { canvasRef.current = r; }}
                    rectMode={true}
                    invertedSlots={index === 2}
                    imageSrc={slide.imageSrc}
                    headline={slide.headline}
                    subheadline={slide.subheadline}
                    settings={slide.settings}
                    onScaleChange={s => updateLocal(id, { scale: s })}
                    onSettingsChange={partial => updateSettings(id, partial)}
                    onBgLayerStateChange={s => updateLocal(id, { bgState: s })}
                    brandLogoSrc={brand.logoSrc || undefined}
                    onRecordingStateChange={state => updateLocal(id, { recordingState: state })}
                    onHeadlineChange={text => editor.updateSlide(id, { headline: text })}
                    onSubheadlineChange={text => editor.updateSlide(id, { subheadline: text })}
                    isDraggingElement={isDraggingElement}
                    onSelectedImageBoxChange={setSelectedImageBox}
                    onSelectionChange={setSelectedElement}
                    onTextEditStateChange={setTextEdit}
                    lockImageAspect={lockImageAspect}
                    cleanView={cleanView}
                    hideLayersPanel   /* the layer list lives in the right inspector now */
                    onUploadImage={(blob, filename) => uploadPostImage(new File([blob], filename, { type: blob.type || 'image/png' }))}
                    onUploadVideo={uploadPostVideo}
                    onImageBoxBgStateChange={setImageBoxBgState}
                    expandPreviewBoxId={expandPreviewBoxId}
                    perspectiveBoxId={perspectiveBoxId}
                    perspectiveMode={perspectiveMode}
                    enforceLocks={isPosts}
                  />
                  {isPosts && <PeerLocks locks={collab.locks} activeSlideId={activeSlideId} settings={slide.settings} />}
                  {isPosts && <PeerCursors cursors={collab.cursors} activeSlideId={activeSlideId} />}
                </div>

              </div>
            );
          })()}
          {/* Bottom dock clearance — reserves room below the artboard so the safe-center lane
              centres it ABOVE the floating filmstrip/zoom/pan bar, not behind it. Without this the
              dock eats the visible space below the artboard, leaving more empty space above it. */}
          <div aria-hidden="true" className="shrink-0" style={{ height: 96 }} />
        </div>

      </main>

      {/* Fixed filmstrip — floats over the bottom of the canvas (DE-style), centred UNDER the artboard
          (the artboard centres in <main>'s content box, which is inset by main's 22.5rem paddingLeft). */}
      <div className="fixed bottom-4 z-30 flex justify-center pointer-events-none" style={{ left: 'calc(14rem + 22.5rem)', right: '22.5rem' }}>
        {/* min-w-0/max-w-full keeps a long filmstrip INSIDE this band. Without them the
            flex child sizes to its content, and justify-center then spills it equally
            past both edges — over the zoom stepper on the left and off-screen on the
            right — instead of letting the strip's own overflow-x scroll do the work. */}
        <div className="pointer-events-auto min-w-0 max-w-full">
          <SlidesStrip
            slides={editor.slides}
            activeSlideId={editor.activeSlideId}
            onSelect={editor.selectSlide}
            onAdd={() => void editor.addSlide()}
            onDuplicateSlide={id => void editor.duplicateSlide(id)}
            onRename={editor.renameSlide}
            onDelete={editor.deleteSlide}
            onReorder={editor.reorderSlides}
          />
        </div>
      </div>

      {/* Miro-style pan/overview bar (digitalestate2 EditorScrollBar) — width encodes zoom level,
          drag to pan when the canvas overflows. Portalled to <body>; recomputes on rAF after zoom. */}
      <EditorScrollBar
        targetRef={scrollAreaRef}
        zoom={viewScale}
        extent={Math.max(0, Math.min(1, 1 - (viewScale - 0.3) / (2.5 - 0.3)))}
        // Same band as the filmstrip so the bar is centred UNDER the artboard (which centres in
        // <main>'s content box, inset by main's 22.5rem paddingLeft), not shifted left toward the sidebar.
        style={{ left: 'calc(14rem + 22.5rem)', right: '22.5rem' }}
      />

      {/* Floating zoom control — Figma/Miro-style −/percent/+ stepper (digitalestate2 port).
          Preview only (never affects export); the percent resets to 100%, pinch-to-zoom still works. */}
      <div role="group" aria-label="View zoom" className="fixed bottom-4 left-[calc(14rem+0.75rem)] z-40 flex items-center gap-0.5 rounded-xl bg-surface border border-separator shadow-lg p-1 select-none">
        {(() => {
          const pct = Math.round(viewScale * 100);
          const ZMIN = 30, ZMAX = 250;
          const step = (dir: number) => { captureFocal(); setViewScale(Math.max(ZMIN, Math.min(ZMAX, pct + dir * 10)) / 100); };
          const zBtn = 'flex items-center justify-center w-7 h-7 rounded-lg text-label-secondary transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus enabled:hover:bg-surface-1 enabled:hover:text-label disabled:opacity-35 disabled:cursor-not-allowed';
          return (
            <>
              <button type="button" onClick={() => step(-1)} disabled={pct <= ZMIN} aria-label="Zoom out" className={zBtn}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>
              </button>
              <button type="button" onClick={() => { captureFocal(); setViewScale(1); }} title="Reset zoom to 100%" aria-label="Reset zoom to 100%" className="h-7 min-w-[3.25rem] px-1 rounded-lg text-caption-sm font-medium tabular-nums text-label-secondary transition-colors hover:bg-surface-1 hover:text-label focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">{pct}%</button>
              <button type="button" onClick={() => step(1)} disabled={pct >= ZMAX} aria-label="Zoom in" className={zBtn}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              </button>
            </>
          );
        })()}
      </div>

      {/* Inspector — a non-blocking complementary panel on the right edge. Transparent
          background (no drawer chrome) so its cards FLOAT over the canvas the way
          digitalestate2 does, rather than sitting inside a solid drawer. */}
      <aside
        role="complementary"
        aria-label="Slide and layer settings"
        className="fixed top-12 right-0 z-20 bg-transparent w-[22.5rem] h-[calc(100vh-3rem-60px)] flex flex-col"
      >
        {/* The fused draggable layer list now lives inside the settings panel (it leads the
            inspector and each row expands to that element's controls), so it's not rendered here. */}
        {activePersistent && (
          <TemplateEditorSettingsPanel
            settings={activePersistent.settings}
            onChange={partial => updateSettings(activePersistent.id, partial)}
            videoMode={false}
            enforceLocks={isPosts}
            onRemoveFade={removeFadeFromActive}
            postCaption={{
              value: activePersistent.caption,
              loading: false,
              max: POST_CAPTION_MAX,
              onChange: v => editor.updateSlide(activePersistent.id, { caption: v.slice(0, POST_CAPTION_MAX) }),
              isTemplate: !isPosts,
              // Posts: locked when the template shipped a caption for this slide.
              // createPostFromTemplate stamps 'caption' into lockedSettings for any
              // template slide whose caption was non-empty.
              locked: isPosts && !!activePersistent.settings.lockedSettings?.includes('caption'),
            }}
            selectedImageBox={selectedImageBox}
            selectedElement={selectedElement}
            onSelectElement={sel => canvasRef.current?.selectElement(sel)}
            lockImageAspect={lockImageAspect}
            onLockImageAspectChange={setLockImageAspect}
            onUploadImage={uploadPostImage}
            imageBoxBgState={imageBoxBgState}
            imageBoxExpandState={imageBoxExpandState}
            onExpandImageBox={handleExpandImageBox}
            expandPreviewBoxId={expandPreviewBoxId}
            onExpandPreview={setExpandPreviewBoxId}
            perspectiveBoxId={perspectiveBoxId}
            onPerspectiveBox={setPerspectiveBoxId}
            perspectiveMode={perspectiveMode}
            onPerspectiveMode={setPerspectiveMode}
            richText={{
              activeBox: textEdit.boxIndex,
              hasSelection: textEdit.hasSelection,
              setWeight:    w => canvasRef.current?.setSelectionWeight(w),
              toggleItalic: () => canvasRef.current?.toggleSelectionItalic(),
              setColor:     c => canvasRef.current?.setSelectionColor(c),
              toggleSecondary: () => canvasRef.current?.toggleSelectionSecondary(),
            }}
          />
        )}
      </aside>

      {/* New-post template picker (posts mode): pick a template to clone into a fresh post */}
      {isPosts && showTemplatePicker && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70"
          onMouseDown={e => { if (e.target === e.currentTarget) setShowTemplatePicker(false); }}
        >
          <div className="bg-surface border border-separator rounded-2xl shadow-2xl p-4 w-[26.25rem]" style={{ maxHeight: '80vh', overflowY: 'auto' }}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-semibold text-label-secondary">New post from a template</span>
              <button onClick={() => setShowTemplatePicker(false)} className="text-label-tertiary hover:text-label-secondary transition-colors" aria-label="Close">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>
            {pickerTemplates.length === 0 ? (
              <p className="text-xs text-label-tertiary py-6 text-center leading-relaxed">No templates yet.<br />Create one in the Template editor first.</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {pickerTemplates.map(t => (
                  <button
                    key={t.id}
                    onClick={() => { setShowTemplatePicker(false); void editor.createFromTemplate(t.id); }}
                    className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-surface-1 hover:bg-surface-2 text-left text-sm text-label-secondary transition-colors"
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-label-tertiary">
                      <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
                    </svg>
                    <span className="truncate">{t.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  );
}
