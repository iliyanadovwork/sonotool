'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { upload } from '@vercel/blob/client';
import { zip } from 'fflate';
import Image from 'next/image';
import { TikTokCanvas, TikTokCanvasRef } from './TikTokCanvas';
import { CaptionComposer } from './CaptionComposer';
import { proxyStreamUrl, pickBestVideoUrl } from '@/lib/video-reels/proxy-url';
import { normalizeComposeRows, resolveWriteTarget } from '@/lib/video-reels/compose-rows';
import { isLockedCaptionCell, prependCaption, captionForDisplay } from '@/lib/video-reels/caption-cell';
import { buildPublishIdempotencyKey } from '@/lib/video-reels/publish-key';
import { getAuthHeader, fetchUnlockStatus, submitUnlock } from '@/lib/video-reels/client-sync';
import { getPageConfig, getPageTemplates, getTemplate, templateOverlay } from '@/lib/video-reels/page-config';
import { useInstagramConnection } from '../InstagramConnection';
import { useGoogleConnection } from '../GoogleConnection';
import { VideoReelsOverview } from './VideoReelsOverview';
import { AccountAnalyticsView } from './AccountAnalyticsView';
import { GRID_BG_STYLE } from '@/lib/ui-constants';

// Check for Google OAuth tokens in URL on mount

// Check for Meta OAuth status in URL on mount
function getMetaStatusFromUrl() {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const meta = params.get('meta');
  const metaError = params.get('meta_error');
  // NOTE: does NOT strip the URL — the mount reads meta AND google params, then
  // strips once (stripping here would drop ?google=connected before it's read).
  return { connected: meta === 'connected', error: metaError };
}

// Coerce an error value to a string for rendering. API responses sometimes put
// a structured object (e.g. { code, id, message }) on `error`/`message`; passing
// that straight into JSX throws React error #31, so always render a string.
function toMsg(v: unknown, fallback = ''): string {
  if (v == null) return fallback;
  if (typeof v === 'string') return v || fallback;
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o.message === 'string') return o.message;
    if (typeof o.error === 'string') return o.error;
    try { return JSON.stringify(v); } catch { return fallback; }
  }
  return String(v);
}

// Caught values are typed `unknown` under `strict`, so an error's message has to
// be narrowed before it can be used. These keep the `e?.message || …` shape the
// catch blocks below already relied on.
function errMessage(e: unknown): string | undefined {
  const m = (e as { message?: unknown } | null | undefined)?.message;
  return typeof m === 'string' && m ? m : undefined;
}

function errText(e: unknown, fallback: string): string {
  return errMessage(e) ?? fallback;
}

interface InstagramUser {
  id: string;
  username: string;
  accountType: string;
}

interface Author {
  uniqueId: string;
  nickname: string;
  avatarThumb: string;
}

interface VideoData {
  id: string;
  title: string;
  cover: string;
  author: Author;
  play: string;       // SD, no watermark
  wmplay: string;     // SD, with watermark
  hdplay: string;     // HD, no watermark
  duration: number;
  size: number;
  images?: string[];  // for photo/image posts
  publishedMediaId?: string; // Instagram media id after a successful publish (dedup guard)
}

interface Market {
  accounts: Record<string, unknown>;
  canCloseEarly: boolean;
  closeTime: number;
  eventTicker: string;
  expirationTime: number;
  marketType: string;
  noSubTitle: string;
  openInterest: number;
  openTime: number;
  result: string;
  rulesPrimary: string;
  status: string;
  subtitle: string;
  ticker: string;
  title: string;
  volume: number;
  yesSubTitle: string;
  earlyCloseCondition?: string;
  noAsk?: string;
  noBid?: string;
  rulesSecondary?: string;
  yesAsk?: string;
  yesBid?: string;
}

interface SettlementSource {
  name: string;
  url: string;
}

interface EventData {
  seriesTicker: string;
  subtitle: string;
  ticker: string;
  title: string;
  competition: string | null;
  competitionScope: string | null;
  imageUrl: string;
  liquidity: number;
  markets: Market[];
  openInterest: number;
  settlementSources: SettlementSource[];
  strikeDate: number;
  strikePeriod: string;
  volume: number;
  volume24h: number;
}

interface VideoEntry {
  id: string;
  url: string;
  caption: string;
  tag: string;
  instagramCaption: string;
  change: string;
  data: VideoData | null;
  marketData: EventData | null;
  loading: boolean;
  loadingMarket: boolean;
  error: string;
  marketError: string;
  videoFailed: boolean; // Track if video failed to load in canvas
  instagramPermalink?: string; // Instagram URL after successful publish
  sheetRow?: number; // The actual spreadsheet row number (for display and updating)
  uploadError?: string; // Persistent upload error message (until dismissed)
  audioWarning?: boolean; // Last export produced a SILENT file (source audio unreadable); cleared by a later export with intact audio
  queuePosition?: number; // Position in upload queue (0 = currently processing, undefined = not in queue)
  // For a compose-row entry: the sheet the row was loaded from, frozen at open
  // time so a compose always writes back to it even if the inputs change (or a
  // different sheet is reloaded) while the composer is open.
  composeTarget?: { spreadsheetId: string; sheetName: string };
  // For a sheet-imported grid row: the sheet/tab it was imported from, frozen at
  // import time so caption (col B/F) and published-status (col E) writes always go
  // back to THAT page's tab even after the active page (and thus the live
  // sheetName) changes. Same guard the composer uses via composeTarget.
  sheetOrigin?: { spreadsheetId: string; sheetName: string };
}

// ── JSON bodies this component reads back from its own API routes ────────────
// Every field is optional: an error response carries only `error`, and the
// `.catch(() => ({}))` fallback body carries nothing at all.

// POST /api/video-reels/extract-caption
interface ExtractCaptionResponse {
  caption?: string;
  keyUsed?: number;
  error?: string;
}

// POST /api/video-reels/google/sheets/update
interface SheetUpdateResponse {
  success?: boolean;
  skipped?: boolean;
  reason?: string;
  value?: string;
  error?: string;
}

// POST /api/video-reels/google/sheets/generate-caption
interface GenerateCaptionResponse {
  success?: boolean;
  skipped?: boolean;
  reason?: string;
  caption?: string;
  keyUsed?: number;
  error?: string;
}

// POST /api/video-reels/google/sheets/clean-prompts
interface CleanPromptsResponse {
  success?: boolean;
  changed?: number;
  total?: number;
  preserved?: number;
  error?: string;
}

// POST /api/video-reels/google/sheets/extract-title-prompt
interface ExtractTitlePromptResponse {
  success?: boolean;
  skipped?: boolean;
  reason?: string;
  caption?: string | null;
  description?: string | null;
  wroteTitle?: boolean;
  prependedTitle?: boolean;
  wroteTopic?: boolean;
  keyUsed?: number;
  error?: string;
}

// One row from GET /api/video-reels/google/sheets. `change` is not currently
// sent by that route — kept optional so the existing `|| ''` fallback still
// type-checks (and keeps working if the route ever starts sending it).
interface ImportedSheetRow {
  url: string;
  caption: string;
  tag?: string;
  instagramCaption?: string;
  status?: string;
  change?: string;
  sheetRow: number;
}

// Tags that drive a visual template rather than a prediction market — these
// must not be looked up in TAG_TO_EVENT_ID (it would report "Unknown tag").
const NON_MARKET_TAGS = new Set(['index', 'feedforce']);

// Tag to Event ID mapping
const TAG_TO_EVENT_ID: Record<string, string> = {
  'film': 'KXENGAGEMENTTIMOTHEEKYLIE-26',
  'kanye': 'KXSPOTIFYALBUMRELEASEDATEKANYE-MAR21',
};

export function VideoReelsSection() {
  // App-global connections (single source of truth). connectMeta/switchAccount stay
  // local — they carry the per-app key, the Supabase JWT, and the unlock gate the
  // context doesn't cover.
  const ig = useInstagramConnection();
  const google = useGoogleConnection();
  const igUser = ig.igUser;
  const allAccounts = ig.accounts;
  const googleToken = google.connected; // boolean "connected" flag (never the token)

  // Which sub-view is showing: overview grid (landing), posting workflow, or a
  // page's detailed analytics.
  const [view, setView] = useState<'overview' | 'post' | 'analytics'>('overview');
  const [selectedIgUserId, setSelectedIgUserId] = useState<string | null>(null);
  // Build-only mode: the page-config key of an UNCONNECTED page we're rendering
  // reels for. Drives the overlay + sheet tab exactly as a real switch would, but
  // every publish path is hard-disabled while it's set — the meta_token cookie
  // still points at some OTHER account, so publishing here would post this page's
  // branding to that one. Null = normal, connection-backed mode.
  const [buildOnlyPage, setBuildOnlyPage] = useState<string | null>(null);
  // Selected template id for the active page. Reset to that page's DEFAULT on every
  // page change (see the page-config effect) so a look chosen for one account can
  // never leak onto the next one's reels.
  const [templateId, setTemplateId] = useState<string | null>(null);
  const prevActiveIdRef = useRef<string | null | undefined>(undefined);

  const [entries, setEntries] = useState<VideoEntry[]>([
    { id: '1', url: '', caption: '', tag: '', instagramCaption: '', change: '', data: null, marketData: null, loading: false, loadingMarket: false, error: '', marketError: '', videoFailed: false }
  ]);

  // Store refs for each canvas to trigger downloads
  const canvasRefsMap = useRef<Map<string, TikTokCanvasRef>>(new Map());

  // Per-video overlay style for the active page. DERIVED from the connected IG
  // username via page-config.ts (see the page-config effect below) — no longer a
  // manual toggle. The 'sonotradeio' style stays in code (TikTokCanvas overlay
  // props) but no page maps to it: retained-but-unexposed. Only sonotradehq
  // carries an overlay; the other three post with none.
  const [brandMode, setBrandMode] = useState<'sonotrade' | 'sonotradeio' | 'empty'>('sonotrade');

  // Google Sheets state
  // googleToken (a boolean "connected") now comes from useGoogleConnection() — see top.
  const [showSheetsModal, setShowSheetsModal] = useState(false);
  const [spreadsheetId, setSpreadsheetId] = useState('1z9KIhjPJFo9rOJ4CDW-y7W9W4MEm8Lso-EsFRknbv5w');
  const [sheetName, setSheetName] = useState("SonotradeHQ");
  // The manual spreadsheet-ID + sheet-name inputs are hidden now that the active
  // page drives both via page-config.ts. Flip to true to expose them again as an
  // advanced override (e.g. for a page that isn't in the registry yet).
  const SHOW_SHEET_OVERRIDE: boolean = false;
  const [availableSheets, setAvailableSheets] = useState<Array<{ id: string; title: string; index: number }>>([]);
  const [loadingSheetNames, setLoadingSheetNames] = useState(false);
  const [startRow, setStartRow] = useState('4');
  const [endRow, setEndRow] = useState('32');
  const [loadingSheets, setLoadingSheets] = useState(false);
  const [sheetsError, setSheetsError] = useState('');
  // AI caption generation state
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  // Which action group the sheets modal is showing (keeps it short).
  const [sheetTab, setSheetTab] = useState<'generate' | 'extract' | 'compose'>('generate');
  // The row log is collapsed by default; it auto-expands while a job runs.
  const [logOpen, setLogOpen] = useState(false);
  const [generatingCaptions, setGeneratingCaptions] = useState(false);
  // Caption prompt style: 'search' = keyword-optimised micro-blog (default);
  // 'story' = the narrative creator format ("In [year]…" → stats closer,
  // ~2000-2100 chars, wrapped in quotes and ending with "music content").
  const [captionStyle, setCaptionStyle] = useState<'search' | 'story'>('search');
  // Sheet-driven title (B) + prompt (F) extraction over a row range — shares
  // the generate-captions modal UI (progress banner + per-row log).
  // null when idle, else which extraction pass is running ('title' | 'prompt' | 'both').
  const [extractingSheet, setExtractingSheet] = useState<'both' | 'title' | 'prompt' | null>(null);
  // Retro-clean column F (existing prompts) over the row range.
  const [cleaningPrompts, setCleaningPrompts] = useState(false);
  const [generateProgress, setGenerateProgress] = useState('');
  const [generateError, setGenerateError] = useState('');
  // Live per-row log for the generation run (row, status, which key served it)
  type GenLogEntry = {
    row: number;
    status: 'generating' | 'done' | 'skipped' | 'failed';
    keyUsed?: number;
    detail?: string;
  };
  const [generateLog, setGenerateLog] = useState<GenLogEntry[]>([]);
  const [logCopied, setLogCopied] = useState(false);
  const generateLogRef = useRef<HTMLDivElement>(null);

  // Keep the live log scrolled to the newest row as it streams in.
  useEffect(() => {
    const el = generateLogRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [generateLog]);

  // Serialize the run log to plain text (mirrors the on-screen rows) so it can be
  // pasted into a bug report — the Copy button beside the Log header.
  const serializeGenerateLog = (entries: GenLogEntry[]): string =>
    entries
      .map((e) => {
        const line =
          e.status === 'done'
            ? `✓ ${e.detail || 'generated'}${e.keyUsed !== undefined ? ` · key #${e.keyUsed}` : ''}`
            : e.status === 'failed'
              ? `✕ ${e.detail || 'failed'}`
              : e.status === 'skipped'
                ? `⏭ skipped — ${e.detail || ''}`
                : `⏳ ${e.detail || 'generating…'}`;
        return `Row ${e.row}\n${line}`;
      })
      .join('\n');

  const copyGenerateLog = async () => {
    const text = serializeGenerateLog(generateLog);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback for non-secure contexts / older browsers.
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch { /* ignore */ }
      document.body.removeChild(ta);
    }
    setLogCopied(true);
    setTimeout(() => setLogCopied(false), 1500);
  };

  // Instagram state — igUser/allAccounts now come from useInstagramConnection() (see top).
  // The Instagram apps (one per profile) the user can connect through.
  const [metaApps, setMetaApps] = useState<Array<{ key: string; label: string }>>([]);
  const [showAccountDropdown, setShowAccountDropdown] = useState(false);
  const [showConnectPicker, setShowConnectPicker] = useState(false);
  // Team password gate (posting/managing). metaLocked = gate on AND not unlocked.
  const [metaLocked, setMetaLocked] = useState(false);
  const [showUnlockPrompt, setShowUnlockPrompt] = useState(false);
  const [unlockPassword, setUnlockPassword] = useState('');
  const [unlockError, setUnlockError] = useState('');
  const [unlockPending, setUnlockPending] = useState(false);
  // The action to retry after a successful unlock (so the password prompt is seamless).
  const pendingActionRef = useRef<(() => void) | null>(null);
  // Mirror of metaLocked read INSIDE requireUnlock — a retried action captures a
  // stale metaLocked from its closure, so the ref is the live value.
  const metaLockedRef = useRef(false);
  const [metaError, setMetaError] = useState('');

  // Upload state
  const [uploadingEntry, setUploadingEntry] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStatus, setUploadStatus] = useState('');
  // Debug toggle: export with no audio track. Used to test whether IG container ERROR
  // is caused by copyrighted-music detection vs. format issues.
  const [stripAudio, setStripAudio] = useState(false);
  // Debug toggle: encode at ~1.5 Mbps to test whether IG's "Payload too large" is a size cap.
  const [lowBitrate, setLowBitrate] = useState(false);

  // Instagram upload queue (ensures only one render+upload at a time)
  const uploadQueueRef = useRef<Array<string>>([]);
  const isProcessingUploadRef = useRef(false);
  // The entry id currently being rendered+published (fresh, ref-based so async
  // code reads it without a stale closure). Used to dedupe enqueues and to mark
  // queue positions correctly.
  const processingEntryIdRef = useRef<string | null>(null);

  // Mirror of `entries` for use in callbacks that need fresh state outside the render closure
  const entriesRef = useRef<VideoEntry[]>([]);
  useEffect(() => { entriesRef.current = entries; });

  // Bulk upload to Instagram state
  const [bulkUploading, setBulkUploading] = useState(false);
  // Bulk ZIP export progress ({done, total}); null when not exporting
  const [zipExport, setZipExport] = useState<{ done: number; total: number } | null>(null);
  // Post-export notice (skipped rows / bundling failure); null when all good
  const [zipNotice, setZipNotice] = useState<string | null>(null);
  // Overlay-caption extraction (Gemini vision on source-video frames):
  // bulk progress, per-entry in-flight ids, and the post-run summary notice.
  const [captionExtract, setCaptionExtract] = useState<{ done: number; total: number } | null>(null);
  const [captionNotice, setCaptionNotice] = useState<string | null>(null);
  const [extractingIds, setExtractingIds] = useState<Set<string>>(new Set());
  // Caption composer (compose the overlay caption from the extracted caption +
  // the reel's top comments). Holds the entry being composed, or null.
  const [composerEntry, setComposerEntry] = useState<VideoEntry | null>(null);
  // Rows loaded into the Generate-AI-Captions modal for interactive composing
  // (each row's URL + current column-B caption); null until "Load rows" is hit.
  const [composeRows, setComposeRows] = useState<{ url: string; caption: string; sheetRow: number }[] | null>(null);
  const [loadingComposeRows, setLoadingComposeRows] = useState(false);
  const [composeRowsError, setComposeRowsError] = useState('');
  // The sheet the compose rows were loaded from, captured at load time, so a
  // compose writes back to THAT sheet even if the user later edits the inputs.
  const [composeContext, setComposeContext] = useState<{ spreadsheetId: string; sheetName: string } | null>(null);
  // A stale compose-row list (loaded from a now-different sheet) must not be
  // composable — clear it when the sheet identity changes so it's reloaded fresh.
  // Deliberately KEEP composeContext: an already-open composer must still write
  // back to the sheet its row was LOADED from, even if the inputs change (e.g. a
  // keyboard Tab reaches the Sheet Name field behind the composer overlay). It's
  // overwritten on the next successful load.
  useEffect(() => {
    setComposeRows(null);
    setComposeRowsError('');
  }, [spreadsheetId, sheetName]);
  // Synchronous mirror of extractingIds: state reads are render-time snapshots,
  // so two overlapping calls (per-card click + bulk run) could both see an
  // entry as idle and seek the SAME <video> concurrently, corrupting both
  // captures. The ref is checked/set before any await.
  const extractingIdsRef = useRef<Set<string>>(new Set());
  const [bulkUploadPaused, setBulkUploadPaused] = useState(false);
  const [bulkUploadProgress, setBulkUploadProgress] = useState(0);
  const [bulkUploadStatus, setBulkUploadStatus] = useState('');
  const [bulkUploadTotal, setBulkUploadTotal] = useState(0);
  const [bulkUploadCompleted, setBulkUploadCompleted] = useState(0);
  const bulkUploadAbortRef = useRef(false);
  // Mirror of bulkUploadPaused for reads inside the long-running upload loop —
  // the state value is captured stale in that async closure, so the loop must
  // read the ref or "Pause" never actually pauses.
  const bulkUploadPausedRef = useRef(false);

  // On mount: load the connectable apps + the unlock-gate status. Restore, the
  // /me + /accounts reads, and the OAuth-return param handling are owned by the
  // app-wide InstagramConnectionProvider / GoogleConnectionProvider now.
  useEffect(() => {
    fetchMetaApps();
    refreshUnlockState();
  }, []);

  // Fetch sheet names when spreadsheetId changes and Google is connected
  useEffect(() => {
    if (googleToken && spreadsheetId) {
      debouncedFetchSheetNames(spreadsheetId);
    }
    // Cleanup timeout on unmount
    return () => {
      if (sheetNameFetchTimeout.current) {
        clearTimeout(sheetNameFetchTimeout.current);
      }
    };
  }, [spreadsheetId, googleToken]);

  // Single source of truth for the active page's overlay + Google Sheet tab:
  // resolve page-config.ts from the connected username. Fires on initial load and
  // on every page switch (switchAccount -> fetchInstagramUser -> igUser change),
  // so selecting a page automatically retargets the overlay AND the sheet tab.
  // Replaces both the old brandMode->sheetName effect and the sonotradehq-only
  // auto-brand effect.
  useEffect(() => {
    // buildOnlyPage takes precedence: in that mode there is no connected account
    // for this page, so the registry key IS the source of truth for overlay+tab.
    const source = buildOnlyPage ?? igUser?.username;
    if (!source) return;
    const cfg = getPageConfig(source);
    setSpreadsheetId(cfg.spreadsheetId);
    setSheetName(cfg.sheetName);
    // Always open on the page's default template — never inherit the previous
    // page's selection. cfg.brandMode and templates[0].brandMode agree by design.
    const def = getPageTemplates(source)[0];
    setTemplateId(def.id);
    setBrandMode(def.brandMode);
  }, [igUser?.username, buildOnlyPage]);

  // Switch the active page's look. Resolved through getTemplate so an unknown id
  // falls back to the page default rather than leaving a stale brand applied.
  function selectTemplate(id: string) {
    const t = getTemplate(buildOnlyPage ?? igUser?.username, id);
    setTemplateId(t.id);
    setBrandMode(t.brandMode);
  }

  // On-video lockup for the active page + template. Derived from the template
  // (not from brandMode) so two pages sharing a brand can differ — sonotradeio's
  // branded template is titled "Sonotrade Media", SonotradeHQ's stays "Sonotrade".
  const overlay = templateOverlay(getTemplate(buildOnlyPage ?? igUser?.username, templateId));

  // Clear the workspace when the ACTIVE account changes from OUTSIDE this section
  // (e.g. the sidebar switcher) so a stale grid can't post to the wrong page. Skip
  // the first run and null->value so an initial connect / imported grid isn't wiped.
  useEffect(() => {
    const prev = prevActiveIdRef.current;
    const curr = igUser?.id ?? null;
    if (prev !== undefined && prev !== null && curr !== null && prev !== curr) {
      // Don't wipe the grid out from under a running upload (that would strand it).
      // The active account changed elsewhere (e.g. the sidebar) — accept the switch
      // without clearing; the user can reset manually once the upload settles.
      // In build-only mode the grid belongs to an unconnected page, not to the
      // active account — an unrelated switch elsewhere must not wipe it.
      if (!bulkUploading && !uploadingEntry && !buildOnlyPage) clearWorkspaceForSwitch();
    }
    prevActiveIdRef.current = curr;
  }, [igUser?.id]);

  // getGoogleStatusFromUrl + checkGoogleConnection removed — Google connection is
  // owned by GoogleConnectionProvider (useGoogleConnection); the ?google OAuth
  // return is handled there too.

  function addRow() {
    setEntries([...entries, {
      id: Date.now().toString(),
      url: '',
      caption: '',
      tag: '',
      instagramCaption: '',
      change: '',
      data: null,
      marketData: null,
      loading: false,
      loadingMarket: false,
      error: '',
      marketError: '',
      videoFailed: false
    }]);
  }

  function removeRow(id: string) {
    if (entries.length === 1) return; // Keep at least one row
    setEntries(entries.filter(e => e.id !== id));
  }

  function resetEverything() {
    setEntries([
      { id: '1', url: '', caption: '', tag: '', instagramCaption: '', change: '', data: null, marketData: null, loading: false, loadingMarket: false, error: '', marketError: '', videoFailed: false }
    ]);
  }

  function handleVideoError(id: string) {
    setEntries(prev => prev.map(e =>
      e.id === id ? { ...e, videoFailed: true } : e
    ));
  }

  // A video flagged as failed (load timeout) can still finish loading — the
  // canvas clears its own overlay and calls this so the row's Fetch button
  // doesn't stay stuck on "Retry" for a video that's actually playable.
  function handleVideoRecovered(id: string) {
    setEntries(prev => prev.map(e =>
      e.id === id && e.videoFailed ? { ...e, videoFailed: false } : e
    ));
  }

  // Re-mint a fresh download URL for an entry (e.g., when its rapidcdn JWT has aged out).
  // Updates entry.data with the new payload — the canvas's videoSrc prop will change
  // reactively — AND returns the fresh raw play URL so an in-flight export can retry
  // with it directly (the prop change can't reach a function that's already running).
  async function refetchEntrySrc(id: string): Promise<string | null> {
    const entry = entriesRef.current.find(e => e.id === id);
    if (!entry?.url?.trim()) return null;
    console.log('[Refetch] Fetching fresh URL for entry:', id, entry.url);
    // Bound the re-mint so the canvas spinner can't hang if /api/video-reels/download stalls
    // or the connection drops (the route maxDuration is 60s; allow a little more).
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 65000);
    let res: Response;
    try {
      res = await fetch('/api/video-reels/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: entry.url.trim() }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }
    if (!res.ok) {
      console.error('[Refetch] /api/video-reels/download failed:', res.status);
      throw new Error(`Refetch failed: ${res.status}`);
    }
    const json = await res.json();
    setEntries(prev => prev.map(e => e.id === id ? { ...e, data: json } : e));
    console.log('[Refetch] ✅ Fresh URL applied for entry:', id);
    return json.hdplay || json.play || json.wmplay || null;
  }

  function updateEntry(id: string, field: 'url' | 'caption' | 'tag' | 'change' | 'instagramCaption', value: string) {
    setEntries(prevEntries => prevEntries.map(e => e.id === id ? { ...e, [field]: value } : e));
  }

  async function fetchVideo(id: string) {
    // Get current entry data before any async operations (read the ref so the
    // sequential bulk-fetch loop sees fresh state, not a stale render closure)
    const currentEntry = entriesRef.current.find(e => e.id === id);

    if (!currentEntry || !currentEntry.url.trim()) {
      setEntries(prev => prev.map(e =>
        e.id === id ? { ...e, error: 'URL is required' } : e
      ));
      return;
    }

    // NOTE: a caption is no longer required to fetch — captions can now be
    // extracted FROM the video after it loads ("Read caption" / bulk extract),
    // so captionless rows must be fetchable.

    // Set loading state for both video and market (skip market in forum mode)
    setEntries(prev => prev.map(e =>
      e.id === id ? { ...e, loading: true, loadingMarket: !!e.tag.trim() && e.tag.trim().toLowerCase() !== 'index', error: '', data: null, marketData: null, marketError: '', videoFailed: false } : e
    ));

    try {
      const res = await fetch('/api/video-reels/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: currentEntry.url.trim() }),
      });

      const json = await res.json();

      setEntries(prev => prev.map(e =>
        e.id === id ? {
          ...e,
          loading: false,
          error: res.ok ? '' : (json.error || 'Something went wrong'),
          data: res.ok ? json : null,
          videoFailed: false
        } : e
      ));
    } catch (err) {
      console.error('Fetch video error:', err);
      setEntries(prev => prev.map(e =>
        e.id === id ? { ...e, loading: false, error: 'Network error — please try again', loadingMarket: false } : e
      ));
      return;
    }

    // Fetch market data if tag is present (skip in forum mode)
    const entry = entriesRef.current.find(e => e.id === id);
    // `index` (CTA carousel) and `feedforce` (branded sticker) are presentation
    // tags, not market tags — skip the market lookup for them, otherwise each
    // fetch surfaces a spurious "Unknown tag: …" error.
    if (entry?.tag.trim() && !NON_MARKET_TAGS.has(entry.tag.trim().toLowerCase())) {
      const tag = entry.tag.trim().toLowerCase();
      const eventId = TAG_TO_EVENT_ID[tag];

      if (eventId) {
        console.log('Fetching market for tag:', tag, '→ eventId:', eventId);
        try {
          const res = await fetch(`/api/video-reels/market?eventId=${encodeURIComponent(eventId)}&withNestedMarkets=true`);
          const json = await res.json();
          setEntries(prev => prev.map(e =>
            e.id === id ? {
              ...e,
              loadingMarket: false,
              marketError: res.ok ? '' : (json.error || json.message || `Error ${res.status}: Failed to fetch market data`),
              marketData: res.ok ? json : null
            } : e
          ));
        } catch (error) {
          console.error('Fetch market error:', error);
          setEntries(prev => prev.map(e =>
            e.id === id ? { ...e, loadingMarket: false, marketError: 'Network error' } : e
          ));
        }
      } else {
        setEntries(prev => prev.map(e =>
          e.id === id ? { ...e, loadingMarket: false, marketError: `Unknown tag: ${tag}` } : e
        ));
      }
    }
  }

  async function fetchAllVideos() {
    // Get all entries that need fetching. A caption is NOT required — it can
    // be extracted from the video after fetching.
    const entriesToFetch = entries.filter(e =>
      e.url.trim() && !e.data && !e.loading
    );

    if (entriesToFetch.length === 0) return;

    // Fetch sequentially to avoid rate limiting
    for (const entry of entriesToFetch) {
      await fetchVideo(entry.id);
      // Delay between requests to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  // Export every fetched video and bundle them into ONE zip (same pattern as
  // the the companion app bulk export): render each reel sequentially, nest the
  // files under a dated folder inside the archive, then download a single
  // <folder>.zip. Store-only compression — the MP4s are already compressed.
  async function downloadAll() {
    if (zipExport) return; // an export is already running
    // Get all entries with fetched video data
    const entriesToDownload = entries.filter(e => e.data && !e.loading && !(e.data.images && e.data.images.length > 0));
    if (entriesToDownload.length === 0) return;

    // One dated folder for the whole batch (filesystem-safe, no colons).
    const now = new Date();
    const p2 = (n: number) => String(n).padStart(2, '0');
    const folder = `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())}_${p2(now.getHours())}-${p2(now.getMinutes())}-${p2(now.getSeconds())}`;

    setZipExport({ done: 0, total: entriesToDownload.length });
    setZipNotice(null);
    const files: Record<string, Uint8Array> = {};
    try {
      // Stores one rendered MP4 into the in-memory zip map. Same name
      // convention as a single export: row-XX-<videoId>.mp4
      const addExport = async (entry: (typeof entriesToDownload)[number], idx: number, blob: Blob) => {
        const num = entry.sheetRow ?? idx + 1;
        let name = `row-${String(num).padStart(2, '0')}-${entry.data?.id ?? 'export'}.mp4`;
        if (files[`${folder}/${name}`]) name = name.replace(/\.mp4$/, `-${idx + 1}.mp4`);
        files[`${folder}/${name}`] = new Uint8Array(await blob.arrayBuffer());
        // Exporting a row marks it "published" (best-effort, same as single export).
        await markSheetRowPublished(entry.sheetRow, entry.sheetOrigin);
      };

      // Render each video sequentially (each render is heavy; parallel would thrash)
      const firstPassFailures: Array<{ entry: (typeof entriesToDownload)[number]; idx: number; permanent?: boolean }> = [];
      for (let i = 0; i < entriesToDownload.length; i++) {
        const entry = entriesToDownload[i];
        const canvasRef = canvasRefsMap.current.get(entry.id);
        if (canvasRef) {
          try {
            const blob = await canvasRef.exportBlob();
            if (blob) await addExport(entry, i, blob);
            else firstPassFailures.push({ entry, idx: i });
          } catch (error) {
            console.error(`Failed to export video ${entry.id}:`, error);
            // UnsupportedFormatError is deterministic (codec the browser can't
            // decode) — a retry would just re-render a doomed row.
            firstPassFailures.push({ entry, idx: i, permanent: (error as Error)?.name === 'UnsupportedFormatError' });
          }
        } else {
          firstPassFailures.push({ entry, idx: i });
        }
        setZipExport({ done: i + 1, total: entriesToDownload.length });
        // Yield a macrotask between rows so the browser can run pending codec
        // teardown / GC before the next heavy export allocates — extra headroom
        // for the hardware source-decoder pool on top of the software encoder.
        await new Promise((r) => setTimeout(r, 0));
      }

      // Second chance for rows that failed: decode hiccups are often transient
      // (and a failed export no longer poisons the decoder pool for later
      // rows), so retry each once before reporting it as failed.
      const stillFailedRows: number[] = [];
      if (firstPassFailures.length > 0) {
        const permanentCount = firstPassFailures.filter((f) => f.permanent).length;
        console.log('[Zip Export] Retrying', firstPassFailures.length - permanentCount, 'failed row(s)…',
          permanentCount ? `(${permanentCount} unsupported-format row(s) not retried — deterministic)` : '');
        for (const { entry, idx, permanent } of firstPassFailures) {
          if (permanent) { stillFailedRows.push(entry.sheetRow ?? idx + 1); continue; }
          const canvasRef = canvasRefsMap.current.get(entry.id);
          try {
            const blob = canvasRef ? await canvasRef.exportBlob() : null;
            if (blob) await addExport(entry, idx, blob);
            else stillFailedRows.push(entry.sheetRow ?? idx + 1);
          } catch (error) {
            console.error(`Failed to export video ${entry.id} (retry):`, error);
            stillFailedRows.push(entry.sheetRow ?? idx + 1);
          }
        }
      }

      const exported = Object.keys(files).length;
      // Rows whose export completed but produced a SILENT file (see onAudioLost).
      // A zip full of muted reels downloading "fine" must not read as success.
      const mutedRows = entriesRef.current
        .filter((e) => e.audioWarning && entriesToDownload.some((d) => d.id === e.id))
        .map((e) => e.sheetRow ?? '?');
      const mutedNote = mutedRows.length
        ? ` ${mutedRows.length} exported WITHOUT audio (rows ${mutedRows.join(', ')}) — source audio unreadable, check before posting.`
        : '';
      if (exported > 0) {
        // Store-only (level 0) — just fast bundling, no recompression.
        const zipped = await new Promise<Uint8Array>((resolve, reject) =>
          zip(files, { level: 0 }, (err, data) => (err ? reject(err) : resolve(data))));
        const url = URL.createObjectURL(new Blob([zipped as BlobPart], { type: 'application/zip' }));
        Object.assign(document.createElement('a'), { href: url, download: `${folder}.zip` }).click();
        URL.revokeObjectURL(url);
      }
      // Don't let skipped rows pass silently — the zip downloading "fine" would
      // otherwise read as everything having made it in.
      if (stillFailedRows.length > 0) {
        setZipNotice(`Exported ${exported} of ${entriesToDownload.length} videos — ${stillFailedRows.length} failed to render even after a retry (rows ${stillFailedRows.join(', ')} — see console).${mutedNote}`);
      } else if (exported < entriesToDownload.length) {
        setZipNotice(`Exported ${exported} of ${entriesToDownload.length} videos — ${entriesToDownload.length - exported} failed to render (see console).${mutedNote}`);
      } else if (mutedNote) {
        setZipNotice(`Exported ${exported} of ${entriesToDownload.length} videos.${mutedNote}`);
      }
    } catch (error) {
      console.error('[Zip Export] Failed to bundle zip:', error);
      setZipNotice('ZIP export failed — see console for details.');
    } finally {
      setZipExport(null);
    }
  }

  // Reads the creator's overlay caption from an entry's source video (frames →
  // Gemini vision) and applies it: entry state + column B writeback when the
  // row came from the sheet. Also pushes the source post's description
  // (entry.data.title) into column F as the AI-caption topic — onlyIfEmpty, so
  // a hand-written topic is never clobbered.
  //
  // Column B is PREPENDED to, not replaced (see lib/video-reels/caption-cell) —
  // and a cell locked with {…} skips the row before any vision call is spent.
  // 'ok' = extracted (+ sheet updated if applicable); 'ok-sheet-failed' =
  // extracted but the column B write failed; 'none' = no overlay caption;
  // 'locked' = column B is {…}, nothing read or written.
  async function extractCaptionForEntry(entry: VideoEntry, spread: number): Promise<'ok' | 'ok-sheet-failed' | 'none' | 'failed' | 'locked'> {
    // Cheap local pre-check so a locked row costs nothing. The sheet is the
    // real authority (this copy of B dates from import), so the write call
    // re-checks and can still come back 'locked'.
    if (isLockedCaptionCell(entry.caption)) return 'locked';
    const canvasRef = canvasRefsMap.current.get(entry.id);
    if (!canvasRef?.extractFrames) return 'failed';
    // Sync-ref guard: never run two extractions against the same <video>.
    if (extractingIdsRef.current.has(entry.id)) return 'failed';
    extractingIdsRef.current.add(entry.id);
    setExtractingIds(prev => new Set(prev).add(entry.id));
    try {
      const frames = await canvasRef.extractFrames();
      if (!frames?.length) {
        console.error('[Extract Caption] Entry', entry.id, '— video not ready for frame capture');
        return 'failed';
      }

      // Same retry contract as caption generation: 429 (whole key pool rate
      // limited) waits out the per-minute quota window; 5xx/network gets a
      // quick exponential backoff; 4xx fails fast.
      const MAX_ATTEMPTS = 3;
      const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
      let res: Response | null = null;
      let data: ExtractCaptionResponse = {};
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          res = await fetch('/api/video-reels/extract-caption', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ frames, spread }),
          });
          data = await res.json().catch(() => ({} as ExtractCaptionResponse));
          if (res.ok) break;
          const rateLimited = res.status === 429;
          if ((!rateLimited && res.status < 500) || attempt === MAX_ATTEMPTS) break;
          const delayMs = rateLimited
            ? 20000 * attempt + Math.random() * 5000
            : 2000 * 2 ** (attempt - 1) + Math.random() * 1000;
          console.warn(`[Extract Caption] Entry ${entry.id} — ${data?.error || res.status}; retrying in ${Math.round(delayMs / 1000)}s (${attempt + 1}/${MAX_ATTEMPTS})`);
          await sleep(delayMs);
        } catch (e) {
          if (attempt === MAX_ATTEMPTS) throw e;
          await sleep(2000 * 2 ** (attempt - 1) + Math.random() * 1000);
        }
      }
      if (!res || !res.ok) {
        console.error('[Extract Caption] Entry', entry.id, 'failed:', data?.error || `HTTP ${res?.status}`);
        return 'failed';
      }

      // Writes target the row's FROZEN origin tab (captured at import), not the
      // live active-page sheet — so switching pages mid-batch can't corrupt a
      // different page's rows. Falls back to live inputs for rows with no origin.
      const { spreadsheetId: writeSpreadsheetId, sheetName: writeSheetName } =
        resolveWriteTarget(entry.sheetOrigin, spreadsheetId, sheetName);
      const canWriteSheet = entry.sheetRow !== undefined && googleToken && !!writeSpreadsheetId;

      // Source description → column F (topic), independent of the overlay result.
      const description = entry.data?.title?.trim();
      if (description && canWriteSheet) {
        fetch('/api/video-reels/google/sheets/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            spreadsheetId: writeSpreadsheetId,
            sheetName: writeSheetName,
            rowNumber: entry.sheetRow,
            column: 'F',
            value: description,
            onlyIfEmpty: true,
          }),
        }).catch(() => { /* best-effort */ });
      }

      const caption = typeof data.caption === 'string' ? data.caption.trim() : '';
      if (!caption) return 'none';

      // Compose locally against the entry's own caption. Read inside the
      // updater so it's the live value, never a stale closure snapshot.
      const applyLocally = () =>
        setEntries(prev => prev.map(e => (e.id === entry.id ? { ...e, caption: prependCaption(caption, e.caption) } : e)));

      // No sheet behind this row — local state is the only place to put it.
      if (!canWriteSheet) {
        applyLocally();
        return 'ok';
      }

      // Sheet-backed: the SHEET composes the new value, since it holds the live
      // column B; the entry then mirrors whatever actually landed there.
      // Awaited so a failed sheet write is REPORTED, not silently dropped.
      try {
        const writeRes = await fetch('/api/video-reels/google/sheets/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            spreadsheetId: writeSpreadsheetId,
            sheetName: writeSheetName,
            rowNumber: entry.sheetRow,
            column: 'B',
            value: caption,
            prepend: true,
          }),
        });
        const writeData: SheetUpdateResponse = await writeRes.json().catch(() => ({}));
        if (!writeRes.ok) {
          console.error('[Extract Caption] Row', entry.sheetRow, 'column B write failed:', writeData?.error || writeRes.status);
          // Keep the caption locally so the extraction isn't thrown away.
          applyLocally();
          return 'ok-sheet-failed';
        }
        if (writeData?.skipped) {
          // The cell was locked with {…} after these rows were imported — the
          // local pre-check couldn't have known. Sync to the sheet and stop.
          const lockedValue = writeData.value;
          if (typeof lockedValue === 'string') {
            setEntries(prev => prev.map(e => (e.id === entry.id ? { ...e, caption: lockedValue } : e)));
          }
          return 'locked';
        }
        const writtenValue = writeData?.value;
        if (typeof writtenValue === 'string') {
          setEntries(prev => prev.map(e => (e.id === entry.id ? { ...e, caption: writtenValue } : e)));
        } else {
          applyLocally();
        }
      } catch (e) {
        console.error('[Extract Caption] Row', entry.sheetRow, 'column B write failed:', errMessage(e) ?? e);
        applyLocally();
        return 'ok-sheet-failed';
      }
      return 'ok';
    } catch (e) {
      console.error('[Extract Caption] Entry', entry.id, 'error:', errMessage(e) ?? e);
      return 'failed';
    } finally {
      extractingIdsRef.current.delete(entry.id);
      setExtractingIds(prev => {
        const next = new Set(prev);
        next.delete(entry.id);
        return next;
      });
    }
  }

  // Apply a composed overlay caption: update the entry (re-renders the canvas)
  // and write it to column B when the row came from the sheet.
  async function confirmComposedCaption(entry: VideoEntry, caption: string) {
    setEntries(prev => prev.map(e => (e.id === entry.id ? { ...e, caption } : e)));
    // Reflect the new caption in the modal's row list too (if it's loaded).
    if (entry.sheetRow !== undefined) {
      setComposeRows(prev => (prev ? prev.map(r => (r.sheetRow === entry.sheetRow ? { ...r, caption } : r)) : prev));
    }
    setComposerEntry(null);
    // Write to the sheet the row was LOADED from, frozen onto the entry at open
    // time — immune to any input change or reload while the composer is open.
    const { spreadsheetId: targetSpreadsheetId, sheetName: targetSheetName } = resolveWriteTarget(entry.composeTarget, spreadsheetId, sheetName);
    const canWriteSheet = entry.sheetRow !== undefined && googleToken && targetSpreadsheetId;
    if (!canWriteSheet) {
      setCaptionNotice('Caption set on the video (no sheet row to write to).');
      return;
    }
    // Retry transient failures. Downloading videos can saturate the connection
    // enough that an outbound call dies at the TCP level ("fetch failed"), and
    // losing the write means silently redoing the whole compose. Auth/validation
    // errors (4xx other than 429) are permanent — fail fast on those.
    const MAX_ATTEMPTS = 3;
    let lastError = '';
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      let retriable = false;
      try {
        const res = await fetch('/api/video-reels/google/sheets/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            spreadsheetId: targetSpreadsheetId,
            sheetName: targetSheetName,
            rowNumber: entry.sheetRow,
            column: 'B',
            value: caption,
          }),
        });
        if (res.ok) {
          setCaptionNotice(`Row ${entry.sheetRow}: caption set → written to ${targetSheetName}!B${entry.sheetRow}.`);
          return;
        }
        const err: SheetUpdateResponse = await res.json().catch(() => ({}));
        lastError = err?.error || `HTTP ${res.status}`;
        retriable = res.status >= 500 || res.status === 429;
      } catch (e) {
        // Network-level failure (offline, DNS, connection reset) — always worth a retry.
        lastError = errText(e, 'network error');
        retriable = true;
      }
      if (!retriable || attempt === MAX_ATTEMPTS) {
        console.error('[Compose Caption] Row', entry.sheetRow, 'column B write failed:', lastError);
        setCaptionNotice(
          `Row ${entry.sheetRow}: caption set on the video, but writing to ${targetSheetName}!B${entry.sheetRow} FAILED (${lastError}). The sheet still has the old value — re-open Compose and confirm again.`
        );
        return;
      }
      console.warn(`[Compose Caption] Row ${entry.sheetRow} write failed (${lastError}); retrying ${attempt + 1}/${MAX_ATTEMPTS}`);
      setCaptionNotice(`Row ${entry.sheetRow}: sheet write failed (${lastError}) — retrying ${attempt + 1}/${MAX_ATTEMPTS}…`);
      await new Promise((r) => setTimeout(r, 800 * 2 ** (attempt - 1) + Math.random() * 400));
    }
  }

  // Load the rows in the current Start–End range into the Generate-AI-Captions
  // modal so each can be composed interactively (URL from column A, current
  // overlay caption from column B). Same sheet read as importFromSheets.
  async function loadComposeRows() {
    if (!googleToken || !spreadsheetId.trim() || !sheetName.trim()) {
      setComposeRowsError('Connect Google Sheets, set a spreadsheet ID, and pick a sheet first.');
      return;
    }
    setLoadingComposeRows(true);
    setComposeRowsError('');
    try {
      const res = await fetch(
        `/api/video-reels/google/sheets?spreadsheet_id=${encodeURIComponent(spreadsheetId.trim())}&start_row=${startRow}&end_row=${endRow}&sheet_name=${encodeURIComponent(sheetName.trim())}`
      );
      const data = await res.json().catch(() => ({} as { rows?: unknown[]; error?: string }));
      if (!res.ok) {
        setComposeRowsError(data.error || `Failed to load rows (HTTP ${res.status})`);
        return;
      }
      setComposeRows(normalizeComposeRows(data.rows));
      setComposeContext({ spreadsheetId: spreadsheetId.trim(), sheetName: sheetName.trim() });
    } catch (e) {
      setComposeRowsError(errText(e, 'Network error loading rows'));
    } finally {
      setLoadingComposeRows(false);
    }
  }

  // Open the composer for a specific sheet row (from the modal list). Builds a
  // synthetic entry — no grid fetch needed; the composer lazily loads the video.
  function openComposerForRow(r: { url: string; caption: string; sheetRow: number }) {
    if (!r.url.trim()) return;
    setComposerEntry({
      id: `compose-row-${r.sheetRow}`,
      url: r.url,
      caption: r.caption || '',
      tag: '',
      instagramCaption: '',
      change: '',
      data: null,
      marketData: null,
      loading: false,
      loadingMarket: false,
      error: '',
      marketError: '',
      videoFailed: false,
      sheetRow: r.sheetRow,
      // Freeze the write target now (from the sheet these rows were loaded from),
      // so it can't be redirected by a later input change or reload.
      composeTarget: composeContext ?? { spreadsheetId: spreadsheetId.trim(), sheetName: sheetName.trim() },
    });
  }

  // Bulk: extract overlay captions for every fetched video, prepending each one
  // to whatever column B already holds. Rows whose column B is locked with {…}
  // are skipped outright. Note this is NOT idempotent — running it twice
  // prepends twice. Small concurrency; `spread` staggers key usage.
  async function extractAllCaptions() {
    if (captionExtract) return;
    const candidates = entries.filter(
      e =>
        e.data &&
        !e.loading &&
        !(e.data.images && e.data.images.length > 0) &&
        // Skip anything a per-card click is already extracting.
        !extractingIdsRef.current.has(e.id)
    );
    const targets = candidates.filter(e => !isLockedCaptionCell(e.caption));
    if (targets.length === 0) {
      setCaptionNotice(
        candidates.length > 0
          ? `Nothing to extract — all ${candidates.length} video(s) have column B locked with {…}.`
          : 'Nothing to extract — no fetched videos.'
      );
      return;
    }
    setCaptionNotice(null);
    setCaptionExtract({ done: 0, total: targets.length });
    let ok = 0, sheetFailed = 0, none = 0, failed = 0, locked = 0, done = 0;
    const CONCURRENCY = 3;
    let nextIndex = 0;
    const workers = Array.from({ length: Math.min(CONCURRENCY, targets.length) }, async () => {
      while (nextIndex < targets.length) {
        const idx = nextIndex++;
        const result = await extractCaptionForEntry(targets[idx], idx);
        if (result === 'ok') ok++;
        else if (result === 'ok-sheet-failed') { ok++; sheetFailed++; }
        else if (result === 'none') none++;
        else if (result === 'locked') locked++;
        else failed++;
        done++;
        setCaptionExtract({ done, total: targets.length });
      }
    });
    await Promise.all(workers);
    setCaptionExtract(null);
    const preSkipped = candidates.length - targets.length;
    const parts = [`${ok} prepended → column B`];
    if (sheetFailed) parts.push(`${sheetFailed} sheet write(s) FAILED (caption kept locally — see console)`);
    if (none) parts.push(`${none} had no overlay caption`);
    if (preSkipped + locked) parts.push(`${preSkipped + locked} skipped ({…} locked)`);
    if (failed) parts.push(`${failed} failed`);
    setCaptionNotice(`Captions: ${parts.join(', ')}.`);
  }

  async function uploadAllToInstagram() {
    // Publishing needs the team password — prompt before the bulk run starts.
    if (!requireUnlock(() => uploadAllToInstagram())) return;
    // Get all entries with fetched video data that haven't been published yet.
    const entriesToUpload = entries.filter(e =>
      e.data && !e.loading &&
      !(e.data.images && e.data.images.length > 0) &&
      !e.instagramPermalink && !e.data.publishedMediaId
    );

    if (entriesToUpload.length === 0) {
      setBulkUploadStatus('No videos to upload');
      return;
    }

    // Reset state
    bulkUploadAbortRef.current = false;
    bulkUploadPausedRef.current = false;
    setBulkUploading(true);
    setBulkUploadPaused(false);
    setBulkUploadCompleted(0);
    setBulkUploadTotal(entriesToUpload.length);
    setBulkUploadProgress(0);
    setBulkUploadStatus(`Starting upload of ${entriesToUpload.length} videos...`);

    // Upload each video sequentially
    for (let i = 0; i < entriesToUpload.length; i++) {
      const entry = entriesToUpload[i];

      // Check if aborted
      if (bulkUploadAbortRef.current) {
        setBulkUploadStatus('Upload cancelled');
        setBulkUploading(false);
        return;
      }

      // Wait while paused (read the ref, not the stale-closure state value)
      while (bulkUploadPausedRef.current && !bulkUploadAbortRef.current) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Check again after pause
      if (bulkUploadAbortRef.current) {
        setBulkUploadStatus('Upload cancelled');
        setBulkUploading(false);
        return;
      }

      const canvasRef = canvasRefsMap.current.get(entry.id);
      if (canvasRef && canvasRef.startUpload) {
        setBulkUploadStatus(`Uploading video ${i + 1} of ${entriesToUpload.length}...`);
        try {
          // Use startUpload instead of startDownload to upload to Instagram
          await canvasRef.startUpload();
          setBulkUploadCompleted(i + 1);
          setBulkUploadProgress(Math.round(((i + 1) / entriesToUpload.length) * 100));
          // Add a small delay between uploads to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (error) {
          console.error(`Failed to upload video ${entry.id}:`, error);
          setBulkUploadStatus(`Failed to upload video ${i + 1}: ${error instanceof Error ? error.message : 'Unknown error'}`);
          // Continue with next video instead of stopping
        }
      }
    }

    setBulkUploadStatus(`Upload complete! ${entriesToUpload.length} videos uploaded.`);
    setBulkUploading(false);

    // Clear status after 5 seconds
    setTimeout(() => {
      if (!bulkUploading) {
        setBulkUploadStatus('');
        setBulkUploadProgress(0);
      }
    }, 5000);
  }

  function toggleBulkUploadPause() {
    setBulkUploadPaused(prev => {
      const newValue = !prev;
      bulkUploadPausedRef.current = newValue;
      setBulkUploadStatus(newValue ? 'Paused' : `Uploading video ${bulkUploadCompleted + 1} of ${bulkUploadTotal}...`);
      return newValue;
    });
  }

  function cancelBulkUpload() {
    // Signal abort but DON'T clear bulkUploading here — the loop clears it once
    // the in-flight upload settles, so per-row buttons stay disabled and can't
    // race the still-running upload.
    bulkUploadAbortRef.current = true;
    bulkUploadPausedRef.current = false;
    setBulkUploadStatus('Cancelling...');
    setBulkUploadPaused(false);
  }

  // connectGoogle/disconnectGoogle removed — Google connect/disconnect is owned by
  // GoogleConnectionProvider (the GoogleSidebarItem in the sidebar).

  // Start the OAuth connect for a specific app (profile). Omitting appKey uses
  // the server's default app (single-app setups). Each app maps to one profile:
  // only that profile is a tester on it, so it's the only account that can
  // authorize through it.
  async function connectMeta(appKey?: string) {
    setShowConnectPicker(false);
    setShowAccountDropdown(false);
    if (!requireUnlock(() => connectMeta(appKey))) return;
    try {
      const qs = appKey ? `?app=${encodeURIComponent(appKey)}` : '';
      // Send the Supabase JWT so /auth can stamp meta_user=you BEFORE the OAuth
      // redirect — the just-connected account is then owned by you regardless of
      // whether the pre-connect restore had landed.
      const res = await fetch(`/api/video-reels/meta/auth${qs}`, { cache: 'no-store', headers: await getAuthHeader() });
      if (res.status === 403) { onLocked403(() => connectMeta(appKey)); return; }
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        setMetaError(data.error || 'Failed to connect to Instagram');
      }
    } catch (error) {
      setMetaError('Network error — please try again');
    }
  }

  async function fetchMetaApps() {
    try {
      const res = await fetch('/api/video-reels/meta/apps');
      if (res.ok) {
        const data = await res.json();
        setMetaApps(Array.isArray(data.apps) ? data.apps : []);
      }
    } catch (error) {
      console.error('[Instagram] Failed to fetch apps:', error);
    }
  }

  async function refreshUnlockState() {
    const { configured, unlocked } = await fetchUnlockStatus();
    const locked = configured && !unlocked;
    setMetaLocked(locked);
    metaLockedRef.current = locked;
  }

  // Gate a posting/managing action behind the team password. If locked, opens the
  // prompt and stashes the action to run after a successful unlock; returns false.
  // Reads metaLockedRef (not the state) because a retried action closes over a
  // stale metaLocked and would otherwise re-prompt forever.
  function requireUnlock(action: () => void): boolean {
    if (!metaLockedRef.current) return true;
    pendingActionRef.current = action;
    setUnlockError('');
    setUnlockPassword('');
    setShowUnlockPrompt(true);
    return false;
  }

  // Defensive: any gated route that answers 403 { locked } means our unlock lapsed
  // — surface the prompt so the user can re-enter the password.
  function onLocked403(retry?: () => void) {
    setMetaLocked(true);
    metaLockedRef.current = true;
    if (retry) pendingActionRef.current = retry;
    setUnlockError('');
    setUnlockPassword('');
    setShowUnlockPrompt(true);
  }

  async function handleUnlockSubmit() {
    if (!unlockPassword || unlockPending) return;
    setUnlockPending(true);
    setUnlockError('');
    const ok = await submitUnlock(unlockPassword);
    setUnlockPending(false);
    if (!ok) {
      setUnlockError('Incorrect password.');
      return;
    }
    setMetaLocked(false);
    metaLockedRef.current = false; // sync now so the retried action isn't re-gated
    setShowUnlockPrompt(false);
    setUnlockPassword('');
    const action = pendingActionRef.current;
    pendingActionRef.current = null;
    if (action) action();
  }

  // fetchInstagramUser/fetchAllAccounts removed — igUser/allAccounts come from
  // useInstagramConnection(); call ig.refresh() to re-read them after a switch.

  // Wipe the fetched reels + every row-derived bit of state so switching pages
  // starts from a clean slate (nothing from the previous account lingers or can
  // be posted to the wrong page). The Google Sheet target isn't reset here — the
  // page-config effect already retargets it to the new page's tab.
  function clearWorkspaceForSwitch() {
    setEntries([
      { id: '1', url: '', caption: '', tag: '', instagramCaption: '', change: '', data: null, marketData: null, loading: false, loadingMarket: false, error: '', marketError: '', videoFailed: false },
    ]);
    canvasRefsMap.current.clear();
    uploadQueueRef.current = [];
    extractingIdsRef.current.clear();
    setExtractingIds(new Set());
    setComposeRows(null);
    setComposeRowsError('');
    setCaptionNotice(null);
    setSheetsError('');
    setUploadingEntry(null);
    setZipExport(null);
    setCaptionExtract(null);
  }

  // ----- Sub-view navigation -----
  function goOverview() {
    // Don't leave the posting workflow mid-upload — unmounting it drops the canvas
    // refs the running loop needs, silently stranding the rest of the batch and
    // falsely reporting success. (captionNotice, not metaError: we stay in post.)
    if (bulkUploading || uploadingEntry || entries.some((e) => e.queuePosition !== undefined)) {
      setCaptionNotice('Finish or cancel the current upload before leaving this page.');
      return;
    }
    setMetaError('');
    setSelectedIgUserId(null);
    setBuildOnlyPage(null);
    setView('overview');
  }

  function goAnalytics(igUserId: string) {
    setMetaError('');
    setSelectedIgUserId(igUserId);
    setView('analytics');
  }

  // Post for a page: switch the ACTIVE account (password-gated) then open the
  // posting workflow. Re-picking the already-active page keeps any in-progress grid.
  function goPost(igUserId: string) {
    if (igUser?.id === igUserId) { setMetaError(''); setBuildOnlyPage(null); setSelectedIgUserId(igUserId); setView('post'); return; }
    if (!requireUnlock(() => goPost(igUserId))) return;
    // Never switch mid-upload — clearing the grid would strand the running job.
    // (setMetaError, not setCaptionNotice: the captionNotice only renders inside
    // the post view, but goPost fires from the overview — see the metaError banner.)
    if (bulkUploading || uploadingEntry) {
      setMetaError('Finish or cancel the current upload before switching accounts.');
      return;
    }
    setMetaError('');
    (async () => {
      try {
        const res = await fetch('/api/video-reels/meta/switch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ igUserId }),
        });
        if (res.status === 403) { onLocked403(() => goPost(igUserId)); return; }
        if (!res.ok) { setMetaError('Could not switch to that page. Please try again.'); return; }
        // Confirm the client sees the new account as active BEFORE opening the
        // posting workflow. A transient /me 5xx can leave igUser stale while the
        // server cookie already switched — which would post under the wrong page's
        // branding/sheet. If unconfirmed, stay on the overview and let the user retry.
        const resolved = await ig.refresh();
        if (!resolved || resolved.id !== igUserId) {
          // Don't just say "click Post again" — when the confirm genuinely can't
          // resolve, retrying repeats the same failure. Say what's actually wrong.
          setMetaError(resolved
            ? `Switched, but @${resolved.username} is still the active page — please try again.`
            : 'Switched, but couldn’t load that page — it may be disconnected. Try reconnecting it.');
          return;
        }
        clearWorkspaceForSwitch();   // fresh workspace for the newly-active page
        setBuildOnlyPage(null);
        setSelectedIgUserId(igUserId);
        setView('post');
      } catch {
        setMetaError('Could not switch to that page. Please try again.');
      }
    })();
  }

  // Open the posting workflow for a page that is NOT connected: render + export
  // only. Password-gated like a real switch (it retargets the shared team sheet),
  // and it clears the grid so nothing from the previous page can be exported under
  // this one's branding. No /meta/switch call — there is nothing to switch TO.
  function goBuildOnly(pageKey: string) {
    if (!requireUnlock(() => goBuildOnly(pageKey))) return;
    if (bulkUploading || uploadingEntry) {
      setMetaError('Finish or cancel the current upload before switching pages.');
      return;
    }
    setMetaError('');
    clearWorkspaceForSwitch();
    setBuildOnlyPage(pageKey);
    setSelectedIgUserId(null);
    setView('post');
  }

  // Connect (from an overview Connect prompt or a card's reconnect): gate on the
  // team password, then pick the app (per-page OAuth) or connect the default.
  function handleConnect() {
    if (!requireUnlock(() => handleConnect())) return;
    if (metaApps.length > 1) setShowConnectPicker(true);
    else connectMeta();
  }

  // Process the upload queue (one render+upload at a time)
  async function processUploadQueue() {
    if (isProcessingUploadRef.current || uploadQueueRef.current.length === 0) {
      console.log('[Queue] processUploadQueue skipped - isProcessing:', isProcessingUploadRef.current, 'queueLength:', uploadQueueRef.current.length);
      return;
    }

    isProcessingUploadRef.current = true;
    const entryId = uploadQueueRef.current.shift()!;
    processingEntryIdRef.current = entryId;
    console.log('[Queue] Processing entry:', entryId, 'remaining:', uploadQueueRef.current.length);

    // Update queue positions for remaining items
    updateQueuePositions();

    // Trigger the canvas to start rendering (which will then call upload)
    const canvasRef = canvasRefsMap.current.get(entryId);
    try {
      if (canvasRef?.startUpload) {
        console.log('[Queue] Calling startUpload on canvas for entry:', entryId);
        await canvasRef.startUpload();
        console.log('[Queue] startUpload completed for entry:', entryId);
      } else {
        console.error('[Queue] No canvas ref found for entry:', entryId, 'available refs:', Array.from(canvasRefsMap.current.keys()));
      }
    } catch (error) {
      console.error('[Queue] Error processing entry:', entryId, error);
      // Store error on entry
      setEntries(entries => entries.map(e =>
        e.id === entryId
          ? { ...e, uploadError: error instanceof Error ? error.message : 'Unknown error' }
          : e
      ));
    }

    isProcessingUploadRef.current = false;
    processingEntryIdRef.current = null;

    // Process next in queue if any
    if (uploadQueueRef.current.length > 0) {
      console.log('[Queue] Queue has more items, processing next in 500ms');
      setTimeout(() => processUploadQueue(), 500);
    } else {
      console.log('[Queue] Queue empty, done processing');
    }
  }

  // Update queue positions for display
  function updateQueuePositions() {
    setEntries(entries => entries.map(e => {
      const queueIndex = uploadQueueRef.current.indexOf(e.id);
      if (queueIndex !== -1) {
        return { ...e, queuePosition: queueIndex + 1 };
      } else if (e.id === processingEntryIdRef.current) {
        return { ...e, queuePosition: 0 }; // Currently processing
      } else {
        return { ...e, queuePosition: undefined };
      }
    }));
  }

  // Best-effort: mark a sheet-imported row as "published" (column E) in the
  // connected Google Sheet. Shared by the Instagram publish flow AND the plain
  // Export flow so the sheet stays in sync however a row leaves the queue.
  // Never throws — a sheet-write failure must not fail an export/publish the
  // user already completed. No-ops when the row didn't come from a sheet or
  // Google isn't connected (we can't write the sheet without a token).
  async function markSheetRowPublished(
    sheetRow: number | undefined,
    origin?: { spreadsheetId: string; sheetName: string },
  ) {
    // Publish-status (col E) goes to the row's FROZEN origin tab, not the live
    // active-page sheet — so a page switch mid-export can't mark another page's
    // rows published. Falls back to live inputs for rows with no frozen origin.
    const { spreadsheetId: writeSpreadsheetId, sheetName: writeSheetName } =
      resolveWriteTarget(origin, spreadsheetId, sheetName);
    if (sheetRow === undefined || !googleToken || !writeSpreadsheetId || !writeSheetName) {
      console.log('[Sheets] ⏭️ Skipped sheet update - missing conditions', {
        sheetRow, hasGoogleToken: !!googleToken, spreadsheetId: writeSpreadsheetId, sheetName: writeSheetName,
      });
      return;
    }

    // A bulk export writes column E for every row as fast as renders finish,
    // which can outrun Google's per-user write quota (→ 429) or hit a transient
    // 5xx. Retry those with backoff; surface the real status + body text on
    // give-up (reading .text() means the log is never an unhelpful `{}`).
    const MAX_ATTEMPTS = 4;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const updateRes = await fetch('/api/video-reels/google/sheets/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            spreadsheetId: writeSpreadsheetId,
            sheetName: writeSheetName,
            rowNumber: sheetRow,
            status: 'published',
          }),
        });

        if (updateRes.ok) {
          console.log('[Sheets] ✅ Updated row', sheetRow, 'to "published"');
          return;
        }

        const detail = await updateRes.text().catch(() => '');
        const retriable = updateRes.status === 429 || updateRes.status >= 500;
        if (!retriable || attempt === MAX_ATTEMPTS) {
          console.error(
            `[Sheets] Failed to mark row ${sheetRow} published (HTTP ${updateRes.status})`,
            detail.slice(0, 300),
          );
          return;
        }
      } catch (error) {
        if (attempt === MAX_ATTEMPTS) {
          console.error(`[Sheets] Failed to update sheet status for row ${sheetRow}:`, error);
          return;
        }
      }
      // Exponential backoff (0.6s, 1.2s, 2.4s) with jitter to spread the retries.
      const delay = 600 * 2 ** (attempt - 1) + Math.floor(Math.random() * 250);
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  async function processSingleUpload(entryId: string, blob: Blob, filename: string) {
    // Read fresh state (this runs after a multi-minute render; the render-closure
    // `entries` would be stale for caption / sheetRow / published status).
    const entry = entriesRef.current.find(e => e.id === entryId);
    if (!entry) return;
    // Never re-publish something that already went out.
    if (entry.instagramPermalink || entry.data?.publishedMediaId) {
      console.log('[Upload] Skipping — entry already published:', entryId);
      return;
    }

    // Deterministic idempotency key (entry id + source url) so a retry — including
    // the "publish succeeded but the HTTP response was lost" case, or a retry after
    // the user edited the caption — reuses the same key and the server
    // short-circuits to the cached result instead of posting a second Reel.
    const idempotencyKey = buildPublishIdempotencyKey(entryId, entry.url);

    // Clear any previous error when starting a new upload
    setEntries(entries => entries.map(e =>
      e.id === entryId
        ? { ...e, uploadError: undefined }
        : e
    ));

    setUploadingEntry(entryId);
    setUploadStatus('Uploading video...');
    setUploadProgress(10);

    // Tracked so we can clean up the blob if a later step (publish) fails —
    // otherwise a failed attempt leaves an orphaned public video in blob storage.
    let uploadedBlobUrl: string | null = null;

    try {
      // Upload to Vercel Blob (direct from browser, bypasses Vercel serverless limits)
      setUploadProgress(20);

      // Add random suffix to filename to avoid "blob already exists" errors
      const nameWithoutExt = filename.replace(/\.[^/.]+$/, '');
      const ext = filename.substring(filename.lastIndexOf('.'));
      const uniqueFilename = `${nameWithoutExt}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;

      const uploadedBlob = await upload(uniqueFilename, blob, {
        access: 'public',
        handleUploadUrl: '/api/video-reels/upload',
      });
      uploadedBlobUrl = uploadedBlob.url;

      setUploadProgress(70);
      setUploadStatus('Publishing to Instagram...');

      // Publish to Instagram using the Vercel Blob URL
      const publishRes = await fetch('/api/video-reels/meta/reels/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoUrl: uploadedBlob.url,
          caption: entry.instagramCaption || entry.caption || '',
          shareToFeed: false,
          idempotencyKey,
        }),
      });

      if (!publishRes.ok) {
        const error = await publishRes.json();
        if (publishRes.status === 403 && error?.locked) {
          onLocked403();
          throw new Error(error.error || 'Enter the team password to publish.');
        }
        if (error.diagnostic) {
          console.error('[Publish Diagnostic]', error.diagnostic);
        }
        const diagSummary = error.diagnostic
          ? ` | diagnostic: ${JSON.stringify(error.diagnostic)}`
          : '';
        throw new Error((error.error || 'Failed to publish to Instagram') + diagSummary);
      }

      const publishData = await publishRes.json();
      setUploadProgress(100);
      setUploadStatus('Published successfully!');

      // Update entry with published info (including permalink)
      setEntries(entries => entries.map(e =>
        e.id === entryId
          ? {
              ...e,
              data: { ...e.data!, publishedMediaId: publishData.mediaId },
              instagramPermalink: publishData.permalink ?? undefined
            }
          : e
      ));

      // Mark the originating sheet row as "published" (best-effort, shared with
      // the Export flow). Runs after a successful publish; never throws.
      await markSheetRowPublished(entry.sheetRow, entry.sheetOrigin);

      // Delete the Vercel Blob after successful Instagram upload to free up storage
      if (uploadedBlob.url) {
        try {
          console.log('[Blob Delete] Cleaning up blob:', uploadedBlob.url);
          await fetch('/api/video-reels/storage/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: uploadedBlob.url }),
          });
          console.log('[Blob Delete] ✅ Blob cleaned up successfully');
        } catch (error) {
          console.error('[Blob Delete] Failed to clean up blob:', error);
          // Don't fail the upload if blob deletion fails
        }
      }

      // Clear uploading state (but keep the success message briefly)
      setTimeout(() => {
        setUploadingEntry(null);
        setUploadProgress(0);
      }, 2000);

    } catch (error) {
      // Store error persistently in the entry
      const errorMessage = errText(error, 'Unknown error');
      setEntries(entries => entries.map(e =>
        e.id === entryId
          ? { ...e, uploadError: errorMessage }
          : e
      ));

      // Clean up the orphaned blob if we uploaded one but failed to publish it.
      if (uploadedBlobUrl) {
        try {
          await fetch('/api/video-reels/storage/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: uploadedBlobUrl }),
          });
          console.log('[Blob Delete] Cleaned up orphaned blob after failed publish');
        } catch (e) {
          console.error('[Blob Delete] Failed to clean up orphaned blob:', e);
        }
      }

      // Clear uploading state but keep the error
      setUploadingEntry(null);
      setUploadProgress(0);
      setUploadStatus('');
    }
  }

  function dismissEntryError(entryId: string) {
    setEntries(entries => entries.map(e =>
      e.id === entryId
        ? { ...e, uploadError: undefined }
        : e
    ));
  }

  // Called when user clicks "Upload Reel" - adds to queue BEFORE rendering
  function handleUploadRequest(entryId: string) {
    console.log('[Queue] handleUploadRequest called for entry:', entryId);

    // Build-only mode has no token for THIS page; the cookie points elsewhere, so
    // a publish here would post to the wrong account. The button is hidden too —
    // this is the load-bearing check.
    if (buildOnlyPage) {
      setCaptionNotice('This page is not connected — export the video and upload it manually.');
      return;
    }

    // Publishing needs the team password — prompt before we render/upload.
    if (!requireUnlock(() => handleUploadRequest(entryId))) return;

    // Never run the single-upload queue concurrently with a bulk upload — they
    // drive the same canvases and would race.
    if (bulkUploading) {
      console.log('[Queue] Skipping — a bulk upload is in progress');
      return;
    }

    // Dedupe: never enqueue something that's already published, already queued,
    // or currently being processed. Read fresh state from entriesRef.
    const entry = entriesRef.current.find(e => e.id === entryId);
    if (entry?.instagramPermalink || entry?.data?.publishedMediaId) {
      console.log('[Queue] Skipping — entry already published:', entryId);
      return;
    }
    if (uploadQueueRef.current.includes(entryId) || processingEntryIdRef.current === entryId) {
      console.log('[Queue] Skipping — entry already queued/processing:', entryId);
      return;
    }

    // Add to queue
    uploadQueueRef.current.push(entryId);
    console.log('[Queue] Queue now has:', uploadQueueRef.current.length, 'items');

    // Update queue positions
    updateQueuePositions();

    // Show queued status if already processing
    if (isProcessingUploadRef.current) {
      const queuePosition = uploadQueueRef.current.length;
      setUploadStatus(`Queued (${queuePosition} in line)...`);
    }

    // Start processing if not already processing
    if (!isProcessingUploadRef.current) {
      console.log('[Queue] Starting queue processing');
      processUploadQueue();
    }
  }

  // Called by TikTokCanvas AFTER rendering completes - uploads the blob
  async function handleUploadToInstagram(entryId: string, blob: Blob, filename: string) {
    console.log('[Queue] handleUploadToInstagram called for entry:', entryId, 'blob size:', blob.size);
    // Same guard as handleUploadRequest — this is the canvas's post-render callback
    // and must never publish an unconnected page's reel to the active account.
    if (buildOnlyPage) {
      setCaptionNotice('This page is not connected — export the video and upload it manually.');
      return;
    }
    // Clear queue position for this entry
    setEntries(entries => entries.map(e =>
      e.id === entryId ? { ...e, queuePosition: undefined } : e
    ));

    // Upload the already-rendered video
    await processSingleUpload(entryId, blob, filename);
    console.log('[Queue] handleUploadToInstagram completed for entry:', entryId);
  }

  // disconnectMeta removed — disconnect is owned by the sidebar InstagramSidebarItem
  // (useInstagramConnection().disconnect).

  async function handleExportComplete(entryId: string, blob: Blob, filename: string) {
    const entry = entriesRef.current.find(e => e.id === entryId);

    if (!igUser || !googleToken) {
      // Fallback to a plain local download when Instagram/Google isn't connected.
      const url = URL.createObjectURL(blob);
      Object.assign(document.createElement('a'), {
        href: url,
        download: filename,
      }).click();
      URL.revokeObjectURL(url);
      // Exporting a row marks it "published" too — keep the sheet in sync.
      // (No-ops here unless Google is connected, since we can't write otherwise.)
      await markSheetRowPublished(entry?.sheetRow, entry?.sheetOrigin);
      return;
    }

    // Never re-publish something that already went out (parity with the
    // Blob-upload path's guard). The sheet is still kept in sync.
    if (entry?.instagramPermalink || entry?.data?.publishedMediaId) {
      console.log('[Export] Skipping — entry already published:', entryId);
      await markSheetRowPublished(entry?.sheetRow, entry?.sheetOrigin);
      return;
    }

    setUploadingEntry(entryId);
    setUploadProgress(0);
    setUploadStatus('Uploading to Drive...');

    try {
      // Step 1: Upload to Google Drive
      const formData = new FormData();
      formData.append('file', blob);
      // No token sent — storage/upload reads the Google token server-side from the cookie.

      setUploadProgress(20);
      setUploadStatus('Uploading to Google Drive...');

      const uploadRes = await fetch('/api/video-reels/storage/upload', {
        method: 'POST',
        body: formData,
      });

      if (!uploadRes.ok) {
        const uploadData = await uploadRes.json();
        throw new Error(uploadData.error || 'Failed to upload to Drive');
      }

      const uploadData = await uploadRes.json();
      const videoUrl = uploadData.downloadUrl;

      setUploadProgress(50);
      setUploadStatus('Publishing to Instagram...');

      // Step 2: Publish to Instagram (same entry-id+url idempotency key as the
      // Vercel-Blob path, so the two paths dedupe against each other too).
      const caption = entry?.caption || '';
      const idempotencyKey = buildPublishIdempotencyKey(entryId, entry?.url);
      const publishRes = await fetch('/api/video-reels/meta/reels/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoUrl,
          caption,
          shareToFeed: true,
          idempotencyKey,
        }),
      });

      if (!publishRes.ok) {
        const publishData = await publishRes.json();
        if (publishRes.status === 403 && publishData?.locked) {
          onLocked403();
          throw new Error(publishData.error || 'Enter the team password to publish.');
        }
        throw new Error(publishData.error || 'Failed to publish to Instagram');
      }

      // Record published info so the re-publish guard fires and dedup works —
      // parity with the Blob-upload path (previously this path recorded neither,
      // so the same row could be published again).
      const publishData = await publishRes.json();
      setEntries(entries => entries.map(e =>
        e.id === entryId
          ? {
              ...e,
              data: e.data ? { ...e.data, publishedMediaId: publishData.mediaId } : e.data,
              instagramPermalink: publishData.permalink ?? undefined,
            }
          : e
      ));

      // Mark the originating sheet row as "published" (best-effort) before the
      // final status flip, so it isn't clobbered by an in-flight sheet write.
      await markSheetRowPublished(entry?.sheetRow, entry?.sheetOrigin);

      setUploadProgress(100);
      setUploadStatus('✓ Uploaded to Instagram!');

      // Clear status after 3 seconds
      setTimeout(() => {
        setUploadStatus('');
        setUploadingEntry(null);
        setUploadProgress(0);
      }, 3000);
    } catch (error) {
      console.error('Upload error:', error);
      setUploadStatus(`Error: ${errText(error, 'Upload failed')}`);
      // Keep error visible for 3 seconds
      setTimeout(() => {
        setUploadStatus('');
        setUploadingEntry(null);
        setUploadProgress(0);
      }, 3000);
    }
  }

  // Fetch available sheet names from Google Sheets
  const fetchSheetNames = useCallback(async (id: string) => {
    if (!id.trim()) {
      setAvailableSheets([]);
      return;
    }

    setLoadingSheetNames(true);

    try {
      const res = await fetch(`/api/video-reels/google/sheets/metadata?spreadsheet_id=${encodeURIComponent(id.trim())}`);

      if (res.ok) {
        const data = await res.json();
        setAvailableSheets(data.sheets || []);

        // Auto-select the first sheet if current selection is not in the list
        if (data.sheets && data.sheets.length > 0) {
          const currentExists = data.sheets.some((s: { title: string }) => s.title === sheetName);
          if (!currentExists) {
            setSheetName(data.sheets[0].title);
          }
        }
      } else {
        // If metadata fetch fails, just clear available sheets
        setAvailableSheets([]);
      }
    } catch (error) {
      console.error('[Sheets] Failed to fetch sheet names:', error);
      setAvailableSheets([]);
    } finally {
      setLoadingSheetNames(false);
    }
  }, []); // Empty deps - we'll handle state updates carefully

  // Debounced fetch for sheet names
  const sheetNameFetchTimeout = useRef<NodeJS.Timeout | null>(null);
  const debouncedFetchSheetNames = useCallback((id: string) => {
    if (sheetNameFetchTimeout.current) {
      clearTimeout(sheetNameFetchTimeout.current);
    }
    sheetNameFetchTimeout.current = setTimeout(() => {
      fetchSheetNames(id);
    }, 500); // 500ms debounce
  }, []);

  async function importFromSheets() {
    if (!googleToken || !spreadsheetId.trim()) {
      setSheetsError('Please provide a spreadsheet ID');
      return;
    }

    setLoadingSheets(true);
    setSheetsError('');

    try {
      const res = await fetch(
        `/api/video-reels/google/sheets?spreadsheet_id=${encodeURIComponent(spreadsheetId.trim())}&start_row=${startRow}&end_row=${endRow}&sheet_name=${encodeURIComponent(sheetName.trim())}`
      );

      const data = await res.json();

      if (!res.ok) {
        setSheetsError(data.error || 'Failed to fetch spreadsheet data');
        setLoadingSheets(false);
        return;
      }

      // Freeze the sheet/tab these rows were imported from (captured now) onto
      // each entry, so later writes always target this tab — not whatever page is
      // active when the write fires.
      const originSpreadsheetId = spreadsheetId.trim();
      const originSheetName = sheetName.trim();
      // Create new entries from the imported data
      const newEntries = data.rows.map((row: ImportedSheetRow) => ({
        id: Date.now().toString() + Math.random().toString(36).substring(2, 11),
        url: row.url,
        caption: row.caption,
        tag: row.tag || '',
        instagramCaption: (row.instagramCaption || '').slice(0, 2199),
        change: row.change || '',
        data: null,
        marketData: null,
        loading: false,
        loadingMarket: false,
        error: '',
        marketError: '',
        videoFailed: false,
        sheetRow: row.sheetRow, // Store the actual spreadsheet row number
        // Freeze the origin tab so this row's writes can't be redirected to
        // another page's sheet by a mid-batch page switch.
        sheetOrigin: { spreadsheetId: originSpreadsheetId, sheetName: originSheetName },
      }));

      // Replace current entries with imported ones
      setEntries(newEntries.length > 0 ? newEntries : [
        { id: '1', url: '', caption: '', tag: '', instagramCaption: '', data: null, marketData: null, loading: false, loadingMarket: false, error: '', marketError: '', videoFailed: false }
      ]);

      setShowSheetsModal(false);
    } catch (error) {
      setSheetsError('Network error — please try again');
    } finally {
      setLoadingSheets(false);
    }
  }

  // Generate AI captions into column D for each row in the range, using the
  // topic in column F. Each row is still its own serverless call (with its own
  // grounded Google Search); a small concurrency pool keeps several in flight,
  // and transient failures (rate limit, timeout, network) retry with backoff so
  // a long range completes without leaving holes.
  async function generateCaptionsFromSheets() {
    if (!googleToken || !spreadsheetId.trim()) {
      setGenerateError('Please provide a spreadsheet ID');
      return;
    }

    const start = parseInt(startRow, 10);
    const end = parseInt(endRow, 10);
    if (isNaN(start) || isNaN(end) || start < 1 || end < start) {
      setGenerateError('Please provide a valid row range');
      return;
    }

    setGeneratingCaptions(true);
    setGenerateError('');

    const total = end - start + 1;
    let done = 0;
    let generated = 0;
    let skipped = 0;
    let alreadyHad = 0;
    const failures: Array<{ row: number; error: string }> = [];
    const keyCounts: Record<number, number> = {};

    // Coerce any error shape to a string. Server / platform errors can come back
    // as an object (e.g. Vercel's { code, id, message } envelope on a timeout);
    // rendering one of those directly would crash React, so always stringify.
    const toErrorText = (err: unknown, fallback: string): string => {
      if (typeof err === 'string' && err.trim()) return err;
      if (err && typeof err === 'object') {
        const o = err as { message?: unknown; code?: unknown };
        if (typeof o.message === 'string' && o.message) return o.message;
        if (typeof o.code === 'string' && o.code) return o.code;
        try { return JSON.stringify(err); } catch { /* fall through */ }
      }
      return fallback;
    };

    // Live per-row log. Maintained in a local array and mirrored to state after
    // each change so the modal streams updates as rows complete. With rows in
    // flight concurrently, entries are patched by row (not "last appended").
    const log: GenLogEntry[] = [];
    setGenerateLog([]);
    const logIndexByRow = new Map<number, number>();
    const startRowLog = (row: number) => {
      logIndexByRow.set(row, log.length);
      log.push({ row, status: 'generating' });
      setGenerateLog([...log]);
    };
    const patchRowLog = (row: number, patch: Partial<GenLogEntry>) => {
      const i = logIndexByRow.get(row);
      if (i === undefined) return;
      log[i] = { ...log[i], ...patch };
      setGenerateLog([...log]);
    };

    // Free-tier Gemini quota is ~10 requests/min per key; with the key pool
    // spread server-side, 6 concurrent grounded calls (each taking ~10s) stays
    // inside the aggregate limit while finishing ~6x faster than sequential.
    const CONCURRENCY = 6;
    const MAX_ATTEMPTS = 3;
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    const processRow = async (row: number) => {
      startRowLog(row);
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        let failMsg = '';
        let retriable = false;
        let rateLimited = false;
        try {
          const res = await fetch('/api/video-reels/google/sheets/generate-caption', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              spreadsheetId: spreadsheetId.trim(),
              sheetName: sheetName.trim(),
              rowNumber: row,
              style: captionStyle,
            }),
          });
          const data: GenerateCaptionResponse = await res.json().catch(() => ({}));
          if (res.ok) {
            if (data.skipped) {
              if (data.reason === 'exists') {
                alreadyHad++;
                patchRowLog(row, { status: 'skipped', detail: 'already had caption' });
              } else {
                skipped++;
                patchRowLog(row, { status: 'skipped', detail: 'no topic' });
              }
            } else {
              generated++;
              if (data.keyUsed) keyCounts[data.keyUsed] = (keyCounts[data.keyUsed] || 0) + 1;
              patchRowLog(row, { status: 'done', keyUsed: data.keyUsed });
            }
            return;
          }
          failMsg = toErrorText(data?.error, `HTTP ${res.status}`);
          // 429 = the whole Gemini key pool (or the Sheets API) is rate limited
          // — retriable, but only after the per-minute quota window rolls over.
          // 5xx covers model overload and serverless timeouts; a quick retry is
          // enough. 401/403/400 are permanent for this run, so fail fast.
          rateLimited = res.status === 429;
          retriable = rateLimited || res.status >= 500;
        } catch (error) {
          failMsg = errText(error, 'Network error');
          retriable = true;
        }
        if (!retriable || attempt === MAX_ATTEMPTS) {
          console.error('[Generate] Row', row, 'failed:', failMsg);
          failures.push({ row, error: failMsg });
          patchRowLog(row, { status: 'failed', detail: failMsg });
          return;
        }
        // Rate limits need to outlast the 60s RPM window (~20s, then ~40s);
        // transient 5xx/network errors only need a short exponential backoff.
        const delayMs = rateLimited
          ? 20000 * attempt + Math.random() * 5000
          : 2000 * 2 ** (attempt - 1) + Math.random() * 1000;
        patchRowLog(row, {
          status: 'generating',
          detail: `retrying (${attempt + 1}/${MAX_ATTEMPTS}) — ${failMsg}`,
        });
        await sleep(delayMs);
      }
    };

    const rows: number[] = [];
    for (let row = start; row <= end; row++) rows.push(row);
    // Reset the banner immediately so a re-run doesn't keep showing the
    // previous run's "Done —" summary while the first rows are in flight.
    setGenerateProgress(`Generating… 0/${total} rows finished`);
    let nextIndex = 0;
    const workers = Array.from({ length: Math.min(CONCURRENCY, rows.length) }, async () => {
      while (nextIndex < rows.length) {
        const row = rows[nextIndex++];
        await processRow(row);
        done++;
        setGenerateProgress(`Generating… ${done}/${total} rows finished`);
      }
    });
    await Promise.all(workers);

    setGeneratingCaptions(false);
    const parts = [`${generated} generated`];
    if (skipped) parts.push(`${skipped} skipped (no topic)`);
    if (alreadyHad) parts.push(`${alreadyHad} skipped (already had caption)`);
    let summary = `Done — ${parts.join(', ')}`;
    const keyParts = Object.keys(keyCounts)
      .sort()
      .map(k => `key #${k}: ${keyCounts[Number(k)]}`);
    if (keyParts.length) summary += ` [${keyParts.join(', ')}]`;
    if (failures.length) {
      const rows = failures.map(f => f.row).join(', ');
      // Show the first failure message so the user knows *why* (token expired,
      // gemini error, etc.) instead of just the row number.
      summary += `, ${failures.length} failed (rows ${rows}). Reason: ${failures[0].error}`;
    }
    setGenerateProgress(summary);
  }

  // One-shot: strip noise (HTML entities, hashtags, @handles, emoji, promo
  // CTAs) from existing column-F prompts across the row range. Batch read/write.
  async function cleanPromptsFromSheets() {
    if (!googleToken || !spreadsheetId.trim()) {
      setGenerateError('Please provide a spreadsheet ID');
      return;
    }
    const start = parseInt(startRow, 10);
    const end = parseInt(endRow, 10);
    if (isNaN(start) || isNaN(end) || start < 1 || end < start) {
      setGenerateError('Please provide a valid row range');
      return;
    }

    setCleaningPrompts(true);
    setGenerateError('');
    setGenerateLog([]);
    setGenerateProgress(`Cleaning column F for rows ${start}–${end}…`);
    try {
      const res = await fetch('/api/video-reels/google/sheets/clean-prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          spreadsheetId: spreadsheetId.trim(),
          sheetName: sheetName.trim(),
          startRow: start,
          endRow: end,
        }),
      });
      const data: CleanPromptsResponse = await res.json().catch(() => ({}));
      if (!res.ok) {
        setGenerateProgress(`Clean failed — ${data?.error || `HTTP ${res.status}`}`);
      } else {
        setGenerateProgress(
          `Done — cleaned ${data.changed} of ${data.total} column-F prompt(s)` +
          (data.preserved ? `, ${data.preserved} all-noise cell(s) left untouched.` : '.')
        );
      }
    } catch (e) {
      setGenerateProgress(`Clean failed — ${errText(e, 'network error')}`);
    } finally {
      setCleaningPrompts(false);
    }
  }

  // Sheet-driven sibling of generateCaptionsFromSheets: for each row in the
  // range, the server reads the video URL from column A, writes the on-video
  // overlay caption into column B (title, via ffmpeg frames + Gemini vision)
  // and the source post's description into column F (the AI-caption prompt).
  // Column B is PREPENDED to and skipped entirely when locked with {…}; column
  // F is only filled when empty. Same worker-pool + retry/backoff shape.
  // mode: 'title' = overlay caption → column B only (video + vision, slow),
  // 'prompt' = source description → column F only (no vision, fast),
  // 'both' = the original combined pass.
  async function extractTitlesPromptsFromSheets(mode: 'both' | 'title' | 'prompt' = 'both') {
    if (!googleToken || !spreadsheetId.trim()) {
      setGenerateError('Please provide a spreadsheet ID');
      return;
    }

    const start = parseInt(startRow, 10);
    const end = parseInt(endRow, 10);
    if (isNaN(start) || isNaN(end) || start < 1 || end < start) {
      setGenerateError('Please provide a valid row range');
      return;
    }

    setExtractingSheet(mode);
    setGenerateError('');

    const total = end - start + 1;
    let done = 0;
    let titles = 0;
    let prompts = 0;
    let noOverlay = 0;
    let skippedRows = 0;
    const failures: Array<{ row: number; error: string }> = [];
    const keyCounts: Record<number, number> = {};

    const toErrorText = (err: unknown, fallback: string): string => {
      if (typeof err === 'string' && err.trim()) return err;
      if (err && typeof err === 'object') {
        const o = err as { message?: unknown; code?: unknown };
        if (typeof o.message === 'string' && o.message) return o.message;
        if (typeof o.code === 'string' && o.code) return o.code;
        try { return JSON.stringify(err); } catch { /* fall through */ }
      }
      return fallback;
    };

    const log: GenLogEntry[] = [];
    setGenerateLog([]);
    const logIndexByRow = new Map<number, number>();
    const startRowLog = (row: number) => {
      logIndexByRow.set(row, log.length);
      log.push({ row, status: 'generating' });
      setGenerateLog([...log]);
    };
    const patchRowLog = (row: number, patch: Partial<GenLogEntry>) => {
      const i = logIndexByRow.get(row);
      if (i === undefined) return;
      log[i] = { ...log[i], ...patch };
      setGenerateLog([...log]);
    };

    // Each row is heavy server-side (video download + ffmpeg + vision call),
    // so keep fewer in flight than the text-only caption generator.
    const CONCURRENCY = 3;
    const MAX_ATTEMPTS = 3;
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    const processRow = async (row: number) => {
      startRowLog(row);
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        let failMsg = '';
        let retriable = false;
        let rateLimited = false;
        try {
          const res = await fetch('/api/video-reels/google/sheets/extract-title-prompt', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              spreadsheetId: spreadsheetId.trim(),
              sheetName: sheetName.trim(),
              rowNumber: row,
              mode,
            }),
          });
          const data: ExtractTitlePromptResponse = await res.json().catch(() => ({}));
          if (res.ok) {
            if (data.skipped) {
              skippedRows++;
              const filled = mode === 'title' ? 'title' : mode === 'prompt' ? 'prompt' : 'title + prompt';
              patchRowLog(row, {
                status: 'skipped',
                detail: data.reason === 'no-url'
                  ? 'no video URL'
                  : data.reason === 'locked'
                    ? 'column B locked with {…}'
                    : `${filled} already filled`,
              });
            } else {
              if (data.wroteTitle) titles++;
              if (data.wroteTopic) prompts++;
              if (!data.wroteTitle && data.caption === null) noOverlay++;
              if (data.keyUsed) keyCounts[data.keyUsed] = (keyCounts[data.keyUsed] || 0) + 1;
              const wrote = [
                data.wroteTitle ? (data.prependedTitle ? 'title prepended → B' : 'title → B') : null,
                data.wroteTopic ? 'prompt → F' : null,
              ].filter(Boolean).join(' + ');
              patchRowLog(row, {
                status: 'done',
                keyUsed: data.keyUsed,
                detail: wrote || (data.caption === null ? 'no overlay caption found' : 'nothing to write'),
              });
            }
            return;
          }
          failMsg = toErrorText(data?.error, `HTTP ${res.status}`);
          rateLimited = res.status === 429;
          retriable = rateLimited || res.status >= 500;
        } catch (error) {
          failMsg = errText(error, 'Network error');
          retriable = true;
        }
        if (!retriable || attempt === MAX_ATTEMPTS) {
          console.error('[Extract Title/Prompt] Row', row, 'failed:', failMsg);
          failures.push({ row, error: failMsg });
          patchRowLog(row, { status: 'failed', detail: failMsg });
          return;
        }
        const delayMs = rateLimited
          ? 20000 * attempt + Math.random() * 5000
          : 2000 * 2 ** (attempt - 1) + Math.random() * 1000;
        patchRowLog(row, {
          status: 'generating',
          detail: `retrying (${attempt + 1}/${MAX_ATTEMPTS}) — ${failMsg}`,
        });
        await sleep(delayMs);
      }
    };

    const rows: number[] = [];
    for (let row = start; row <= end; row++) rows.push(row);
    setGenerateProgress(`Extracting… 0/${total} rows finished`);
    let nextIndex = 0;
    const workers = Array.from({ length: Math.min(CONCURRENCY, rows.length) }, async () => {
      while (nextIndex < rows.length) {
        const row = rows[nextIndex++];
        await processRow(row);
        done++;
        setGenerateProgress(`Extracting… ${done}/${total} rows finished`);
      }
    });
    await Promise.all(workers);

    setExtractingSheet(null);
    const parts: string[] = [];
    if (mode !== 'prompt') parts.push(`${titles} title(s) → B`);
    if (mode !== 'title') parts.push(`${prompts} prompt(s) → F`);
    if (noOverlay && mode !== 'prompt') parts.push(`${noOverlay} had no overlay caption`);
    if (skippedRows) parts.push(`${skippedRows} skipped`);
    let summary = `Done — ${parts.join(', ')}`;
    const keyParts = Object.keys(keyCounts)
      .sort()
      .map(k => `key #${k}: ${keyCounts[Number(k)]}`);
    if (keyParts.length) summary += ` [${keyParts.join(', ')}]`;
    if (failures.length) {
      const rows2 = failures.map(f => f.row).join(', ');
      summary += `, ${failures.length} failed (rows ${rows2}). Reason: ${failures[0].error}`;
    }
    setGenerateProgress(summary);
  }

  // Any sheet-wide job in flight — force-opens the row log so progress stays
  // visible while it runs, regardless of the user's collapse preference.
  const sheetJobRunning = generatingCaptions || !!extractingSheet || cleaningPrompts;

  return (
    <div className="min-h-screen flex flex-col items-center px-6 pt-12 pb-24" style={GRID_BG_STYLE}>
      {/* Team password gate — shown when a posting/managing action is attempted while locked. */}
      {showUnlockPrompt && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
          onClick={() => { setShowUnlockPrompt(false); pendingActionRef.current = null; }}
        >
          <div
            className="w-full max-w-sm rounded-lg border border-separator bg-surface-1 p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-body font-semibold text-label">Team password required</h3>
            <p className="mt-1 text-caption text-label-tertiary">
              Enter the shared password to post to or manage the Instagram accounts.
            </p>
            <form onSubmit={(e) => { e.preventDefault(); handleUnlockSubmit(); }}>
              <input
                type="password"
                autoFocus
                value={unlockPassword}
                onChange={(e) => { setUnlockPassword(e.target.value); setUnlockError(''); }}
                placeholder="Password"
                className="mt-3 w-full rounded-md border border-separator bg-surface-2 px-3 py-2 text-body text-label outline-none focus:border-tint"
              />
              {unlockError && <p className="mt-1.5 text-caption-sm text-danger">{unlockError}</p>}
              <div className="mt-4 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => { setShowUnlockPrompt(false); pendingActionRef.current = null; }}
                  className="rounded-md px-3 py-1.5 text-caption font-medium text-label-secondary hover:text-label transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!unlockPassword || unlockPending}
                  className="rounded-md bg-tint px-3 py-1.5 text-caption font-medium text-white disabled:opacity-40"
                >
                  {unlockPending ? 'Checking…' : 'Unlock'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Header */}
      {/* Connect-a-profile picker (per-app OAuth) — opened from an overview Connect prompt. */}
      {showConnectPicker && metaApps.length > 1 && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4" onClick={() => setShowConnectPicker(false)}>
          <div className="w-full max-w-sm rounded-xl bg-surface-1 border border-separator p-4" onClick={(e) => e.stopPropagation()}>
            <div className="text-body-sm font-semibold text-label mb-3">Connect a profile</div>
            <div className="flex flex-col gap-1">
              {metaApps.map((app) => (
                <button
                  key={app.key}
                  onClick={() => connectMeta(app.key)}
                  className="w-full text-left px-3 py-2 rounded-md text-body-sm text-label-secondary hover:text-label hover:bg-surface-2 transition-colors"
                >
                  {app.label}
                </button>
              ))}
            </div>
            <button onClick={() => setShowConnectPicker(false)} className="mt-3 text-caption-sm text-label-tertiary hover:text-label transition-colors">Cancel</button>
          </div>
        </div>
      )}

      {metaError && (
        <div className="w-full max-w-6xl mb-4 text-caption-sm text-danger truncate" title={toMsg(metaError)}>
          {toMsg(metaError)}
        </div>
      )}

      {/* Build-only mode is visually distinct on purpose: the workspace looks
          identical to a real posting session, and the one thing that differs
          (publishing is impossible) has to be unmissable. */}
      {buildOnlyPage && view === 'post' && (
        <div className="w-full max-w-6xl mb-4 rounded-lg border border-separator bg-surface-2 px-4 py-3">
          <div className="text-caption font-medium text-label">
            Export only — {getPageConfig(buildOnlyPage).label} is not connected
          </div>
          <div className="text-caption-sm text-label-tertiary mt-0.5">
            Overlay and sheet tab are set for this page, so exports are correct. Posting to
            Instagram is disabled here: your active Instagram session belongs to a different
            account, and publishing would post to that one instead. Export the videos and
            upload them by hand.
          </div>
        </div>
      )}

      {view === 'overview' && (
        <VideoReelsOverview onViewMore={goAnalytics} onPost={goPost} onConnect={handleConnect} onBuildOnly={goBuildOnly} />
      )}

      {view === 'analytics' && selectedIgUserId && (
        <AccountAnalyticsView
          igUserId={selectedIgUserId}
          label={allAccounts.find((a) => a.igUserId === selectedIgUserId)?.igUsername || selectedIgUserId}
          onBack={goOverview}
          onReconnect={handleConnect}
        />
      )}

      {view === 'post' && (
        <>
          {/* Post toolbar */}
          <div className="mb-8 w-full max-w-6xl flex flex-wrap items-center gap-3">
            <button
              onClick={goOverview}
              disabled={bulkUploading || !!uploadingEntry}
              title={bulkUploading || uploadingEntry ? 'Finish or cancel the current upload first' : undefined}
              className="h-8 px-3 inline-flex items-center gap-1.5 rounded-md bg-surface-2 border border-separator text-caption font-medium text-label-secondary hover:text-label hover:border-label-quaternary transition-colors ease-out disabled:opacity-40 disabled:cursor-not-allowed"
            >
              ← Back
            </button>
            {igUser && <span className="text-body-sm font-medium text-label truncate">@{igUser.username}</span>}
            {/* Only rendered when the page has more than one look, so the three
                single-template pages keep the toolbar they had. */}
            {getPageTemplates(buildOnlyPage ?? igUser?.username).length > 1 && (
              <div className="flex gap-1 rounded-lg bg-surface-2 p-1" role="group" aria-label="Template">
                {getPageTemplates(buildOnlyPage ?? igUser?.username).map((t) => (
                  <button
                    key={t.id}
                    onClick={() => selectTemplate(t.id)}
                    aria-pressed={templateId === t.id}
                    title={t.label}
                    className={`h-6 px-2.5 rounded-md text-caption-sm font-medium transition-colors ease-out ${
                      templateId === t.id
                        ? 'bg-surface text-label shadow-sm'
                        : 'text-label-tertiary hover:text-label-secondary'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            )}
            <div className="flex-1" />
            {googleToken && (
              <>
                <button
                  onClick={() => setShowSheetsModal(true)}
                  className="h-8 px-3 inline-flex items-center rounded-md bg-surface-2 border border-separator text-caption font-medium text-label-secondary hover:text-label hover:border-label-quaternary transition-colors ease-out"
                >
                  Import from Sheets
                </button>
                <button
                  onClick={() => { setGenerateError(''); setGenerateProgress(''); setShowGenerateModal(true); }}
                  className="h-8 px-3 inline-flex items-center rounded-md bg-surface-2 border border-separator text-caption font-medium text-label-secondary hover:text-label hover:border-label-quaternary transition-colors ease-out"
                >
                  Generate AI Caption
                </button>
              </>
            )}
            <button
              onClick={resetEverything}
              className="h-8 px-3 inline-flex items-center rounded-md text-caption font-medium text-label-tertiary hover:text-danger hover:bg-surface-2 transition-colors ease-out"
            >
              Reset All
            </button>
          </div>

      {/* Video Table */}
      <div className="w-full max-w-6xl">
        <div className="rounded-xl bg-surface-1 border border-separator overflow-hidden">
          {/* Table header toolbar */}
          <div className="border-b border-separator px-4 py-3 flex items-center justify-between">
            <button
              onClick={addRow}
              className="h-8 px-3 inline-flex items-center gap-1.5 rounded-md bg-surface-2 border border-separator text-caption font-medium text-label-secondary hover:text-label hover:border-label-quaternary transition-colors ease-out"
            >
              <span className="text-base leading-none">+</span>
              Add Row
            </button>
            <button
              onClick={fetchAllVideos}
              disabled={entries.every(e => !e.url.trim() || e.data || e.loading)}
              className="h-8 px-4 inline-flex items-center rounded-md bg-accent text-on-accent text-caption font-medium hover:bg-accent-hover active:bg-accent-pressed transition-colors ease-out disabled:bg-surface-2 disabled:text-label-quaternary disabled:cursor-not-allowed"
            >
              Fetch All Videos
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-separator">
                  <th className="px-3 py-3 text-center text-caption-sm font-medium text-label-tertiary w-12">
                    #
                  </th>
                  <th className="px-4 py-3 text-left text-caption-sm font-medium text-label-tertiary">
                    Video URL
                  </th>
                  <th className="px-4 py-3 text-left text-caption-sm font-medium text-label-tertiary">
                    Caption
                  </th>
                  <th className="px-4 py-3 text-left text-caption-sm font-medium text-label-tertiary">
                    Event ID
                  </th>
                  <th className="px-4 py-3 text-left text-caption-sm font-medium text-label-tertiary">
                    Instagram Caption
                  </th>
                  <th className="px-4 py-3 text-center text-caption-sm font-medium text-label-tertiary w-32">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry, index) => (
                  <tr key={entry.id} className="border-b border-separator-subtle last:border-b-0">
                    <td className="px-3 py-3 text-center">
                      <span className="text-body-sm text-label-tertiary tabular-nums">{index + 1}</span>
                    </td>
                    <td className="px-4 py-3">
                      <input
                        type="url"
                        value={entry.url}
                        onChange={e => updateEntry(entry.id, 'url', e.target.value)}
                        onKeyDown={e => {
                          if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
                            e.preventDefault();
                          }
                        }}
                        placeholder="Paste TikTok URL..."
                        className="w-full rounded-md bg-surface border border-separator px-3 py-2 text-body-sm text-label placeholder:text-label-tertiary outline-none focus:border-tint transition-colors ease-out"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <textarea
                        value={entry.caption}
                        onChange={e => updateEntry(entry.id, 'caption', e.target.value)}
                        onKeyDown={e => {
                          if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
                            e.preventDefault();
                          }
                        }}
                        placeholder="Caption (required)..."
                        rows={2}
                        title="Edits apply to the rendered video immediately — including after fetching."
                        className="w-full min-h-[60px] resize-none rounded-md bg-surface border border-separator px-3 py-2 text-body-sm text-label placeholder:text-label-tertiary outline-none focus:border-tint transition-colors ease-out"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <input
                        type="text"
                        value={entry.tag}
                        onChange={e => updateEntry(entry.id, 'tag', e.target.value)}
                        onKeyDown={e => {
                          if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
                            e.preventDefault();
                          }
                        }}
                        disabled={entry.loading}
                        placeholder="Tag (e.g., film)..."
                        className="w-full rounded-md bg-surface border border-separator px-3 py-2 text-body-sm text-label placeholder:text-label-tertiary outline-none focus:border-tint transition-colors ease-out disabled:opacity-40 disabled:cursor-not-allowed"
                      />
                      {entry.marketError && (
                        <p className="mt-1 text-caption-sm text-danger" role="alert">{toMsg(entry.marketError)}</p>
                      )}
                      {entry.marketData && typeof entry.marketData.title === 'string' && (
                        <p className="mt-1 text-caption-sm text-success">✓ {entry.marketData.title}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <textarea
                        value={entry.instagramCaption}
                        onChange={e => updateEntry(entry.id, 'instagramCaption', e.target.value)}
                        maxLength={2199}
                        onKeyDown={e => {
                          if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
                            e.preventDefault();
                          }
                        }}
                        placeholder="Instagram caption..."
                        rows={2}
                        className="w-full min-h-[60px] resize-none rounded-md bg-surface border border-separator px-3 py-2 text-body-sm text-label placeholder:text-label-tertiary outline-none focus:border-tint transition-colors ease-out"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => fetchVideo(entry.id)}
                          disabled={entry.loading || !entry.url.trim() || (!!entry.data && !entry.videoFailed)}
                          className="h-8 px-3 inline-flex items-center rounded-md bg-surface-2 border border-separator text-caption font-medium text-label-secondary hover:text-label hover:border-label-quaternary transition-colors ease-out disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          {entry.videoFailed ? 'Retry' : entry.data ? '✓ Fetched' : entry.loading ? '...' : 'Fetch'}
                        </button>
                        {entries.length > 1 && (
                          <button
                            onClick={() => removeRow(entry.id)}
                            className="h-8 w-8 inline-flex items-center justify-center rounded-md text-label-quaternary hover:text-danger hover:bg-surface-2 transition-colors ease-out"
                            aria-label="Remove row"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Show errors */}
        {entries.some(e => e.error) && (
          <div className="mt-4 space-y-2">
            {entries.map(entry => entry.error && (
              <div key={entry.id} role="alert" className="flex items-start gap-3 bg-danger/10 border border-danger/40 text-danger text-body-sm rounded-xl px-4 py-3">
                <strong>Row {entries.indexOf(entry) + 1}:</strong> {toMsg(entry.error)}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Render all canvases for fetched videos in a grid */}
      {entries.filter(e => e.data && !e.loading && !(e.data.images && e.data.images.length > 0)).length > 0 && (
        <div className="w-full max-w-[1800px] mt-8">
          {/* Bulk Upload Progress Bar */}
          {bulkUploading && (
            <div className="mb-4 mx-auto max-w-xl">
              <div className="rounded-xl bg-surface-1 border border-separator px-4 py-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-caption-sm font-medium text-label-secondary" aria-live="polite">
                    {bulkUploadStatus || `Uploading ${bulkUploadCompleted} of ${bulkUploadTotal}...`}
                  </span>
                  <span className="text-caption-sm text-label-tertiary tabular-nums">{bulkUploadProgress}%</span>
                </div>
                <div className="h-1 bg-surface-2 rounded-full overflow-hidden mb-3" role="progressbar" aria-valuenow={bulkUploadProgress} aria-valuemin={0} aria-valuemax={100}>
                  <div
                    className="h-full bg-tint transition-all ease-out"
                    style={{ width: `${bulkUploadProgress}%` }}
                  />
                </div>
                <div className="flex items-center justify-center gap-2">
                  {bulkUploadPaused ? (
                    <button
                      onClick={toggleBulkUploadPause}
                      className="h-8 px-3 inline-flex items-center gap-1.5 rounded-md bg-surface-2 border border-separator text-caption font-medium text-label-secondary hover:text-label hover:border-label-quaternary transition-colors ease-out"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                        <polygon points="5 3 19 12 5 21 5 3"/>
                      </svg>
                      Resume
                    </button>
                  ) : (
                    <button
                      onClick={toggleBulkUploadPause}
                      className="h-8 px-3 inline-flex items-center gap-1.5 rounded-md bg-surface-2 border border-separator text-caption font-medium text-label-secondary hover:text-label hover:border-label-quaternary transition-colors ease-out"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                        <rect x="6" y="4" width="4" height="16"/>
                        <rect x="14" y="4" width="4" height="16"/>
                      </svg>
                      Pause
                    </button>
                  )}
                  <button
                    onClick={cancelBulkUpload}
                    className="h-8 px-3 inline-flex items-center gap-1.5 rounded-md text-caption font-medium text-danger hover:bg-danger/10 active:bg-danger/15 transition-colors ease-out"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="18" y1="6" x2="6" y2="18"/>
                      <line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Debug toggles — to isolate IG container ERROR causes */}
          <div className="flex flex-col items-center gap-1.5 mb-3">
            <label className="flex items-center gap-2 text-caption-sm text-label-tertiary cursor-pointer select-none">
              <input
                type="checkbox"
                checked={stripAudio}
                onChange={(e) => setStripAudio(e.target.checked)}
                className="h-3.5 w-3.5 cursor-pointer"
              />
              Strip audio (debug — test IG copyright rejection)
            </label>
            <label className="flex items-center gap-2 text-caption-sm text-label-tertiary cursor-pointer select-none">
              <input
                type="checkbox"
                checked={lowBitrate}
                onChange={(e) => setLowBitrate(e.target.checked)}
                className="h-3.5 w-3.5 cursor-pointer"
              />
              Low bitrate (fallback — ~1.5 Mbps video, small file)
            </label>
          </div>

          {/* Download/Upload All Buttons */}
          <div className="flex justify-center gap-3 mb-4">
            <button
              onClick={downloadAll}
              disabled={bulkUploading || zipExport !== null}
              className="h-10 px-4 inline-flex items-center gap-2 rounded-md bg-surface-2 border border-separator text-caption font-medium text-label-secondary hover:text-label hover:border-label-quaternary transition-colors ease-out disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              {zipExport ? `Exporting ${Math.min(zipExport.done + 1, zipExport.total)}/${zipExport.total}…` : 'Export All (ZIP)'}
            </button>
            <button
              onClick={extractAllCaptions}
              disabled={captionExtract !== null || extractingIds.size > 0 || zipExport !== null || bulkUploading}
              title="Read the overlay caption from each fetched video (Gemini vision) and PREPEND it to column B. Rows whose column B is wrapped in {…} are skipped. The source description goes into column F when that's empty. Running this twice prepends twice."
              className="h-10 px-4 inline-flex items-center gap-2 rounded-md bg-surface-2 border border-separator text-caption font-medium text-label-secondary hover:text-label hover:border-label-quaternary transition-colors ease-out disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 7V5a2 2 0 0 1 2-2h2"/>
                <path d="M17 3h2a2 2 0 0 1 2 2v2"/>
                <path d="M21 17v2a2 2 0 0 1-2 2h-2"/>
                <path d="M7 21H5a2 2 0 0 1-2-2v-2"/>
                <line x1="8" y1="10" x2="16" y2="10"/>
                <line x1="8" y1="14" x2="13" y2="14"/>
              </svg>
              {captionExtract ? `Reading ${Math.min(captionExtract.done + 1, captionExtract.total)}/${captionExtract.total}…` : 'Extract Captions'}
            </button>
            {igUser && googleToken && !buildOnlyPage && (
              <button
                onClick={uploadAllToInstagram}
                disabled={bulkUploading || zipExport !== null || uploadingEntry !== null || entries.some(e => e.queuePosition !== undefined)}
                className="h-10 px-4 inline-flex items-center gap-2 rounded-md bg-accent text-on-accent text-caption font-medium hover:bg-accent-hover active:bg-accent-pressed transition-colors ease-out disabled:bg-surface-2 disabled:text-label-quaternary disabled:cursor-not-allowed"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2v16M12 2l-4 4M12 2l4 4"/>
                  <path d="M2 12h4M2 12l4-4M2 12l4 4"/>
                  <path d="M22 12h-4M22 12l-4-4M22 12l4 4"/>
                </svg>
                {bulkUploading ? 'Uploading...' : 'Upload All to Instagram'}
              </button>
            )}
          </div>

          {zipNotice && (
            <p className="text-center text-caption text-danger mb-4">{zipNotice}</p>
          )}
          {captionNotice && (
            <p className="text-center text-caption text-label-secondary mb-4">{captionNotice}</p>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2">
            {entries.filter(e => e.data && !e.loading && !(e.data.images && e.data.images.length > 0)).map((entry) => {
              return (
                <div key={entry.id} className="flex flex-col">
                  <div className="flex items-center justify-between px-2 py-1 mb-1">
                    <span className="text-caption-sm font-medium text-label-tertiary tabular-nums">
                      Row {entry.sheetRow !== undefined ? entry.sheetRow : '?'}
                    </span>
                    <button
                      onClick={async () => {
                        const result = await extractCaptionForEntry(entry, 0);
                        const label = entry.sheetRow !== undefined ? `Row ${entry.sheetRow}` : 'Video';
                        const targetTab = entry.sheetOrigin?.sheetName || sheetName.trim();
                        const wroteSheet = entry.sheetRow !== undefined && googleToken && (entry.sheetOrigin?.spreadsheetId || spreadsheetId.trim());
                        setCaptionNotice(
                          result === 'ok'
                            ? `${label}: caption extracted${wroteSheet ? ` → prepended into ${targetTab}!B${entry.sheetRow}` : ' (no sheet row to write to)'}.`
                            : result === 'ok-sheet-failed'
                              ? `${label}: caption extracted, but writing it to the sheet FAILED — see console.`
                              : result === 'none'
                                ? `${label}: no overlay caption detected in this video.`
                                : result === 'locked'
                                  ? `${label}: skipped — column B is locked with {…}.`
                                  : `${label}: caption extraction failed — see console.`
                        );
                      }}
                      disabled={extractingIds.has(entry.id) || captionExtract !== null}
                      title="Read the overlay caption from this video and prepend it to the current caption + column B. Skipped when column B is wrapped in {…}."
                      className="h-6 px-2 inline-flex items-center rounded-md text-caption-sm font-medium text-label-tertiary hover:text-label hover:bg-surface-2 transition-colors ease-out disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {extractingIds.has(entry.id) ? 'Reading…' : 'Read caption'}
                    </button>
                  </div>
                  <TikTokCanvas
                    ref={(ref) => {
                      if (ref) {
                        canvasRefsMap.current.set(entry.id, ref);
                      } else {
                        canvasRefsMap.current.delete(entry.id);
                      }
                    }}
                    videoSrc={proxyStreamUrl(entry.data!.hdplay || entry.data!.play || entry.data!.wmplay)}
                    videoId={entry.data!.id}
                    entryId={entry.id}
                    rowNumber={entry.sheetRow !== undefined ? entry.sheetRow - 1 : 0}
                    queuePosition={entry.queuePosition}
                    onVideoError={() => handleVideoError(entry.id)}
                    onVideoRecovered={() => handleVideoRecovered(entry.id)}
                    onAudioLost={(lost) => setEntries(prev => prev.map(e => e.id === entry.id ? { ...e, audioWarning: lost || undefined } : e))}
                    onRefetchSrc={() => refetchEntrySrc(entry.id)}
                    onExportComplete={(blob, filename) => handleExportComplete(entry.id, blob, filename)}
                    onUploadToInstagram={(blob, filename) => handleUploadToInstagram(entry.id, blob, filename)}
                    onUploadRequest={() => handleUploadRequest(entry.id)}
                    igConnected={!!igUser && !buildOnlyPage}
                    uploadState={
                      entry.instagramPermalink || entry.data?.publishedMediaId
                        ? 'published'
                        : uploadingEntry === entry.id || entry.queuePosition === 0
                          ? 'uploading'
                          : (entry.queuePosition !== undefined && entry.queuePosition > 0) || bulkUploading
                            ? 'queued'
                            : 'idle'
                    }
                    brand={brandMode}
                    stripAudio={stripAudio}
                    lowBitrate={lowBitrate}
                    overlayLogoSrc={overlay.logoSrc}
                    overlayDisplayName={overlay.displayName}
                    overlayHandle={overlay.handle}
                    overlayChange={entry.change}
                    overlayCaption={captionForDisplay(entry.caption)}
                    tag={entry.tag}
                    marketData={entry.marketData}
                  />

                  {/* Upload status for this entry */}
                  {uploadingEntry === entry.id && (
                    <div className="mt-3 rounded-xl bg-surface-1 border border-separator px-3 py-2">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-caption-sm font-medium text-label-secondary" aria-live="polite">{uploadStatus}</span>
                        <span className="text-caption-sm text-label-tertiary tabular-nums">{uploadProgress}%</span>
                      </div>
                      <div className="h-1 bg-surface-2 rounded-full overflow-hidden" role="progressbar" aria-valuenow={uploadProgress} aria-valuemin={0} aria-valuemax={100}>
                        <div
                          className="h-full bg-tint transition-all ease-out"
                          style={{ width: `${uploadProgress}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Loud silent-audio warning: the export "succeeded" but the
                      file has no sound — for a reel that's a publishable defect,
                      so it must not hide in the console. */}
                  {entry.audioWarning && (
                    <div role="alert" className="mt-3 rounded-xl bg-warning/10 border border-warning/40 px-3 py-2">
                      <p className="text-caption-sm font-medium text-warning">Exported without audio</p>
                      <p className="text-caption-sm text-label-tertiary mt-1">The source video has audio, but it couldn&apos;t be read — the exported file is silent. Check it before posting.</p>
                    </div>
                  )}

                  {/* Persistent upload error with dismiss button */}
                  {entry.uploadError && (
                    <div role="alert" className="mt-3 rounded-xl bg-danger/10 border border-danger/40 px-3 py-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-2 flex-1">
                          <svg className="text-danger mt-0.5 flex-shrink-0" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="12" r="10"/>
                            <line x1="12" y1="8" x2="12" y2="12"/>
                            <line x1="12" y1="16" x2="12.01" y2="16"/>
                          </svg>
                          <div className="flex-1">
                            <p className="text-caption-sm font-medium text-danger">Upload failed</p>
                            <p className="text-caption-sm text-danger/70 mt-1">{toMsg(entry.uploadError)}</p>
                            {toMsg(entry.uploadError).toLowerCase().includes('auth') && (
                              <p className="text-caption-sm text-label-tertiary mt-1">Please reconnect your Instagram account and try again.</p>
                            )}
                          </div>
                        </div>
                        <button
                          onClick={() => dismissEntryError(entry.id)}
                          className="flex-shrink-0 text-label-quaternary hover:text-label-secondary transition-colors"
                          aria-label="Dismiss error"
                          title="Dismiss error"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <line x1="18" y1="6" x2="6" y2="18"/>
                            <line x1="6" y1="6" x2="18" y2="18"/>
                          </svg>
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Instagram permalink (shown after successful publish) */}
                  {entry.instagramPermalink && (
                    <div className="mt-3 rounded-xl bg-surface-1 border border-separator px-3 py-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <svg className="text-success" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M12 2C6.477 2 2 6.477 2 12c0 4.991 3.657 9.128 8.438 9.879V14.89h-2.54V12h2.54V9.797c0-2.506 1.492-3.89 3.777-3.89 1.094 0 2.238.195 2.238.195v2.46h-1.26c-1.243 0-1.63.771-1.63 1.562V12h2.773l-.443 2.89h-2.33v6.989C18.343 21.129 22 16.99 22 12c0-5.523-4.477-10-10-10z"/>
                          </svg>
                          <span className="text-caption-sm font-medium text-success">Published to Instagram</span>
                        </div>
                        <a
                          href={entry.instagramPermalink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-caption-sm font-medium text-tint hover:text-tint-hover transition-colors ease-out"
                        >
                          View
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                            <polyline points="15 3 21 3 21 9"></polyline>
                            <line x1="10" y1="14" x2="21" y2="3"></line>
                          </svg>
                        </a>
                      </div>
                    </div>
                  )}

                  <button
                    onClick={() => removeRow(entry.id)}
                    className="mt-4 h-8 inline-flex items-center justify-center gap-2 rounded-md text-caption font-medium text-danger hover:bg-danger/10 active:bg-danger/15 transition-colors ease-out"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6"/>
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                      <line x1="10" y1="11" x2="10" y2="17"/>
                      <line x1="14" y1="11" x2="14" y2="17"/>
                    </svg>
                    Delete
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <p className="mt-8 text-caption-sm text-label-quaternary text-center max-w-sm">
        For personal use only. Respect TikTok&apos;s terms of service and content creators&apos; rights.
      </p>

      {/* Google Sheets Import Modal */}
      {showSheetsModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-surface-1/95 backdrop-blur-xl rounded-2xl shadow-lg border border-separator p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-title3 text-label">Import from Google Sheets</h2>
              <button
                onClick={() => setShowSheetsModal(false)}
                className="text-label-tertiary hover:text-label transition-colors"
                aria-label="Close"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"/>
                  <line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>

            <div className="space-y-4">
              {SHOW_SHEET_OVERRIDE && (
              <div>
                <label className="block text-label text-label-secondary mb-2">
                  Spreadsheet ID
                </label>
                <input
                  type="text"
                  value={spreadsheetId}
                  onChange={e => setSpreadsheetId(e.target.value)}
                  placeholder="From URL: /d/SPREADSHEET_ID/edit"
                  className="w-full rounded-md bg-surface border border-separator px-3 py-2 text-body-sm text-label placeholder:text-label-tertiary outline-none focus:border-tint transition-colors ease-out"
                />
                <p className="mt-1 text-caption-sm text-label-tertiary">
                  Find the ID in your sheet URL: /d/ID/edit
                </p>
              </div>
              )}

              {SHOW_SHEET_OVERRIDE && (
              <div>
                <label className="block text-label text-label-secondary mb-2">
                  Sheet Name
                </label>
                {availableSheets.length > 0 ? (
                  <div className="relative">
                    <select
                      value={sheetName}
                      onChange={e => setSheetName(e.target.value)}
                      disabled={loadingSheetNames}
                      className="w-full rounded-md bg-surface border border-separator px-3 py-2 text-body-sm text-label placeholder:text-label-tertiary outline-none focus:border-tint transition-colors ease-out disabled:opacity-40"
                    >
                      {availableSheets.map(sheet => (
                        <option key={sheet.id} value={sheet.title}>
                          {sheet.title}
                        </option>
                      ))}
                    </select>
                    {loadingSheetNames && (
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-caption-sm text-label-tertiary">
                        Loading...
                      </span>
                    )}
                  </div>
                ) : (
                  <input
                    type="text"
                    value={sheetName}
                    onChange={e => {
                      setSheetName(e.target.value);
                      // Clear available sheets if user types manually
                      if (availableSheets.length > 0 && spreadsheetId) {
                        debouncedFetchSheetNames(spreadsheetId);
                      }
                    }}
                    placeholder="SonotradeHQ"
                    className="w-full rounded-md bg-surface border border-separator px-3 py-2 text-body-sm text-label placeholder:text-label-tertiary outline-none focus:border-tint transition-colors ease-out"
                  />
                )}
                <p className="mt-1 text-caption-sm text-label-tertiary">
                  {availableSheets.length > 0
                    ? `${availableSheets.length} sheet${availableSheets.length !== 1 ? 's' : ''} available`
                    : 'Enter spreadsheet ID above to load sheets'
                  }
                </p>
              </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-label text-label-secondary mb-2">
                    Start Row
                  </label>
                  <input
                    type="number"
                    value={startRow}
                    onChange={e => setStartRow(e.target.value)}
                    min="1"
                    className="w-full rounded-md bg-surface border border-separator px-3 py-2 text-body-sm text-label placeholder:text-label-tertiary outline-none focus:border-tint transition-colors ease-out"
                  />
                </div>
                <div>
                  <label className="block text-label text-label-secondary mb-2">
                    End Row
                  </label>
                  <input
                    type="number"
                    value={endRow}
                    onChange={e => setEndRow(e.target.value)}
                    min="1"
                    className="w-full rounded-md bg-surface border border-separator px-3 py-2 text-body-sm text-label placeholder:text-label-tertiary outline-none focus:border-tint transition-colors ease-out"
                  />
                </div>
              </div>

              <div className="bg-surface-2 rounded-md px-3 py-2 text-caption-sm text-label-tertiary">
                <p className="font-medium text-label-secondary mb-1">Expected format:</p>
                <p>• Column A: TikTok/Instagram URL</p>
                <p>• Column B: Caption</p>
                <p>• Column C: Tag (e.g., &quot;film&quot;)</p>
              </div>

              {sheetsError && (
                <div role="alert" className="flex items-start gap-2 text-caption-sm text-danger bg-danger/10 border border-danger/40 rounded-md px-3 py-2">
                  {toMsg(sheetsError)}
                </div>
              )}

              <button
                onClick={importFromSheets}
                disabled={loadingSheets || !spreadsheetId.trim()}
                className="w-full h-10 inline-flex items-center justify-center rounded-md bg-accent text-on-accent text-caption font-medium hover:bg-accent-hover active:bg-accent-pressed transition-colors ease-out disabled:bg-surface-2 disabled:text-label-quaternary disabled:cursor-not-allowed"
              >
                {loadingSheets ? 'Importing...' : 'Import Rows'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI Caption Generation Modal */}
      {showGenerateModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-surface-1/95 backdrop-blur-xl rounded-2xl shadow-lg border border-separator p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-title3 text-label">Generate AI Captions</h2>
              <button
                onClick={() => setShowGenerateModal(false)}
                disabled={generatingCaptions}
                className="text-label-tertiary hover:text-label transition-colors disabled:opacity-40"
                aria-label="Close"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"/>
                  <line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>

            <div className="space-y-4">
              {SHOW_SHEET_OVERRIDE && (
              <div>
                <label className="block text-label text-label-secondary mb-2">
                  Spreadsheet ID
                </label>
                <input
                  type="text"
                  value={spreadsheetId}
                  onChange={e => setSpreadsheetId(e.target.value)}
                  placeholder="From URL: /d/SPREADSHEET_ID/edit"
                  className="w-full rounded-md bg-surface border border-separator px-3 py-2 text-body-sm text-label placeholder:text-label-tertiary outline-none focus:border-tint transition-colors ease-out"
                />
              </div>
              )}

              {SHOW_SHEET_OVERRIDE && (
              <div>
                <label className="block text-label text-label-secondary mb-2">
                  Sheet Name
                </label>
                {availableSheets.length > 0 ? (
                  <select
                    value={sheetName}
                    onChange={e => setSheetName(e.target.value)}
                    disabled={loadingSheetNames}
                    className="w-full rounded-md bg-surface border border-separator px-3 py-2 text-body-sm text-label placeholder:text-label-tertiary outline-none focus:border-tint transition-colors ease-out disabled:opacity-40"
                  >
                    {availableSheets.map(sheet => (
                      <option key={sheet.id} value={sheet.title}>
                        {sheet.title}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={sheetName}
                    onChange={e => setSheetName(e.target.value)}
                    placeholder="SonotradeHQ"
                    className="w-full rounded-md bg-surface border border-separator px-3 py-2 text-body-sm text-label placeholder:text-label-tertiary outline-none focus:border-tint transition-colors ease-out"
                  />
                )}
              </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-label text-label-secondary mb-2">
                    Start Row
                  </label>
                  <input
                    type="number"
                    value={startRow}
                    onChange={e => setStartRow(e.target.value)}
                    min="1"
                    className="w-full rounded-md bg-surface border border-separator px-3 py-2 text-body-sm text-label placeholder:text-label-tertiary outline-none focus:border-tint transition-colors ease-out"
                  />
                </div>
                <div>
                  <label className="block text-label text-label-secondary mb-2">
                    End Row
                  </label>
                  <input
                    type="number"
                    value={endRow}
                    onChange={e => setEndRow(e.target.value)}
                    min="1"
                    className="w-full rounded-md bg-surface border border-separator px-3 py-2 text-body-sm text-label placeholder:text-label-tertiary outline-none focus:border-tint transition-colors ease-out"
                  />
                </div>
              </div>

              {/* One action group at a time — the sheet settings above are shared. */}
              <div className="flex gap-1 rounded-lg bg-surface-2 p-1">
                {([['generate', 'Generate'], ['extract', 'Extract'], ['compose', 'Compose']] as const).map(([id, label]) => (
                  <button
                    key={id}
                    onClick={() => setSheetTab(id)}
                    aria-pressed={sheetTab === id}
                    className={`flex-1 h-8 rounded-md text-caption font-medium transition-colors ease-out ${
                      sheetTab === id
                        ? 'bg-surface text-label shadow-sm'
                        : 'text-label-tertiary hover:text-label-secondary'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {sheetTab === 'generate' && (
                <>
                  {/* Prompt style — Search: keyword-optimised for IG search. Story: the
                      narrative creator format ("In [year]…", ends "music content"). */}
                  <div className="flex gap-1 rounded-lg bg-surface-2 p-1">
                    {([['search', 'Search'], ['story', 'Story']] as const).map(([id, label]) => (
                      <button
                        key={id}
                        onClick={() => setCaptionStyle(id)}
                        aria-pressed={captionStyle === id}
                        className={`flex-1 h-8 rounded-md text-caption font-medium transition-colors ease-out ${
                          captionStyle === id
                            ? 'bg-surface text-label shadow-sm'
                            : 'text-label-tertiary hover:text-label-secondary'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={generateCaptionsFromSheets}
                    disabled={generatingCaptions || !!extractingSheet || cleaningPrompts || !spreadsheetId.trim()}
                    className="w-full h-10 inline-flex items-center justify-center rounded-md bg-accent text-on-accent text-caption font-medium hover:bg-accent-hover active:bg-accent-pressed transition-colors ease-out disabled:bg-surface-2 disabled:text-label-quaternary disabled:cursor-not-allowed"
                  >
                    {generatingCaptions ? 'Generating…' : 'Generate Captions'}
                  </button>
                  <p className="text-caption-sm text-label-tertiary">
                    Reads the topic from <span className="text-label-secondary">column F</span> and writes a Gemini caption (web search on) into <span className="text-label-secondary">column D</span>. Skips rows with an empty F or a filled D.
                    {captionStyle === 'story' && (
                      <> Story style writes the narrative &quot;In [year]…&quot; format — one paragraph, 2000–2100 chars, ending with &quot;music content&quot;.</>
                    )}
                  </p>
                </>
              )}

              {sheetTab === 'extract' && (
                <>
                  <button
                    onClick={() => extractTitlesPromptsFromSheets('both')}
                    disabled={!!extractingSheet || generatingCaptions || cleaningPrompts || !spreadsheetId.trim()}
                    title="Titles AND prompts in one pass — each video is downloaded once, prepending the overlay caption into column B and filling column F when it's empty. Faster than running the two separately."
                    className="w-full h-10 inline-flex items-center justify-center rounded-md bg-accent text-on-accent text-caption font-medium hover:bg-accent-hover active:bg-accent-pressed transition-colors ease-out disabled:bg-surface-2 disabled:text-label-quaternary disabled:cursor-not-allowed"
                  >
                    {extractingSheet === 'both' ? 'Extracting titles + prompts…' : 'Do All (Titles + Prompts)'}
                  </button>
                  <button
                    onClick={() => extractTitlesPromptsFromSheets('title')}
                    disabled={!!extractingSheet || generatingCaptions || cleaningPrompts || !spreadsheetId.trim()}
                    className="w-full h-10 inline-flex items-center justify-center rounded-md bg-surface-2 border border-separator text-caption font-medium text-label-secondary hover:text-label hover:border-label-quaternary transition-colors ease-out disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {extractingSheet === 'title' ? 'Extracting titles…' : 'Extract Titles (column B)'}
                  </button>
                  <button
                    onClick={() => extractTitlesPromptsFromSheets('prompt')}
                    disabled={!!extractingSheet || generatingCaptions || cleaningPrompts || !spreadsheetId.trim()}
                    className="w-full h-10 inline-flex items-center justify-center rounded-md bg-surface-2 border border-separator text-caption font-medium text-label-secondary hover:text-label hover:border-label-quaternary transition-colors ease-out disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {extractingSheet === 'prompt' ? 'Extracting prompts…' : 'Extract Prompts (column F)'}
                  </button>
                  <p className="text-caption-sm text-label-tertiary">
                    Reads each video from <span className="text-label-secondary">column A</span>. The overlay caption is <span className="text-label-secondary">prepended</span> to column B — rows whose B is wrapped in <span className="text-label-secondary">{'{…}'}</span> are skipped entirely. The source description fills column F only when it&rsquo;s empty. Running a titles pass twice prepends twice.
                  </p>
                  <button
                    onClick={cleanPromptsFromSheets}
                    disabled={cleaningPrompts || generatingCaptions || !!extractingSheet || !spreadsheetId.trim()}
                    className="w-full h-10 inline-flex items-center justify-center rounded-md bg-surface-2 border border-separator text-caption font-medium text-label-secondary hover:text-label hover:border-label-quaternary transition-colors ease-out disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {cleaningPrompts ? 'Cleaning…' : 'Clean Prompts (column F)'}
                  </button>
                  <p className="text-caption-sm text-label-tertiary">
                    Reads each row&apos;s video from <span className="text-label-secondary">column A</span>. Titles → <span className="text-label-secondary">B</span> (Gemini vision); prompts → <span className="text-label-secondary">F</span> (the post&apos;s description — no vision, much faster). <span className="text-label-secondary">Do All</span> fills both in one pass, downloading each video once. Empty cells only — never overwrites. Clean is separate: it rewrites existing F prompts to strip noise.
                  </p>
                </>
              )}

              {sheetTab === 'compose' && (
                <>
                  <div className="flex items-center justify-between">
                    <p className="text-caption-sm text-label-tertiary pr-2">
                      Pick a row to compose its on-video caption from the video + top comments — no fetch needed.
                    </p>
                    <button
                      onClick={loadComposeRows}
                      disabled={loadingComposeRows || generatingCaptions || !!extractingSheet || cleaningPrompts || !spreadsheetId.trim() || !sheetName.trim()}
                      className="h-7 px-2.5 shrink-0 inline-flex items-center rounded-md bg-surface-2 border border-separator text-caption-sm font-medium text-label-secondary hover:text-label hover:border-label-quaternary transition-colors ease-out disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {loadingComposeRows ? 'Loading…' : composeRows ? 'Reload rows' : 'Load rows'}
                    </button>
                  </div>
                  {composeRowsError && (
                    <div role="alert" className="text-caption-sm text-danger bg-danger/10 border border-danger/40 rounded-md px-3 py-2">
                      {toMsg(composeRowsError)}
                    </div>
                  )}
                  {composeRows && composeRows.length === 0 && !composeRowsError && (
                    <p className="text-caption-sm text-label-tertiary">No rows found in this range.</p>
                  )}
                  {composeRows && composeRows.length > 0 && (
                    <ul className="max-h-64 overflow-y-auto flex flex-col gap-1">
                      {composeRows.map((r) => (
                        <li key={r.sheetRow} className="flex items-center gap-2 rounded-md bg-surface border border-separator px-2 py-1.5">
                          <span className="w-14 shrink-0 text-caption-sm text-label-tertiary tabular-nums">Row {r.sheetRow}</span>
                          <span className="flex-1 min-w-0 truncate text-caption-sm text-label-secondary" title={r.url || 'no URL in column A'}>
                            {r.caption.trim() ? r.caption : <span className="text-label-quaternary">{r.url || 'no URL'}</span>}
                          </span>
                          <button
                            onClick={() => openComposerForRow(r)}
                            disabled={!r.url}
                            title={r.url ? "Compose this row's overlay caption" : 'This row has no URL in column A'}
                            className="h-6 px-2 shrink-0 rounded-md text-caption-sm font-medium text-accent hover:bg-surface-2 disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            Compose
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}

              {generateError && (
                <div role="alert" className="flex items-start gap-2 text-caption-sm text-danger bg-danger/10 border border-danger/40 rounded-md px-3 py-2">
                  {toMsg(generateError)}
                </div>
              )}

              {generateProgress && (
                <div aria-live="polite" className="rounded-md bg-surface-2 border border-separator px-3 py-2 text-caption-sm text-label-secondary">
                  {generateProgress}
                </div>
              )}

              {generateLog.length > 0 && (
                <div>
                  <div className="mb-1 flex items-center gap-3">
                    <button
                      onClick={() => setLogOpen((o) => !o)}
                      aria-expanded={logOpen || sheetJobRunning}
                      className="inline-flex items-center gap-1 text-caption-sm font-medium text-label-tertiary hover:text-label-secondary transition-colors ease-out"
                    >
                      <span>{logOpen || sheetJobRunning ? '▾' : '▸'}</span>
                      Log ({generateLog.length} row{generateLog.length === 1 ? '' : 's'})
                    </button>
                    <button
                      onClick={() => void copyGenerateLog()}
                      title="Copy the full run log to the clipboard"
                      className="text-caption-sm font-medium text-accent hover:opacity-80 transition-opacity"
                    >
                      {logCopied ? 'Copied ✓' : 'Copy log'}
                    </button>
                  </div>
                  {(logOpen || sheetJobRunning) && (
                    <div
                      ref={generateLogRef}
                      className="max-h-48 overflow-y-auto rounded-md border border-separator bg-surface px-3 py-2 text-caption-sm font-mono space-y-0.5"
                    >
                      {generateLog.map((e, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <span className="w-16 shrink-0 text-label-tertiary tabular-nums">Row {e.row}</span>
                          {e.status === 'generating' && (
                            <span className="truncate text-label-secondary">⏳ {e.detail || 'generating…'}</span>
                          )}
                          {e.status === 'done' && (
                            <span className="truncate text-success">
                              ✓ {e.detail || 'generated'}{e.keyUsed !== undefined ? ` · key #${e.keyUsed}` : ''}
                            </span>
                          )}
                          {e.status === 'skipped' && (
                            <span className="text-label-tertiary">⏭ skipped — {e.detail}</span>
                          )}
                          {e.status === 'failed' && (
                            <span className="truncate text-danger">✕ {e.detail}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {composerEntry && (
        <CaptionComposer
          key={composerEntry.id}
          open={!!composerEntry}
          onClose={() => setComposerEntry(null)}
          rowLabel={composerEntry.sheetRow !== undefined ? `Row ${composerEntry.sheetRow}` : 'Video'}
          initialVideoUrl={pickBestVideoUrl(composerEntry.data)}
          sourceUrl={composerEntry.url}
          extractedCaption={composerEntry.caption}
          writesSheet={composerEntry.sheetRow !== undefined && !!googleToken && !!(composerEntry.composeTarget?.spreadsheetId || spreadsheetId.trim())}
          onConfirm={(caption) => { void confirmComposedCaption(composerEntry, caption); }}
        />
      )}
        </>
      )}
    </div>
  );
}

