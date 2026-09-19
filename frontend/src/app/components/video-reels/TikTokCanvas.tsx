'use client';

import { useRef, useEffect, useState, forwardRef, useImperativeHandle } from 'react';
import { sampleVideoFrames } from '@/lib/video-reels/frame-sampler';
import { stickerLayout, stickerVariant, feedforceStickerSrc, FEEDFORCE_TAGLINE, FEEDFORCE_CTA, FEEDFORCE_BAND_RESERVE } from '@/lib/video-reels/feedforce-sticker';

// @ts-expect-error - mp4box doesn't have proper types
import MP4Box from 'mp4box';

// Type-only (erased at build time — the runtime import stays the dynamic one
// inside startRecording) so the export's audio plumbing isn't typed as `any`.
import type {
  AudioSample as MbAudioSample,
  EncodedPacket as MbEncodedPacket,
  AudioSampleSource as MbAudioSampleSource,
  EncodedAudioPacketSource as MbEncodedAudioPacketSource,
  Input as MbInput,
} from 'mediabunny';

// The slices of mp4box.js's untyped shapes this file actually reads.
interface MP4BoxTrackInfo {
  id: number;
  type: string;
  codec?: string;
  timescale?: number;
  track_width?: number;
  track_height?: number;
  video?: { width?: number; height?: number };
}
interface MP4BoxMovieInfo {
  tracks?: MP4BoxTrackInfo[];
}
interface MP4BoxSample {
  data: Uint8Array;
  cts: number;
  duration: number;
  is_sync: boolean;
}

// Internal canvas resolution (1080p portrait for highest export quality)
export const CANVAS_W = 1080;
export const CANVAS_H = 1920;
// Every template paints the canvas black behind the video.
const CANVAS_BG = '#000000';
// Target width for video fitting (1000px leaves 40px padding on each side)
export const VIDEO_TARGET_W = 1000;
// Display scale so the on-screen canvas isn't huge
const DISPLAY_SCALE = 0.25; // 1080×1920 → 270×480 on screen
const MIN_DIM = 40;
const H_SIZE = 10; // handle square side length

type Handle = 'tl' | 'tc' | 'tr' | 'bl' | 'bc' | 'br' | 'move';

interface Box { x: number; y: number; w: number; h: number }

// Pure module-level function — no closure issues inside effects
function calcVideoBox(vw: number, vh: number, currentBrand: string, reserveIndexBand = false, reserveFeedforceBand = false): Box {
  const headerNet = BASE_HEADER_HEIGHT - 4; // 106px — header height minus its 4px overlap
  const topReserve = currentBrand === 'forum' ? headerNet : 0;
  const bottomReserve = currentBrand === 'forum' ? 30 + 90 : 0; // gap + ribbon
  // The `index` CTA carousel renders a tall lockup below the video; shrink the
  // video to reserve that band (mirrors how forum reserves its ribbon space).
  const indexReserve = reserveIndexBand && currentBrand !== 'forum' ? INDEX_BAND_RESERVE : 0;
  // Same idea for the `feedforce` sticker — without this the video fills the
  // canvas and the sticker's clamp draws it ON TOP of the video's bottom edge.
  const feedforceReserve = reserveFeedforceBand && currentBrand !== 'forum' ? FEEDFORCE_BAND_RESERVE : 0;
  const maxVideoH = CANVAS_H - topReserve - bottomReserve - indexReserve - feedforceReserve;
  // Fill the target width so videos never pillarbox with side margins. A video taller than
  // the frame is cropped top/bottom (box height capped to the available height) instead of
  // being shrunk to fit — which used to leave black bars on the sides for >9:16 clips.
  const drawW = VIDEO_TARGET_W;
  const drawH = Math.min(vh * (VIDEO_TARGET_W / vw), maxVideoH);
  const x = (CANVAS_W - drawW) / 2;
  const y = topReserve + (maxVideoH - drawH) / 2;
  return { x, y, w: drawW, h: drawH };
}

// ── `index` CTA carousel (ported from the landing "CTA animation 2") ─────────
const INDEX_BAND_RESERVE = 240; // vertical space reserved below the video
const INDEX_HERO_IDS = [
  '3TVXtAsR1Inumwj472S9r4', // Drake
  '5K4W6rqBFWDnAN6FQUkS6x', // Kanye West
  '2YZyLoL8N0Wb9xBt1NhZWg', // Kendrick Lamar
  '7tYKF4w9nC0nq9CsPZTHyP', // SZA
  '3DbwFQlvLxRSi2uX8mf81A', // Sexyy Red
  '3fMbdgg4jU18AjLCKBhRSm', // Michael Jackson
  '5pKCCKE2ajJHZ9KAiaK11H', // Rihanna
  '0du5cEVh5yTK9QJze8zA0C', // Bruno Mars
  '74KM79TiuVKeVCqs8QtB0B', // Sabrina Carpenter
  '1uNFoZAHBGtllmzznpCI3s', // Justin Bieber
  '1Xyo4u8uXC1ZmMpatF05PJ', // The Weeknd
  '699OTQXzgjhIYAHMy9RyPD', // Playboi Carti
  '4q3ewBCX7sLwd24euuV69X', // Bad Bunny
  '7dGJo4pcD2V6oG8kP0tJRR', // Eminem
  '0Y5tJX1MQlPlqiwlOH1tJY', // Travis Scott
  '1McMsnEElThX1knmY4oliG', // Olivia Rodrigo
];

interface IndexDataPoint { index: number; timestamp: string }
interface IndexArtist {
  name: string;
  data_points: IndexDataPoint[];
  image_url?: string | null;
  index_price?: number | null;
  change_1m?: number | null;
}

const IDX_NEUTRAL = { r: 4, g: 223, b: 162 };
const IDX_POSITIVE = { r: 4, g: 223, b: 162 };
const IDX_NEGATIVE = { r: 255, g: 75, b: 75 };

function idxLerp(a: number, b: number, t: number) { return a + (b - a) * t; }
function idxLerpRGB(
  from: { r: number; g: number; b: number },
  to: { r: number; g: number; b: number },
  t: number,
) {
  return `rgb(${Math.round(idxLerp(from.r, to.r, t))},${Math.round(idxLerp(from.g, to.g, t))},${Math.round(idxLerp(from.b, to.b, t))})`;
}
// Evaluate a CSS cubic-bezier(x1,y1,x2,y2) easing at progress p (P0=0,0 P3=1,1),
// solving for the parametric value via Newton-Raphson. Used for the card flutter.
function idxBezier(p: number, x1: number, y1: number, x2: number, y2: number) {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (s: number) => ((ax * s + bx) * s + cx) * s;
  const sampleDX = (s: number) => (3 * ax * s + 2 * bx) * s + cx;
  let s = p;
  for (let i = 0; i < 6; i++) {
    const x = sampleX(s) - p;
    if (Math.abs(x) < 1e-4) break;
    const d = sampleDX(s);
    if (Math.abs(d) < 1e-6) break;
    s -= x / d;
  }
  s = Math.max(0, Math.min(1, s));
  return ((ay * s + by) * s + cy) * s;
}
function idxRoundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function idxEllipsize(ctx: CanvasRenderingContext2D, text: string, maxW: number) {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t + '…';
}
// Project an artist's data_points into chart-local coords and measure the
// polyline length (mirrors AboutChart on the landing page, with padY = 0).
function idxBuildChart(data: IndexDataPoint[], W: number, H: number) {
  let pts = data
    .map((p) => ({ t: new Date(p.timestamp).getTime(), price: parseFloat(String(p.index)) }))
    .filter((p) => !isNaN(p.t) && !isNaN(p.price))
    .sort((a, b) => a.t - b.t);
  if (pts.length < 2) return null;
  if (pts.length > 300) {
    const step = (pts.length - 1) / 299;
    pts = Array.from({ length: 300 }, (_, i) => pts[Math.min(Math.round(i * step), pts.length - 1)]);
  }
  const prices = pts.map((p) => p.price);
  const minP = Math.min(...prices);
  const maxP = Math.max(...prices);
  const pRange = maxP === minP ? 1 : maxP - minP;
  const tStart = pts[0].t;
  const tRange = (pts[pts.length - 1].t - tStart) || 1;
  const proj = pts.map((p) => ({
    x: ((p.t - tStart) / tRange) * W,
    y: (1 - (p.price - minP) / pRange) * H,
    price: p.price,
  }));
  let totalLen = 0;
  for (let i = 1; i < proj.length; i++) {
    totalLen += Math.hypot(proj[i].x - proj[i - 1].x, proj[i].y - proj[i - 1].y);
  }
  return { proj, totalLen, isPos: proj[proj.length - 1].price >= proj[0].price, firstPrice: proj[0].price };
}

const CURSORS: Record<Handle, string> = {
  tl: 'n-resize', tc: 'n-resize',  tr: 'n-resize',
  bl: 's-resize', bc: 's-resize',  br: 's-resize',
  move: 'move',
};

// Header overlay (Twitter/X style) drawn above the video area inside the crop box
const BASE_HEADER_HEIGHT = 110; // Height without caption
const CAPTION_LINE_HEIGHT = 55; // Spacing between caption lines
const CAPTION_TOP_PADDING = 80; // Padding above first caption line
// Caption font size: empty (no-handle) mode uses a larger size than the Sonotrade header.
// Used for both the draw and the line-wrap measurement so they stay in sync.
const EMPTY_CAPTION_FONT_PX = 50;
const SONOTRADE_CAPTION_FONT_PX = 42;
const HEADER_PADDING_X = 32;
const HEADER_PADDING_TOP = 14;

// Exact verified tick SVG (from X) rendered into the canvas via a data URL image
const VERIFIED_TICK_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 22 22" aria-hidden="true">
  <g>
    <path clip-rule="evenodd"
          d="M13.596 3.011L11 .5 8.404 3.011l-3.576-.506-.624 3.558-3.19 1.692L2.6 11l-1.586 3.245 3.19 1.692.624 3.558 3.576-.506L11 21.5l2.596-2.511 3.576.506.624-3.558 3.19-1.692L19.4 11l1.586-3.245-3.19-1.692-.624-3.558-3.576.506zM6 11.39l3.74 3.74 6.2-6.77L14.47 7l-4.8 5.23-2.26-2.26L6 11.39z"
          fill="url(#paint0_linear_8728_433881)"
          fill-rule="evenodd" />
    <path clip-rule="evenodd"
          d="M13.348 3.772L11 1.5 8.651 3.772l-3.235-.458-.565 3.219-2.886 1.531L3.4 11l-1.435 2.936 2.886 1.531.565 3.219 3.235-.458L11 20.5l2.348-2.272 3.236.458.564-3.219 2.887-1.531L18.6 11l1.435-2.936-2.887-1.531-.564-3.219-3.236.458zM6 11.39l3.74 3.74 6.2-6.77L14.47 7l-4.8 5.23-2.26-2.26L6 11.39z"
          fill="url(#paint1_linear_8728_433881)"
          fill-rule="evenodd" />
    <path clip-rule="evenodd"
          d="M6 11.39l3.74 3.74 6.197-6.767h.003V9.76l-6.2 6.77L6 12.79v-1.4zm0 0z"
          fill="#D18800"
          fill-rule="evenodd" />
    <defs>
      <linearGradient gradientUnits="userSpaceOnUse" id="paint0_linear_8728_433881" x1="4" x2="19.5" y1="1.5" y2="22">
        <stop stop-color="#F4E72A" />
        <stop offset=".539" stop-color="#CD8105" />
        <stop offset=".68" stop-color="#CB7B00" />
        <stop offset="1" stop-color="#F4EC26" />
        <stop offset="1" stop-color="#F4E72A" />
      </linearGradient>
      <linearGradient gradientUnits="userSpaceOnUse" id="paint1_linear_8728_433881" x1="5" x2="17.5" y1="2.5" y2="19.5">
        <stop stop-color="#F9E87F" />
        <stop offset=".406" stop-color="#E2B719" />
        <stop offset=".989" stop-color="#E2B719" />
      </linearGradient>
    </defs>
  </g>
</svg>
`.trim();

interface Market {
  ticker: string;
  title: string;
  yesAsk?: string;
  yesBid?: string;
  noAsk?: string;
  noBid?: string;
}

interface MarketData {
  ticker: string;
  title: string;
  imageUrl?: string | null;
  markets: Market[];
}

interface Props {
  videoSrc: string;
  videoId?: string;
  entryId?: string; // Unique entry ID for queue tracking
  rowNumber?: number; // Row number for ordered exports
  queuePosition?: number; // Position in upload queue (undefined = not queued)
  onVideoError?: () => void; // Callback when video fails to load
  onVideoRecovered?: () => void; // Callback when a video flagged as failed subsequently loads (stale timeout)
  onRefetchSrc?: () => Promise<string | null | void>; // Re-mint a fresh URL via /api/video-reels/download (parent updates videoSrc prop; returns the fresh raw URL for in-flight retries)
  onExportComplete?: (blob: Blob, filename: string) => void | Promise<void>; // Callback after export
  onUploadToInstagram?: (blob: Blob, filename: string) => void | Promise<void>; // Callback to upload to Instagram (called after render)
  onUploadRequest?: (entryId: string) => void; // Callback when upload button is clicked (before render)
  // Fired once per export after audio setup resolves: true = the SOURCE has an
  // audio track but none of it made it into the export (demux/decode failure) —
  // the file will be silent. false = audio intact (or the source had none).
  onAudioLost?: (lost: boolean) => void;
  igConnected?: boolean; // Whether Instagram is connected
  uploadState?: 'idle' | 'queued' | 'uploading' | 'published'; // Drives the Upload button disabled state + label (duplicate-publish guard)
  brand?: 'sonotrade' | 'sonotradeio' | 'forum' | 'culturesparadox' | 'empty';
  overlayLogoSrc?: string;
  overlayChange?: string;
  overlayDisplayName?: string;
  overlayHandle?: string;
  overlayDate?: string;
  overlayVerified?: boolean;
  overlayCaption?: string;
  tag?: string;
  marketData?: MarketData | null;
  stripAudio?: boolean; // If true, exports a video-only MP4 (debug toggle for IG copyright issues)
  lowBitrate?: boolean; // If true, uses ~1.5 Mbps video bitrate (debug toggle to test IG size limits)
}

export interface TikTokCanvasRef {
  startDownload: () => Promise<void>;
  startUpload?: () => Promise<void>; // Optional upload method
  exportBlob: () => Promise<Blob | null>; // Render the reel and return the MP4 (bulk ZIP export); null on failure/cancel
  // Capture JPEG data-URL frames from the loaded SOURCE video (not the branded
  // canvas) for overlay-caption extraction. Returns null if the video isn't
  // loaded yet or an export is in progress.
  extractFrames: (times?: number[]) => Promise<string[] | null>;
}

export const TikTokCanvas = forwardRef<TikTokCanvasRef, Props>(function TikTokCanvas({
  videoSrc,
  videoId,
  entryId,
  rowNumber = 0,
  queuePosition,
  onVideoError,
  onVideoRecovered,
  onRefetchSrc,
  onExportComplete,
  onUploadToInstagram,
  onUploadRequest,
  onAudioLost,
  igConnected = false,
  uploadState = 'idle',
  brand = 'sonotrade',
  overlayLogoSrc = '/templatelogo.png',
  overlayChange = '',
  overlayDisplayName = 'Sonotrade',
  overlayHandle = '@SonotradeHQ',
  overlayDate = 'Jan 22',
  overlayVerified = true,
  overlayCaption = '',
  tag = '',
  marketData = null,
  stripAudio = false,
  lowBitrate = false,
}: Props, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef  = useRef<HTMLVideoElement>(null);
  const raf       = useRef(0);

  // Cached image for the verified tick SVG
  const verifiedImgRef = useRef<HTMLImageElement | null>(null);
  // Cached image for the logo
  const logoImgRef = useRef<HTMLImageElement | null>(null);
  // Cached image for the Sonotrade banner
  const bannerImgRef = useRef<HTMLImageElement | null>(null);
  // Cached image for the market/event
  const marketImgRef = useRef<HTMLImageElement | null>(null);
  // Track if market image has been loaded
  const marketImgLoadedRef = useRef(false);
  // Cached image for the DuelRocket banner
  const duelrocketImgRef = useRef<HTMLImageElement | null>(null);
  // Cached image for the BetOnline banner
  const betonlineImgRef = useRef<HTMLImageElement | null>(null);
  // Cached image for the Polymarket banner
  const polymarketImgRef = useRef<HTMLImageElement | null>(null);
  // FeedForce sticker lockup, keyed by variant so a background flip re-loads.
  const feedforceImgRef = useRef<{ variant: 'black' | 'white'; img: HTMLImageElement } | null>(null);
  // Cached image for the kanye custom card
  const kanyeImgRef = useRef<HTMLImageElement | null>(null);
  // `index` CTA carousel: hero artists + cached avatar images + Sonotrade logo
  const [indexArtists, setIndexArtists] = useState<IndexArtist[]>([]);
  const indexAvatarsRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const sonotradeLogoRef = useRef<HTMLImageElement | null>(null);

  // Pan offset for the underlying video (dragging moves the video, not the crop box)
  const videoOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  
  // Video zoom scale
  const videoScaleRef = useRef<number>(1);
  const [videoScale, setVideoScale] = useState(1);

  // Playback state for template preview
  const [isPlaying, setIsPlaying] = useState(false);
  // Video error state
  const [videoError, setVideoError] = useState<string | null>(null);
  // Video loading state - true when video is still fetching data
  const [isVideoLoading, setIsVideoLoading] = useState(false);

  // Retry state — resets on every videoSrc change; refetch flag resets per videoId
  const retryCountRef = useRef(0);
  const hasRefetchedRef = useRef(false);
  // Set when the load timeout / exhausted retries surface a failure. Lives in a
  // ref (not the load effect's closure) so a failure flagged against one URL is
  // still visible after a refetch swaps in a fresh videoSrc — the recovered
  // load must clear the stale error and un-flag the parent's Retry state
  // regardless of which run flagged the failure.
  const failureFlaggedRef = useRef(false);
  // Clear a flagged failure once the video proves playable. Called from
  // loadeddata/canplay in the load effect AND from the draw loop on any painted
  // frame — `loadeddata` fires at most once per load() (typically at t=0,
  // before the seek-to-1s), so it alone misses seek-stall recoveries.
  const recoverFromFailure = (source: string) => {
    if (!failureFlaggedRef.current) return;
    // A mid-stream error (connection dropped after frames buffered) leaves
    // readyState >= 2 with drawable frames — the element LOOKS playable to the
    // draw loop but playback would stall at the buffer end. While the element
    // holds a live MediaError, the failure is genuine: don't recover. load()
    // clears .error, so quick retries and fresh sources are never blocked.
    if (videoRef.current?.error) return;
    failureFlaggedRef.current = false;
    console.log('[Row ' + (rowNumber + 1) + `] Video ${videoId} recovered (${source}) — clearing stale failure`);
    setVideoError(null);
    onVideoRecovered?.();
  };
  // Tracks whether the draw loop has painted a real video frame yet. The
  // loading spinner is cleared on first paint (not on `loadeddata`), so a
  // stalled seek never leaves a black canvas that looks finished.
  const firstFramePaintedRef = useRef(false);
  const onRefetchSrcRef = useRef(onRefetchSrc);
  useEffect(() => { onRefetchSrcRef.current = onRefetchSrc; }, [onRefetchSrc]);
  useEffect(() => { hasRefetchedRef.current = false; }, [videoId]);

  // Box lives in both a ref (for the draw loop) and state (for handle positions)
  const boxRef = useRef<Box>({ x: 0, y: 0, w: CANVAS_W, h: CANVAS_H });
  const [box, setBox] = useState<Box>({ x: 0, y: 0, w: CANVAS_W, h: CANVAS_H });
  // Exact video-render state from the last preview frame the user saw. The export reuses
  // this so it can never diverge from the on-screen preview (same box, zoom, offset, dims).
  const lastRenderStateRef = useRef<{ box: Box; userScale: number; ox: number; oy: number; vw: number; vh: number } | null>(null);

  // Active drag
  const drag = useRef<{
    handle: Handle;
    sx: number;
    sy: number;
    sb: Box;
    videoOffsetStart: { x: number; y: number };
  } | null>(null);

  // Recording
  const [isRecording, setIsRecording]     = useState(false);
  const [recProgress, setRecProgress]     = useState(0);
  const [recStatus, setRecStatus]         = useState('');
  const [isUploadMode, setIsUploadMode] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const isUploadModeRef = useRef(false);
  // Synchronous mirror of isRecording: state reads in the imperative handle /
  // click handlers are render-time snapshots, so two calls landing before the
  // next render could both see false and start concurrent renders. The ref is
  // set before the first await and checked everywhere a render can start.
  const isRecordingSyncRef = useRef(false);
  // When set, startRecording hands the finished MP4 to this sink instead of the
  // upload/export callbacks — used by exportBlob() for the bulk ZIP export.
  const exportBlobSinkRef = useRef<((b: Blob) => void) | null>(null);

  // Expose download method to parent component via ref
  useImperativeHandle(ref, () => ({
    // All guards below use ONLY the sync ref: the isRecording state in this
    // closure is a render-time snapshot, and right after an export settles the
    // false-commit may not have happened yet — a stale true would silently
    // no-op a legitimate call (e.g. the bulk export's retry pass).
    startDownload: () => {
      if (!isRecordingSyncRef.current) {
        return startRecording();
      }
      return Promise.resolve();
    },
    startUpload: () => {
      console.log('[TikTokCanvas] startUpload called for entry:', entryId, 'isRecording:', isRecordingSyncRef.current);
      if (!isRecordingSyncRef.current) {
        // Set upload mode BEFORE starting recording (using ref for immediate availability)
        isUploadModeRef.current = true;
        setIsUploadMode(true);
        console.log('[TikTokCanvas] Starting upload recording for entry:', entryId);
        return startRecording();
      } else {
        console.error('[TikTokCanvas] Already recording, cannot start upload - THIS IS A BUG');
        // Return a rejected promise so the queue knows something went wrong
        return Promise.reject(new Error('Cannot start upload - already recording'));
      }
    },
    extractFrames: async (times?: number[]) => {
      // Capture frames from the raw <video> element (the source reel's baked-in
      // overlay caption) — NOT our canvas, which has our own branding on top.
      // The video streams through the same-origin proxy, so it's canvas-safe.
      // Shared with the CaptionComposer via lib/video-reels/frame-sampler.
      if (isRecordingSyncRef.current) return null;
      return sampleVideoFrames(videoRef.current, times);
    },
    exportBlob: async () => {
      // Render the reel and hand the MP4 back to the caller (bulk ZIP export)
      // instead of routing it through the upload/export callbacks.
      if (isRecordingSyncRef.current) return null;
      let out: Blob | null = null;
      exportBlobSinkRef.current = (b) => { out = b; };
      try {
        await startRecording();
      } catch {
        // startRecording already surfaced the error via recStatus; return null
        // so the bulk export skips this row and continues with the rest.
      } finally {
        exportBlobSinkRef.current = null;
      }
      return out;
    }
  }));

  // ── Reset on new video ───────────────────────────────────────────────────────
  // Kick off the Chirp caption-font download on mount. It's only referenced from canvas
  // (never DOM), so nothing else triggers its @font-face load; preloading here means the
  // live preview draws Chirp from the first frame instead of flashing the fallback.
  useEffect(() => {
    if (typeof document !== 'undefined' && document.fonts) {
      document.fonts.load('400 42px Chirp').catch(() => { /* fall back silently */ });
    }
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleLoadedMetadata = () => {
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      console.log('[Row ' + (rowNumber + 1) + '] Video loaded successfully:', { videoId, vw, vh, src: videoSrc });
      if (vw && vh) {
        const b = calcVideoBox(vw, vh, brand, tag?.toLowerCase() === 'index', tag?.toLowerCase() === 'feedforce');
        boxRef.current = b;
        setBox(b);
        videoOffsetRef.current = { x: 0, y: 0 };
        videoScaleRef.current = 1;
        setVideoScale(1);
      }
    };

    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    return () => {
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
    };
  }, [videoSrc, brand, tag]);

  // Reposition already-loaded video when brand changes
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return;
    const b = calcVideoBox(video.videoWidth, video.videoHeight, brand, tag?.toLowerCase() === 'index', tag?.toLowerCase() === 'feedforce');
    boxRef.current = b;
    setBox(b);
    videoOffsetRef.current = { x: 0, y: 0 };
    videoScaleRef.current = 1;
    setVideoScale(1);
  }, [brand, tag]);

  // Fetch hero artists when the `index` CTA tag is active. ONE request to the
  // charts DB (via /api/video-reels/index-artists) fills all heroes — replacing
  // the old 16 per-id round-trips to a now-dead backend, which also keeps the
  // browser's connection slots free for the same-origin video proxy.
  useEffect(() => {
    if (tag?.toLowerCase() !== 'index') return;
    let cancelled = false;
    (async () => {
      let list: IndexArtist[] = [];
      try {
        const res = await fetch('/api/video-reels/index-artists', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: INDEX_HERO_IDS }),
        });
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data?.artists)) list = data.artists as IndexArtist[];
        }
      } catch {
        // leave list empty — the carousel just no-ops, same as before.
      }
      if (cancelled) return;
      // Non-deterministic shuffle (Fisher-Yates) so the carousel cycles in a
      // random order — fresh each time the artists load (per reel / reload).
      for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [list[i], list[j]] = [list[j], list[i]];
      }
      setIndexArtists(list);
    })();
    return () => { cancelled = true; };
  }, [tag]);

  // Preload avatars with crossOrigin so the export canvas is never tainted; a
  // CORS failure simply never loads (naturalWidth stays 0) → grey placeholder.
  useEffect(() => {
    for (const a of indexArtists) {
      if (a.image_url && !indexAvatarsRef.current.has(a.image_url)) {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = a.image_url;
        indexAvatarsRef.current.set(a.image_url, img);
      }
    }
  }, [indexArtists]);

  // Reset logo cache when logo source changes so next draw picks up the new image
  useEffect(() => {
    logoImgRef.current = null;
  }, [overlayLogoSrc]);

  // Preload kanye custom image
  useEffect(() => {
    if (!kanyeImgRef.current) {
      const img = new Image();
      img.src = '/willkanyereleasebullybeforemar21.png';
      kanyeImgRef.current = img;
    }
  }, []);

  // Clear video error when videoSrc changes and set up loading state
  useEffect(() => {
    // Empty/invalid URL (the row's download returned a blank play URL) — NEVER
    // leave a silent blank canvas. Re-mint a fresh URL once; if there's still
    // none, surface a clear error overlay instead of a void.
    if (!videoSrc || !videoSrc.includes('url=') || videoSrc.endsWith('url=')) {
      const refetch = onRefetchSrcRef.current;
      if (!hasRefetchedRef.current && refetch) {
        hasRefetchedRef.current = true;
        setVideoError(null);
        setIsVideoLoading(true);
        console.warn('[Row ' + (rowNumber + 1) + '] Empty video URL — re-minting a fresh one');
        refetch()
          .then((fresh) => {
            // If the re-mint STILL yields no playable URL, videoSrc won't change
            // and this effect won't re-run — so surface the error here instead of
            // spinning forever (the bug that made select rows hang on "Loading…").
            if (typeof fresh !== 'string' || !fresh) {
              setIsVideoLoading(false);
              setVideoError('No downloadable video for this row — it may be private, restricted, or use licensed audio.');
            }
            // else: parent updated entry.data → videoSrc changes → effect re-runs and loads it.
          })
          .catch((e) => {
            console.error('[Row ' + (rowNumber + 1) + '] Empty-URL refetch failed:', e);
            setIsVideoLoading(false);
            setVideoError('Could not load this video. Try fetching it again.');
          });
      } else {
        setIsVideoLoading(false);
        setVideoError('No playable video for this row — the source may be a photo post or unavailable.');
      }
      return;
    }

    console.log('[Row ' + (rowNumber + 1) + '] Video source changed for videoId:', videoId);
    console.log('[Row ' + (rowNumber + 1) + '] Video src (first 200 chars):', videoSrc.substring(0, Math.min(200, videoSrc.length)));
    setVideoError(null);
    setIsVideoLoading(true);
    retryCountRef.current = 0;
    // New source: reset the first-paint gate and clear the canvas to black so we
    // don't show the previous video's last frame while this one loads.
    firstFramePaintedRef.current = false;
    {
      const c = canvasRef.current;
      const cx = c?.getContext('2d');
      if (cx) {
        cx.fillStyle = '#000';
        cx.fillRect(0, 0, CANVAS_W, CANVAS_H);
      }
    }

    const video = videoRef.current;
    if (!video) {
      setIsVideoLoading(false);
      return;
    }

    // Reset video before loading new source
    video.pause();
    video.removeAttribute('src'); // Clear existing source
    video.load(); // Reset the video element

    // Set the new source
    video.src = videoSrc;

    // Double-fire guard for THIS load run: once a failure has been surfaced
    // here, don't surface another. (Cross-run recovery is failureFlaggedRef.)
    let failedThisRun = false;

    // Track when video is ready or fails
    const handleLoadedData = () => {
      if (video.readyState >= 2) {
        console.log('[Row ' + (rowNumber + 1) + `] Video ${videoId} loaded data, readyState:`, video.readyState);
        // A slow CDN can outlive the load timeout while still delivering bytes;
        // if a failure was flagged (by this run OR a previous URL's run), the
        // data got here after all — clear the stale error + parent Retry state.
        recoverFromFailure('loadeddata');
        // NOTE: intentionally do NOT hide the spinner here. `loadeddata` fires at
        // t=0 before the seek-to-1s lands; if that seek stalls the canvas would be
        // black with no spinner. The spinner is cleared on the first painted frame
        // in the draw loop instead (with the load-timeout below as a backstop).
      }
    };
    // `loadeddata` fires at most once per load() — a failure flagged during a
    // stalled seek would miss it, so also recover on canplay, which re-fires
    // once a late seek lands. (The draw loop's painted-frame recovery is the
    // final backstop.)
    const handleCanPlay = () => recoverFromFailure('canplay');

    const MAX_QUICK_RETRIES = 2;
    const retryTimeoutRef: { id: ReturnType<typeof setTimeout> | null } = { id: null };

    const handleError = async () => {
      const attempt = retryCountRef.current;
      console.log(`[Row ${rowNumber + 1}] Video ${videoId} error (attempt ${attempt})`);

      // Quick retries with the same URL — handles transient proxy/CDN flakes
      if (attempt < MAX_QUICK_RETRIES) {
        retryCountRef.current = attempt + 1;
        const delayMs = 500 * (attempt + 1);
        retryTimeoutRef.id = setTimeout(() => {
          if (!videoRef.current) return;
          console.log(`[Row ${rowNumber + 1}] Retrying video ${videoId} (attempt ${retryCountRef.current})`);
          videoRef.current.src = videoSrc;
          videoRef.current.load();
        }, delayMs);
        return;
      }

      // Exhausted same-URL retries — try a single refetch from /api/video-reels/download for a fresh JWT
      const refetch = onRefetchSrcRef.current;
      if (!hasRefetchedRef.current && refetch) {
        hasRefetchedRef.current = true;
        console.log(`[Row ${rowNumber + 1}] Refetching fresh URL for video ${videoId}`);
        try {
          await refetch();
          // Parent will update entry.data → videoSrc prop changes → effect re-runs with fresh URL
          return;
        } catch (err) {
          console.error(`[Row ${rowNumber + 1}] Refetch failed:`, err);
        }
      }

      console.error(`[Row ${rowNumber + 1}] Video ${videoId} permanently failed after retries`);
      // checkLoad may have already surfaced a failure for this run (e.g. it
      // fired at 45s while the refetch above was still in flight) — don't
      // re-notify the parent or swap the overlay message.
      if (failedThisRun) return;
      failedThisRun = true;
      failureFlaggedRef.current = true;
      setIsVideoLoading(false);
      setVideoError('Video failed to load after several tries.');
      if (onVideoError) onVideoError();
    };

    video.addEventListener('loadeddata', handleLoadedData);
    video.addEventListener('canplay', handleCanPlay);
    video.addEventListener('error', handleError);

    // Detect videos that never load — but don't declare failure while bytes are
    // still arriving. Some TikTok/IG CDN videos (especially through the proxy on
    // a cold backend) legitimately take 60s+; the old fixed 45s cutoff flagged
    // those as failed (networkState was NETWORK_LOADING at the deadline) and the
    // error overlay then sat on top of a video that finished loading fine.
    const LOAD_TIMEOUT_MS = 45_000;    // first check — a dead load still fails fast
    const RECHECK_MS = 15_000;         // re-check cadence while still downloading
    const STALL_WINDOW_MS = 10_000;    // no progress events for this long = stalled
    const MAX_TOTAL_WAIT_MS = 240_000; // absolute ceiling even with progress
    const loadStartedAt = Date.now();
    let lastProgressAt = loadStartedAt;
    const handleProgress = () => { lastProgressAt = Date.now(); };
    video.addEventListener('progress', handleProgress);

    const loadTimeoutRef: { id: ReturnType<typeof setTimeout> | null } = { id: null };
    const checkLoad = () => {
      if (failedThisRun) return;         // handleError already surfaced a failure
      if (video.readyState >= 2) return; // loaded — the draw loop takes it from here
      const sinceProgress = Date.now() - lastProgressAt;
      const totalWait = Date.now() - loadStartedAt;
      if (sinceProgress < STALL_WINDOW_MS && totalWait < MAX_TOTAL_WAIT_MS) {
        // Still downloading — slow, not dead. Extend the deadline instead of failing.
        console.log('[Row ' + (rowNumber + 1) + `] Video ${videoId} still downloading after ${Math.round(totalWait / 1000)}s — extending load timeout`);
        loadTimeoutRef.id = setTimeout(checkLoad, RECHECK_MS);
        return;
      }
      failedThisRun = true;
      failureFlaggedRef.current = true;
      console.error('[Row ' + (rowNumber + 1) + '] Video loading timeout for videoId:', videoId);
      console.error('[Row ' + (rowNumber + 1) + '] Video src (first 200 chars):', videoSrc.substring(0, Math.min(200, videoSrc.length)));
      console.error('[Row ' + (rowNumber + 1) + '] ReadyState:', video.readyState, 'NetworkState:', video.networkState);
      setVideoError('Video failed to load — it may be slow or unavailable.');
      setIsVideoLoading(false);
      if (onVideoError) {
        onVideoError();
      }
    };
    loadTimeoutRef.id = setTimeout(checkLoad, LOAD_TIMEOUT_MS);

    return () => {
      if (loadTimeoutRef.id) clearTimeout(loadTimeoutRef.id);
      if (retryTimeoutRef.id) clearTimeout(retryTimeoutRef.id);
      video.removeEventListener('loadeddata', handleLoadedData);
      video.removeEventListener('canplay', handleCanPlay);
      video.removeEventListener('error', handleError);
      video.removeEventListener('progress', handleProgress);
    };
  }, [videoSrc]);

  // ── Load market image when marketData changes (outside draw loop) ─────────────
  useEffect(() => {
    if (!marketData?.imageUrl) {
      marketImgLoadedRef.current = false;
      return;
    }

    // Reset loaded state
    marketImgLoadedRef.current = false;

    // Create new image if not exists or URL changed
    if (!marketImgRef.current || marketImgRef.current.src !== marketData.imageUrl) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = marketData.imageUrl;

      img.onload = () => {
        marketImgLoadedRef.current = true;
        // Trigger one redraw to show the image
      };

      marketImgRef.current = img;
    } else if (marketImgRef.current.complete) {
      marketImgLoadedRef.current = true;
    }
  }, [marketData?.imageUrl]);

  // ── Helper: Count caption lines accurately ───────────────────────────────────
  function countCaptionLines(canvasCtx: CanvasRenderingContext2D): number {
    if (!overlayCaption) return 0;

    const captionFont = `400 ${brand === 'empty' ? EMPTY_CAPTION_FONT_PX : SONOTRADE_CAPTION_FONT_PX}px Chirp, "Comic Sans MS", cursive`;
    canvasCtx.font = captionFont;
    const maxWidth = CANVAS_W - (HEADER_PADDING_X + 43) * 2;

    const userLines = overlayCaption.split('\n');
    let captionLines = 0;

    for (let lineIndex = 0; lineIndex < userLines.length; lineIndex++) {
      const userLine = userLines[lineIndex];
      if (!userLine) {
        captionLines++;
        continue;
      }

      const words = userLine.split(' ');
      let line = '';
      let lineCount = 1;

      for (let i = 0; i < words.length; i++) {
        const testLine = line + words[i] + ' ';
        const metrics = canvasCtx.measureText(testLine);

        if (metrics.width > maxWidth && i > 0) {
          lineCount++;
          line = words[i] + ' ';
        } else {
          line = testLine;
        }
      }
      captionLines += lineCount;
    }

    return captionLines;
  }

  // ── Reusable drawing functions (used by both main canvas and export) ─────────────
  // These functions draw identically on any CanvasRenderingContext2D

  interface DrawHeaderParams {
    ctx: CanvasRenderingContext2D;
    cx: number;
    cy: number;
    cw: number;
    countCaptionLinesFn: (ctx: CanvasRenderingContext2D) => number;
  }

  function drawHeaderOnContext({ ctx, cx, cy, cw, countCaptionLinesFn }: DrawHeaderParams): number {
    const padX = HEADER_PADDING_X + 43; // Shift right by 43px
    const padY = HEADER_PADDING_TOP;
    const lineH = 50;
    const nameFont = '600 44px system-ui, sans-serif';
    const metaFont = '400 40px system-ui, sans-serif';
    const metaColor = 'rgba(113, 118, 123, 1)';
    const nameColor = 'rgb(231, 233, 234)';

    const isEmpty = brand === 'empty';

    // Calculate number of caption lines to determine dynamic header height
    const captionLines = countCaptionLinesFn(ctx);

    // Dynamic header height based on CAPTION_LINE_HEIGHT, minus bottom offset to tighten the box
    const CAPTION_BOTTOM_OFFSET = 18; // Reduce space below last line
    const headerHeight = overlayCaption
      ? (isEmpty ? CAPTION_TOP_PADDING + 100 + (captionLines * CAPTION_LINE_HEIGHT) + 20 : BASE_HEADER_HEIGHT + CAPTION_TOP_PADDING + (captionLines * CAPTION_LINE_HEIGHT) - CAPTION_BOTTOM_OFFSET)
      : (isEmpty ? 0 : BASE_HEADER_HEIGHT);

    // Solid header background (skip for empty mode if no caption)
    if (headerHeight > 0) {
      ctx.fillStyle = '#000';
      ctx.fillRect(cx, cy, cw, headerHeight);
    }

    // For empty mode, only draw caption and skip everything else
    if (isEmpty) {
      if (overlayCaption) {
        const captionFont = `400 ${EMPTY_CAPTION_FONT_PX}px Chirp, "Comic Sans MS", cursive`;
        const captionColor = 'rgb(231, 233, 234)';
        const captionBaseline = cy + CAPTION_TOP_PADDING + 100;
        const captionLeft = cx + padX;

        ctx.font = captionFont;
        ctx.fillStyle = captionColor;

        // Split by user's explicit newlines first, then wrap each line
        const userLines = overlayCaption.split('\n');
        const maxWidth = cw - padX * 2;
        let y = captionBaseline;

        for (let lineIndex = 0; lineIndex < userLines.length; lineIndex++) {
          const userLine = userLines[lineIndex];
          if (!userLine) {
            // Empty line from user - just advance Y
            y += CAPTION_LINE_HEIGHT;
            continue;
          }

          const words = userLine.split(' ');
          let line = '';

          for (let i = 0; i < words.length; i++) {
            const testLine = line + words[i] + ' ';
            const metrics = ctx.measureText(testLine);

            if (metrics.width > maxWidth && i > 0) {
              ctx.fillText(line, captionLeft, y);
              line = words[i] + ' ';
              y += CAPTION_LINE_HEIGHT;
            } else {
              line = testLine;
            }
          }
          ctx.fillText(line, captionLeft, y);
          y += CAPTION_LINE_HEIGHT;
        }
      }
      return headerHeight;
    }

    // Baselines for name and handle
    const baselineName = cy + padY + lineH;
    const handleBaseline = baselineName + 48;

    // Logo on the left, vertically centered alongside both lines of text
    const logoHeight = 115;
    const textCenterY = (baselineName + handleBaseline) / 2;
    const logoX = cx + padX;
    let logo = logoImgRef.current;
    if (!logo) {
      logo = new Image();
      logo.src = overlayLogoSrc;
      logoImgRef.current = logo;
    }

    // Calculate logo width based on aspect ratio, or use default
    let logoWidth = logoHeight; // default to square if image not loaded
    if (logo.complete && logo.width && logo.height) {
      const logoAspectRatio = logo.width / logo.height;
      logoWidth = logoHeight * logoAspectRatio;
      const logoY = textCenterY - logoHeight / 2 - 10; // Move up by 10px
      const logoRadius = 14; // corner radius
      // Sonotradeio uses a circular avatar with a 2px ring, to distinguish it
      // from the plain Sonotrade brand's rounded-rect avatar.
      const isCircleAvatar = brand === 'sonotradeio';
      const avatarCenterX = logoX + logoWidth / 2;
      const avatarCenterY = logoY + logoHeight / 2;
      const avatarRadius = Math.min(logoWidth, logoHeight) / 2;

      ctx.save();
      ctx.beginPath();
      if (isCircleAvatar) {
        ctx.arc(avatarCenterX, avatarCenterY, avatarRadius, 0, Math.PI * 2);
      } else {
        ctx.roundRect(logoX, logoY, logoWidth, logoHeight, logoRadius);
      }
      ctx.closePath();
      ctx.clip();
      if (isCircleAvatar) {
        // Contain (not cover): scale the whole logo down so it fits inside the
        // circle with a gap to the ring, instead of overflowing/cropping. The
        // logo is portrait, so height is the limiting dimension.
        const AVATAR_FIT = 0.85; // logo fills this fraction of the circle diameter
        const drawH = avatarRadius * 2 * AVATAR_FIT;
        const drawW = drawH * (logoWidth / logoHeight);
        ctx.drawImage(logo, avatarCenterX - drawW / 2, avatarCenterY - drawH / 2, drawW, drawH);
      } else {
        ctx.drawImage(logo, logoX, logoY, logoWidth, logoHeight);
      }
      ctx.restore();

      // Sonotradeio: 2px circular border tracing the same circle as the clip.
      if (isCircleAvatar) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(avatarCenterX, avatarCenterY, avatarRadius, 0, Math.PI * 2);
        ctx.closePath();
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgb(231, 233, 234)';
        ctx.stroke();
        ctx.restore();
      }
    }

    // First line: display name + verified badge, to the right of the logo
    let left = logoX + logoWidth + 28; // extra right-side gap after logo

    // Display name
    ctx.font = nameFont;
    ctx.fillStyle = nameColor;
    ctx.fillText(overlayDisplayName, left, baselineName);
    left += ctx.measureText(overlayDisplayName).width + 6;

    // Verified badge (exact X SVG), vertically centered with the display name
    if (overlayVerified) {
      const size = 36;
      const badgeX = left;
      const nameCenterY = baselineName - 22; // approx vertical center of 44px name
      const badgeY = nameCenterY - size / 2 + 8;
      let img = verifiedImgRef.current;
      if (!img) {
        img = new Image();
        img.src = `data:image/svg+xml;utf8,${encodeURIComponent(VERIFIED_TICK_SVG)}`;
        verifiedImgRef.current = img;
      }
      if (img.complete) {
        ctx.drawImage(img, badgeX, badgeY, size, size);
      }
      left += size + 12;
    }

    // Second line: @handle under the display name, with a bit more spacing
    ctx.font = metaFont;
    ctx.fillStyle = metaColor;
    const handleLeft = logoX + logoWidth + 28;
    ctx.fillText(overlayHandle, handleLeft, handleBaseline);

    // Caption: below the handle if provided
    if (overlayCaption) {
      const captionFont = '400 42px Chirp, "Comic Sans MS", cursive';
      const captionColor = 'rgb(231, 233, 234)';
      const captionBaseline = handleBaseline + CAPTION_TOP_PADDING;
      const captionLeft = cx + padX;

      ctx.font = captionFont;
      ctx.fillStyle = captionColor;

      // Split by user's explicit newlines first, then wrap each line
      const userLines = overlayCaption.split('\n');
      const maxWidth = cw - padX * 2;
      let y = captionBaseline;

      for (let lineIndex = 0; lineIndex < userLines.length; lineIndex++) {
        const userLine = userLines[lineIndex];
        if (!userLine) {
          // Empty line from user - just advance Y
          y += CAPTION_LINE_HEIGHT;
          continue;
        }

        const words = userLine.split(' ');
        let line = '';

        for (let i = 0; i < words.length; i++) {
          const testLine = line + words[i] + ' ';
          const metrics = ctx.measureText(testLine);

          if (metrics.width > maxWidth && i > 0) {
            ctx.fillText(line, captionLeft, y);
            line = words[i] + ' ';
            y += CAPTION_LINE_HEIGHT;
          } else {
            line = testLine;
          }
        }
        ctx.fillText(line, captionLeft, y);
        // Only advance Y if there are more user lines to process
        if (lineIndex < userLines.length - 1) {
          y += CAPTION_LINE_HEIGHT;
        }
      }
    }

    return headerHeight; // Return the calculated height
  }

  interface DrawMarketCardParams {
    ctx: CanvasRenderingContext2D;
    boxY: number;
  }

  function drawMarketCardOnContext({ ctx, boxY }: DrawMarketCardParams): void {
    // Special handling for kanye tag - show custom image instead of market card
    if (tag?.trim().toLowerCase() === 'kanye') {
      const kanyeImg = kanyeImgRef.current;
      if (kanyeImg && kanyeImg.complete && kanyeImg.width && kanyeImg.height) {
        // Card dimensions exactly match the image (930x134)
        const cardWidth = 930;
        const cardHeight = 134;
        const boxPadding = (CANVAS_W - cardWidth) / 2; // Center horizontally
        const boxX = boxPadding;

        // Draw rounded rectangle background
        const radius = 16;
        ctx.fillStyle = '#000';
        ctx.strokeStyle = 'rgba(113, 118, 123, 0.5)';
        ctx.lineWidth = 2;

        ctx.beginPath();
        ctx.moveTo(boxX + radius, boxY);
        ctx.lineTo(boxX + cardWidth - radius, boxY);
        ctx.quadraticCurveTo(boxX + cardWidth, boxY, boxX + cardWidth, boxY + radius);
        ctx.lineTo(boxX + cardWidth, boxY + cardHeight - radius);
        ctx.quadraticCurveTo(boxX + cardWidth, boxY + cardHeight, boxX + cardWidth - radius, boxY + cardHeight);
        ctx.lineTo(boxX + radius, boxY + cardHeight);
        ctx.quadraticCurveTo(boxX, boxY + cardHeight, boxX, boxY + cardHeight - radius);
        ctx.lineTo(boxX, boxY + radius);
        ctx.quadraticCurveTo(boxX, boxY, boxX + radius, boxY);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Draw image at full size (930x134), fills the entire card
        ctx.drawImage(kanyeImg, boxX, boxY, cardWidth, cardHeight);
      } else {
        // Preload kanye image if not loaded
        if (!kanyeImgRef.current) {
          const img = new Image();
          img.src = '/willkanyereleasebullybeforemar21.png';
          kanyeImgRef.current = img;
        }
      }
      return;
    }

    if (!tag?.trim() || !marketData || !marketData.markets || marketData.markets.length === 0) {
      return;
    }

    const market = marketData.markets[0];
    const boxHeight = 140;
    const boxPadding = 60;
    const radius = 16;
    const boxX = boxPadding;
    const boxWidth = CANVAS_W - boxPadding * 2;

    // Draw rounded rectangle with black background and gray border
    ctx.fillStyle = '#000';
    ctx.strokeStyle = 'rgba(113, 118, 123, 0.5)';
    ctx.lineWidth = 2;

    // Rounded rectangle path
    ctx.beginPath();
    ctx.moveTo(boxX + radius, boxY);
    ctx.lineTo(boxX + boxWidth - radius, boxY);
    ctx.quadraticCurveTo(boxX + boxWidth, boxY, boxX + boxWidth, boxY + radius);
    ctx.lineTo(boxX + boxWidth, boxY + boxHeight - radius);
    ctx.quadraticCurveTo(boxX + boxWidth, boxY + boxHeight, boxX + boxWidth - radius, boxY + boxHeight);
    ctx.lineTo(boxX + radius, boxY + boxHeight);
    ctx.quadraticCurveTo(boxX, boxY + boxHeight, boxX, boxY + boxHeight - radius);
    ctx.lineTo(boxX, boxY + radius);
    ctx.quadraticCurveTo(boxX, boxY, boxX + radius, boxY);
    ctx.closePath();

    ctx.fill();
    ctx.stroke();

    const textPadding = 40; // Increased internal padding
    const imageSize = 80; // Increased square image size
    const imageMargin = 25; // Increased gap between image and text

    // Draw market image if available (using pre-loaded image)
    let textStartX = boxX + textPadding;
    if (marketImgRef.current && marketImgLoadedRef.current) {
      const img = marketImgRef.current;
      const imgX = boxX + textPadding;
      const imgY = boxY + (boxHeight - imageSize) / 2; // Vertically center

      // Draw rounded rectangle clip for image
      ctx.save();
      ctx.beginPath();
      const imgRadius = 12; // Increased corner radius to match rectangle
      ctx.moveTo(imgX + imgRadius, imgY);
      ctx.lineTo(imgX + imageSize - imgRadius, imgY);
      ctx.quadraticCurveTo(imgX + imageSize, imgY, imgX + imageSize, imgY + imgRadius);
      ctx.lineTo(imgX + imageSize, imgY + imageSize - imgRadius);
      ctx.quadraticCurveTo(imgX + imageSize, imgY + imageSize, imgX + imageSize - imgRadius, imgY + imageSize);
      ctx.lineTo(imgX + imgRadius, imgY + imageSize);
      ctx.quadraticCurveTo(imgX, imgY + imageSize, imgX, imgY + imageSize - imgRadius);
      ctx.lineTo(imgX, imgY + imgRadius);
      ctx.quadraticCurveTo(imgX, imgY, imgX + imgRadius, imgY);
      ctx.closePath();
      ctx.clip();

      ctx.drawImage(img, imgX, imgY, imageSize, imageSize);
      ctx.restore();

      textStartX = imgX + imageSize + imageMargin;
    }

    // Calculate max width for text (leave space for odds and banner on right)
    const maxTextWidth = 420; // Reduced from 450 to make title area slightly narrower

    // Event title (white text) - max 2 lines with ellipsis for truncation
    ctx.font = '600 28px system-ui, sans-serif'; // Increased from 26px to 28px
    ctx.fillStyle = 'rgb(231, 233, 234)';
    ctx.textAlign = 'left'; // Ensure left alignment for title

    const fullText = marketData.title;
    console.log('[Market Card] Drawing title:', JSON.stringify(fullText));
    const fullTextWidth = ctx.measureText(fullText).width;
    const ellipsis = '...';
    const ellipsisWidth = ctx.measureText(ellipsis).width;

    if (fullTextWidth <= maxTextWidth) {
      // Text fits in one line - center it vertically
      const textY = boxY + boxHeight / 2 + 8; // Vertically centered
      ctx.fillText(fullText, textStartX, textY);
    } else {
      // Text needs wrapping - split into two rows max, with truncation
      const lineHeight = 34; // Increased from 30px to 34px for more spacing
      const totalTextHeight = lineHeight * 2; // Two lines
      const textY = boxY + (boxHeight - totalTextHeight) / 2 + 24; // Center the two-line block
      const words = fullText.split(' ');

      // Build line 1 first - add words until full
      const line1Words: string[] = [];
      let line1Width = 0;
      for (const word of words) {
        const wordWidth = ctx.measureText(word).width;
        const spaceWidth = line1Words.length > 0 ? ctx.measureText(' ').width : 0;
        const newWidth = line1Width + spaceWidth + wordWidth;

        if (newWidth <= maxTextWidth) {
          line1Words.push(word);
          line1Width = newWidth;
        } else {
          break; // Line 1 is full
        }
      }

      // Remaining words go to line 2
      const line2Words = words.slice(line1Words.length);

      // Build the final line strings
      const line1 = line1Words.join(' ');
      let line2 = line2Words.join(' ');

      // Truncate line 2 if needed (with ellipsis)
      if (line2) {
        const line2Width = ctx.measureText(line2).width;
        if (line2Width > maxTextWidth - ellipsisWidth) {
          let truncatedLine = line2;
          while (ctx.measureText(truncatedLine + ellipsis).width > maxTextWidth) {
            truncatedLine = truncatedLine.slice(0, -1);
          }
          line2 = truncatedLine + ellipsis;
        }
      }

      // Draw the lines
      console.log('[Market Card] Drawing line1:', JSON.stringify(line1), 'line2:', JSON.stringify(line2));
      console.log('[Market Card] line1Words:', line1Words, 'line2Words:', line2Words);
      ctx.fillText(line1, textStartX, textY);
      if (line2) {
        ctx.fillText(line2, textStartX, textY + 34);
      }
    }

    // Draw odds (yesBid) on the right side if available
    if (market.yesBid) {
      const bannerReservedWidth = 240; // Space reserved for banner column
      const oddsColumnEnd = boxX + boxWidth - textPadding - bannerReservedWidth;

      // Convert decimal to percentage (0.01 -> 1%)
      const oddsValue = parseFloat(market.yesBid) * 100;
      const oddsText = Math.round(oddsValue) + '%';

      // Calculate payout: (100 / percentage) * 100
      const payoutValue = (100 / oddsValue) * 100;
      const payoutAmount = Math.round(payoutValue);

      // Measure payout line width for centering
      ctx.font = '400 16px system-ui, sans-serif';
      const greenText = '$' + payoutAmount;
      const prefix = '$100 → ';
      const payoutLineWidth = ctx.measureText(prefix + greenText).width;

      // Draw percentage (larger, above and centered over payout)
      ctx.font = '700 60px system-ui, sans-serif'; // Increased from 48px to 60px
      ctx.fillStyle = 'rgb(231, 233, 234)';
      const oddsY = boxY + boxHeight / 2 + 4; // Moved down slightly
      // Center the percentage above the payout line
      const percentageWidth = ctx.measureText(oddsText).width;
      const percentageX = oddsColumnEnd - (payoutLineWidth / 2) + (percentageWidth / 2);
      ctx.textAlign = 'right';
      ctx.fillText(oddsText, percentageX, oddsY);

      // Draw payout with mixed colors
      ctx.font = '400 20px system-ui, sans-serif'; // Increased from 17px to 20px
      const payoutY = oddsY + 34; // Reduced from 38 to bring closer

      // Measure and draw the full text with green payout
      const greenWidth = ctx.measureText(greenText).width;

      // Draw "$X" in green (right-aligned)
      ctx.fillStyle = 'rgb(0, 186, 124)'; // Green color
      ctx.fillText(greenText, oddsColumnEnd, payoutY);

      // Draw "$100 → " in gray (to the left of green text)
      ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.fillText(prefix, oddsColumnEnd - greenWidth, payoutY);

      ctx.textAlign = 'left'; // Reset alignment

      // Draw Sonotrade banner in its own column on the far right
      let banner = bannerImgRef.current;
      if (!banner) {
        banner = new Image();
        banner.src = '/banner.png';
        bannerImgRef.current = banner;
      }

      if (banner.complete && banner.width && banner.height) {
        const bannerHeight = 55; // Increased from 50px to 55px
        const bannerAspectRatio = banner.width / banner.height;
        const bannerWidth = bannerHeight * bannerAspectRatio;

        // Calculate total height of banner + text + gap
        const textGap = 7; // Reduced gap between banner and text
        const textHeight = 16; // Approximate text height (increased for 15px font)
        const totalHeight = bannerHeight + textGap + textHeight;
        const rightMargin = 0; // Minimal right margin from rectangle edge

        // Position banner and text as a group, vertically centered
        const groupY = boxY + (boxHeight - totalHeight) / 2;
        // Position banner with right margin considered
        const maxBannerRight = boxX + boxWidth - textPadding - rightMargin;
        const bannerX = maxBannerRight - bannerWidth;
        const bannerY = groupY;

        // Draw banner (removed bounds check to debug)
        ctx.drawImage(banner, bannerX, bannerY, bannerWidth, bannerHeight);

        // Draw "Exclusive access in bio" below the banner
        ctx.font = '400 17px system-ui, sans-serif';
        ctx.fillStyle = 'rgba(255, 255, 255, 1)'; // White at 100% opacity
        ctx.textAlign = 'center';
        const textX = bannerX + bannerWidth / 2; // Center text under banner
        const textY = bannerY + bannerHeight + textGap + 10;
        ctx.fillText('Exclusive access in bio', textX, textY);
      }

      // Reset text alignment to left (default)
      ctx.textAlign = 'left';
    }
  }

  function drawForumBannerOnContext({ ctx, boxY }: { ctx: CanvasRenderingContext2D; boxY: number }): void {
    const boxHeight = 90;
    const boxX = 0;
    const boxWidth = CANVAS_W;

    // Blue background, no border, no corner radius
    ctx.fillStyle = '#246eff';
    ctx.fillRect(boxX, boxY, boxWidth, boxHeight);

    // Logo on the left, vertically centered
    let logo = logoImgRef.current;
    if (!logo) {
      logo = new Image();
      logo.src = overlayLogoSrc;
      logoImgRef.current = logo;
    }
    if (logo.complete && logo.width && logo.height) {
      const logoH = 60;
      const logoW = logoH * (logo.width / logo.height);
      const logoX = 60;
      const logoY = boxY + (boxHeight - logoH) / 2;
      ctx.drawImage(logo, logoX, logoY, logoW, logoH);

      // "Forum" text to the right of the logo
      ctx.font = 'bold 46px "Arial MT Pro", "Arial Black", Arial, sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.textBaseline = 'middle';
      ctx.fillText('Forum', logoX + logoW + 10, boxY + boxHeight / 2 + 3);

      // Right side: [event ID] [▲] [% change], all right-aligned as a group
      const tagText = tag?.trim() || '';
      const changeText = overlayChange?.trim() || '';
      if (tagText || changeText) {
        ctx.font = '300 34px "Arial MT Pro", Arial, sans-serif';
        const triW = 22;
        const triH = 19;
        const triGap = 14;
        const centerY = boxY + boxHeight / 2 + 3;
        const rightEdge = CANVAS_W - 90;

        // Measure text widths
        const changeWidth = changeText ? ctx.measureText(changeText).width : 0;
        const tagWidth = tagText ? ctx.measureText(tagText).width : 0;

        // Calculate group width: tag + gap + triangle + gap + change
        const groupWidth = tagWidth + (tagWidth ? triGap : 0) + triW + (changeText ? triGap : 0) + changeWidth;
        let x = rightEdge - groupWidth;

        // Draw event ID
        if (tagText) {
          ctx.fillStyle = '#ffffff';
          ctx.textBaseline = 'middle';
          ctx.fillText(tagText, x, centerY);
          x += tagWidth + triGap;
        }

        // Draw triangle
        const triY = centerY - triH / 2 - 4;
        ctx.fillStyle = '#00c853';
        ctx.beginPath();
        ctx.moveTo(x + triW / 2, triY);
        ctx.lineTo(x + triW, triY + triH);
        ctx.lineTo(x, triY + triH);
        ctx.closePath();
        ctx.fill();
        x += triW + (changeText ? triGap : 0);

        // Draw % change
        if (changeText) {
          ctx.fillStyle = '#00c853';
          ctx.textBaseline = 'middle';
          ctx.fillText(changeText, x, centerY);
        }

        ctx.textBaseline = 'alphabetic';
      }
    }
  }

  function drawDuelrocketBannerOnContext({ ctx, boxY }: { ctx: CanvasRenderingContext2D; boxY: number }): void {
    // DuelRocket banner: 720px width, height scaled from 1920x1027 native
    const targetWidth = 720;
    const boxX = (CANVAS_W - targetWidth) / 2; // Center horizontally

    // Load DuelRocket image if not cached
    let banner = duelrocketImgRef.current;
    if (!banner) {
      banner = new Image();
      banner.src = '/duelrocket.png';
      duelrocketImgRef.current = banner;
    }

    // Draw the banner image scaled to 720px width while preserving aspect ratio
    if (banner.complete && banner.width && banner.height) {
      const scaleX = targetWidth / banner.width;
      const drawH = banner.height * scaleX;
      const drawY = boxY;

      ctx.drawImage(banner, boxX, drawY, targetWidth, drawH);
    } else {
      // Fallback: purple background while loading
      ctx.fillStyle = '#6b21a8';
      ctx.fillRect(boxX, boxY, targetWidth, 385); // ~385 = 1027 * (720/1920)
    }
  }

  function drawBetonlineBannerOnContext({ ctx, boxY }: { ctx: CanvasRenderingContext2D; boxY: number }): void {
    // BetOnline banner: 720px width, height scaled from 9603x2021 native
    const targetWidth = 720;
    const boxX = (CANVAS_W - targetWidth) / 2; // Center horizontally

    // Load BetOnline image if not cached
    let banner = betonlineImgRef.current;
    if (!banner) {
      banner = new Image();
      banner.src = '/BetOnline.png';
      betonlineImgRef.current = banner;
    }

    // Draw the banner image scaled to 720px width while preserving aspect ratio
    if (banner.complete && banner.width && banner.height) {
      const scaleX = targetWidth / banner.width;
      const drawH = banner.height * scaleX;
      const drawY = boxY;

      ctx.drawImage(banner, boxX, drawY, targetWidth, drawH);
    } else {
      // Fallback: blue background while loading
      ctx.fillStyle = '#1a365d';
      ctx.fillRect(boxX, boxY, targetWidth, 152); // ~152 = 2021 * (720/9603)
    }
  }

  function drawPolymarketBannerOnContext({ ctx, boxY }: { ctx: CanvasRenderingContext2D; boxY: number }): void {
    // Polymarket banner: 720px width, height scaled from 1407x153 native
    const targetWidth = 720;
    const boxX = (CANVAS_W - targetWidth) / 2; // Center horizontally

    // Load Polymarket image if not cached
    let banner = polymarketImgRef.current;
    if (!banner) {
      banner = new Image();
      banner.src = '/polymarket.png';
      polymarketImgRef.current = banner;
    }

    // Draw the banner image scaled to 720px width while preserving aspect ratio
    if (banner.complete && banner.width && banner.height) {
      const scaleX = targetWidth / banner.width;
      const drawH = banner.height * scaleX;
      const drawY = boxY;

      ctx.drawImage(banner, boxX, drawY, targetWidth, drawH);
    } else {
      // Fallback: dark background while loading
      ctx.fillStyle = '#1a1a2e';
      ctx.fillRect(boxX, boxY, targetWidth, 78); // ~78 = 153 * (720/1407)
    }
  }

  // FeedForce sticker for the `feedforce` tag — the branded lockup + tagline
  // centred under the video crop. `bottomY` is the crop's BOTTOM EDGE (the gap
  // is applied internally), and the preview and export pass identical geometry
  // so the bake matches the preview exactly.
  function drawFeedforceStickerOnContext({ ctx, bottomY, centerX, maxW }: {
    ctx: CanvasRenderingContext2D;
    bottomY: number;
    centerX: number;
    maxW: number;
  }): void {
    // Every template fills the canvas #000, so this resolves to the white mark;
    // routed through stickerVariant so a lighter background picks the dark one.
    const variant = stickerVariant(CANVAS_BG);
    let entry = feedforceImgRef.current;
    if (!entry || entry.variant !== variant) {
      const img = new Image();
      img.src = feedforceStickerSrc(variant);
      entry = { variant, img };
      feedforceImgRef.current = entry;
    }

    const FF = '"Libre Franklin", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.save();
    // Measure each line at its own size — the widest drives the shrink.
    const L = stickerLayout({
      centerX,
      bottomY,
      maxW,
      measure: (text, px) => { ctx.font = `400 ${px}px ${FF}`; return ctx.measureText(text).width; },
    });

    const img = entry.img;
    if (img.complete && img.naturalWidth > 0) {
      ctx.drawImage(img, L.lockup.x, L.lockup.y, L.lockup.w, L.lockup.h);
    } else {
      // Lockup not usable (still loading / failed) → a bold wordmark in its
      // slot: the sticker must never silently vanish from a bake.
      ctx.font = `700 ${Math.round(L.lockup.h * 0.9)}px ${FF}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = variant === 'black' ? '#000' : '#fff';
      ctx.fillText('FeedForce', centerX, L.lockup.y + L.lockup.h / 2);
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    ctx.font = `400 ${L.tagline.px}px ${FF}`;
    ctx.fillStyle = variant === 'black' ? 'rgba(0,0,0,.72)' : 'rgba(255,255,255,.85)';
    ctx.fillText(FEEDFORCE_TAGLINE, L.tagline.x, L.tagline.y);

    // CTA line — slightly smaller and dimmer so it reads as secondary to the tagline.
    ctx.font = `400 ${L.cta.px}px ${FF}`;
    ctx.fillStyle = variant === 'black' ? 'rgba(0,0,0,.58)' : 'rgba(255,255,255,.70)';
    ctx.fillText(FEEDFORCE_CTA, L.cta.x, L.cta.y);
    ctx.restore();
  }

  // Animated CTA carousel for the `index` tag — a cycling artist index card
  // (chart draws on + numbers count up) with the Sonotrade lockup below.
  // Driven purely by `timeSeconds` so the preview and the export render
  // identically (preview passes video.currentTime, export passes the frame time).
  function drawIndexCarouselOnContext({ ctx, boxY, timeSeconds }: { ctx: CanvasRenderingContext2D; boxY: number; timeSeconds: number }): void {
    const artists = indexArtists;
    if (!artists.length) return;

    const CYCLE_MS = 4000; // 1s draw + 3s hold
    const DRAW_MS = 1000;
    const tMs = timeSeconds * 1000;
    const a = artists[Math.floor(tMs / CYCLE_MS) % artists.length];
    const cycleElapsed = tMs % CYCLE_MS;
    const tRaw = Math.min(cycleElapsed / DRAW_MS, 1);
    const progress = 1 - Math.pow(1 - tRaw, 2); // easeOutSoft

    // Per-card fade-up flutter (matches CTA animation 2's sxArtistFadeIn): each
    // new card fades in and slides up ~16px over 0.6s with the same easing.
    const fade = idxBezier(Math.min(cycleElapsed / 600, 1), 0.25, 0.46, 0.45, 0.94);

    // ── Card shell (≈30% narrower than full width; contents scaled to match) ──
    const cardW = 672; // ~30% narrower than the old 960
    const cardX = (CANVAS_W - cardW) / 2; // centered → 204
    const cardH = 133; // ~5% shorter
    const cardY = boxY;
    // Left/right inset = the avatar's top/bottom gap ((cardH - avSize)/2 = 33),
    // so the avatar sits with equal padding on top, left and bottom.
    const pad = 33;
    // Fade-up wraps the whole card; the logo lockup below stays static.
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.translate(0, (1 - fade) * 16);
    ctx.save();
    idxRoundRectPath(ctx, cardX, cardY, cardW, cardH, 16);
    // Grey card, a touch darker than CTA animation 2's ~rgb(20,20,20): over
    // the reel's pure-black canvas 0.06 white composites to ~rgb(15,15,15).
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#27272a';
    ctx.stroke();
    ctx.restore();

    const rowCY = cardY + cardH / 2;

    // Avatar (circle, grey placeholder until cleanly loaded)
    const avSize = 67;
    const avX = cardX + pad;
    const avY = rowCY - avSize / 2;
    ctx.save();
    ctx.beginPath();
    ctx.arc(avX + avSize / 2, avY + avSize / 2, avSize / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    const avImg = a.image_url ? indexAvatarsRef.current.get(a.image_url) : undefined;
    if (avImg && avImg.complete && avImg.naturalWidth > 0) {
      ctx.drawImage(avImg, avX, avY, avSize, avSize);
    } else {
      ctx.fillStyle = '#3f3f46';
      ctx.fillRect(avX, avY, avSize, avSize);
    }
    ctx.restore();

    // Name + "Index" label (column sizes to the name, capped)
    const nameColX = avX + avSize + 16;
    const nameMaxW = 272;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = '500 24px system-ui, sans-serif';
    const fullNameW = ctx.measureText(a.name || '').width;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(idxEllipsize(ctx, a.name || '', nameMaxW), nameColX, rowCY - 6);
    ctx.font = '400 19px system-ui, sans-serif';
    ctx.fillStyle = '#a1a1aa';
    ctx.fillText('Index', nameColX, rowCY + 23);
    const nameColW = Math.min(fullNameW, nameMaxW);

    // Right column reserved for the numbers; chart flexes into the middle
    const rightEdge = cardX + cardW - pad;
    const rightColW = 132;
    const chartX = nameColX + nameColW + 18;
    const chartW = rightEdge - rightColW - 11 - chartX;
    const chartH = 57;
    const chartY = rowCY - chartH / 2;

    let dotPrice = a.index_price ?? 0;
    let pct = 0;
    const geom = chartW > 10 ? idxBuildChart(a.data_points || [], chartW, chartH) : null;
    if (geom) {
      const { proj, totalLen, isPos, firstPrice } = geom;
      const drawn = totalLen * progress;
      const colorT = Math.max(0, Math.min(1, (progress - 0.1) / 0.7));
      const color = idxLerpRGB(IDX_NEUTRAL, isPos ? IDX_POSITIVE : IDX_NEGATIVE, colorT);
      ctx.save();
      ctx.translate(chartX, chartY);
      ctx.beginPath();
      ctx.moveTo(proj[0].x, proj[0].y);
      let acc = 0;
      let dot = { x: proj[proj.length - 1].x, y: proj[proj.length - 1].y, price: proj[proj.length - 1].price };
      for (let i = 1; i < proj.length; i++) {
        const prev = proj[i - 1];
        const cur = proj[i];
        const seg = Math.hypot(cur.x - prev.x, cur.y - prev.y);
        if (acc + seg >= drawn) {
          const tt = seg > 0 ? (drawn - acc) / seg : 0;
          dot = {
            x: prev.x + tt * (cur.x - prev.x),
            y: prev.y + tt * (cur.y - prev.y),
            price: prev.price + tt * (cur.price - prev.price),
          };
          ctx.lineTo(dot.x, dot.y);
          break;
        }
        ctx.lineTo(cur.x, cur.y);
        acc += seg;
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(dot.x, dot.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.restore();
      dotPrice = dot.price;
      pct = firstPrice > 0 ? ((dot.price - firstPrice) / firstPrice) * 100 : 0;
    }

    // Points value + "points" suffix (right-aligned)
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    ctx.font = '400 14px system-ui, sans-serif';
    ctx.fillStyle = '#a1a1aa';
    ctx.fillText('points', rightEdge, rowCY - 12);
    const ptsLabelW = ctx.measureText('points').width;
    ctx.font = '400 23px system-ui, sans-serif';
    ctx.fillText(
      dotPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      rightEdge - ptsLabelW - 8,
      rowCY - 12,
    );

    // Percent + triangle (green up / red down) — wider, shorter base
    const isUp = pct >= 0;
    const pctColor = isUp ? '#04df9d' : '#FF4B4B';
    const pctStr = Math.abs(pct).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';
    ctx.font = '500 23px system-ui, sans-serif';
    ctx.fillStyle = pctColor;
    ctx.fillText(pctStr, rightEdge, rowCY + 23);
    const pctW = ctx.measureText(pctStr).width;
    const triW = 19;
    const triH = 15;
    const triX = rightEdge - pctW - 8 - triW;
    const triTop = rowCY + 8;
    ctx.beginPath();
    if (isUp) {
      ctx.moveTo(triX + triW / 2, triTop);
      ctx.lineTo(triX + triW, triTop + triH);
      ctx.lineTo(triX, triTop + triH);
    } else {
      ctx.moveTo(triX, triTop);
      ctx.lineTo(triX + triW, triTop);
      ctx.lineTo(triX + triW / 2, triTop + triH);
    }
    ctx.closePath();
    ctx.fill();

    // End the card fade-up wrapper; the logo lockup below does not fade.
    ctx.restore();

    // ── Sonotrade lockup below the card ──
    // A single "⚡ Sonotrade · Link in bio" image (white on transparent), centered —
    // replaces the old logo + canvas-drawn "Link in bio" text pair.
    let logo = sonotradeLogoRef.current;
    if (!logo) {
      logo = new Image();
      logo.src = '/sonotrade-link-in-bio.png';
      sonotradeLogoRef.current = logo;
    }
    const lockupY = cardY + cardH + 13;
    const winH = 39.2;
    if (logo.complete && logo.naturalWidth > 0) {
      const winW = winH * (logo.naturalWidth / logo.naturalHeight);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(logo, (CANVAS_W - winW) / 2, lockupY, winW, winH);
    }

    // Reset text defaults for subsequent draws
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  // ── Draw loop (black bg + global header + cropped video) ─────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    const v = videoRef.current;
    if (!canvas || !v) return;
    const video = v;
    const ctx = canvas.getContext('2d')!;
    let active = true;

    function draw() {
      if (!active) return;
      raf.current = requestAnimationFrame(draw);
      // Only repaint when the video actually has a frame to show. Repainting
      // black while buffering or mid-seek is what caused the black-canvas flash;
      // when not drawable we leave the last good frame (or the initial black
      // clear) in place, and the loading spinner stays up until first paint.
      if (!(video.readyState >= 2 && video.videoWidth && video.videoHeight)) {
        return;
      }
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
      {
        const { x, y, w, h } = boxRef.current;
        const { x: ox, y: oy } = videoOffsetRef.current;

        // First pass: calculate the header height without drawing
        const captionLines = overlayCaption ? countCaptionLines(ctx) : 0;

        const CAPTION_BOTTOM_OFFSET = 18;
        const headerHeight = overlayCaption
          ? BASE_HEADER_HEIGHT + CAPTION_TOP_PADDING + (captionLines * CAPTION_LINE_HEIGHT) - CAPTION_BOTTOM_OFFSET
          : BASE_HEADER_HEIGHT;

        // Header: fixed X, but Y follows the crop box (16px overlap)
        const headerY = Math.max(0, y - headerHeight + 4);
        drawHeaderOnContext({ ctx, cx: 0, cy: headerY, cw: CANVAS_W, countCaptionLinesFn: countCaptionLines });

        const vw = video.videoWidth;
        const vh = video.videoHeight;
        // Fill the target width (matches calcVideoBox); tall videos crop top/bottom.
        const scale = (VIDEO_TARGET_W / vw) * videoScaleRef.current;
        const drawW = vw * scale;
        const drawH = vh * scale;
        const dx = (CANVAS_W - drawW) / 2 + ox;
        const dy = (CANVAS_H - drawH) / 2 + oy;

        // Snapshot the exact render state for the export to reuse.
        lastRenderStateRef.current = { box: { x, y, w, h }, userScale: videoScaleRef.current, ox, oy, vw, vh };

        ctx.save();
        // Clip video to the crop box, but do NOT affect the header above
        ctx.beginPath();
        ctx.rect(x, y, w, h);
        ctx.clip();
        ctx.drawImage(video, dx, dy, drawW, drawH);
        ctx.restore();

        // Draw brand element below the video (skip for empty mode, except betonline/polymarket/index/feedforce)
        if (brand !== 'empty' || (brand === 'empty' && (tag?.toLowerCase() === 'betonline' || tag?.toLowerCase() === 'polymarket' || tag?.toLowerCase() === 'index' || tag?.toLowerCase() === 'feedforce'))) {
          if (tag?.toLowerCase() === 'feedforce') {
            // Sticker owns its gap; pass the crop's bottom edge and its width.
            drawFeedforceStickerOnContext({ ctx, bottomY: y + h, centerX: x + w / 2, maxW: w });
          } else if (brand === 'forum') {
            drawForumBannerOnContext({ ctx, boxY: y + h + 30 });
          } else if (brand === 'culturesparadox' && tag?.toLowerCase() === 'duelrocket') {
            // Overlap video by 15px (move banner up)
            drawDuelrocketBannerOnContext({ ctx, boxY: y + h - 15 });
          } else if (tag?.toLowerCase() === 'betonline') {
            // Works for both culturesparadox and empty brands
            // Overlap video by 15px (move banner up)
            drawBetonlineBannerOnContext({ ctx, boxY: y + h - 15 });
          } else if (tag?.toLowerCase() === 'polymarket') {
            // Works for both culturesparadox and empty brands
            // Overlap video by 15px (move banner up)
            drawPolymarketBannerOnContext({ ctx, boxY: y + h - 15 });
          } else if (tag?.toLowerCase() === 'index') {
            // Drive the carousel off the video clock; while paused (the default
            // preview state) fall back to wall-clock so it still animates.
            const idxTime = !video.paused && isFinite(video.currentTime)
              ? video.currentTime
              : performance.now() / 1000;
            drawIndexCarouselOnContext({ ctx, boxY: y + h + 30, timeSeconds: idxTime });
          } else if (brand !== 'empty') {
            drawMarketCardOnContext({ ctx, boxY: y + h + 30 });
          }
        }

        // A painted frame proves the video is playable — clear any stale
        // failure the load timeout flagged (no-op ref check per frame). This is
        // the recovery backstop for paths the load-effect listeners miss, e.g.
        // a failure flagged against the old URL while a refetch swapped in a
        // fresh videoSrc (new effect run), or a seek-stall recovery where
        // loadeddata/canplay already fired.
        recoverFromFailure('paint');

        // First real frame painted — clear the loading state here (gated on an
        // actual paint rather than `loadeddata`, which fired before the seek).
        if (!firstFramePaintedRef.current) {
          firstFramePaintedRef.current = true;
          setIsVideoLoading(false);
        }
      }
    }
    draw();
    return () => { active = false; cancelAnimationFrame(raf.current); };
  }, [videoSrc, overlayDisplayName, overlayHandle, overlayDate, overlayVerified, overlayCaption, videoScale, marketData, brand, overlayChange, tag, indexArtists]);

  // ── Pinch-to-zoom (wheel/trackpad + touch gestures) ──────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Handle wheel/trackpad pinch
    function onWheel(e: WheelEvent) {
      // Check if it's a pinch gesture (ctrlKey is set for trackpad pinch on most browsers)
      // Also support regular wheel for zoom
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = -e.deltaY;
        const scaleFactor = 1 + delta * 0.01;
        const newScale = Math.max(0.5, Math.min(3, videoScaleRef.current * scaleFactor));
        videoScaleRef.current = newScale;
        setVideoScale(newScale);
      }
    }

    // Handle touch pinch gestures
    let initialDistance = 0;
    let initialScale = 1;

    function getTouchDistance(touches: TouchList): number {
      if (touches.length < 2) return 0;
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      return Math.sqrt(dx * dx + dy * dy);
    }

    function onTouchStart(e: TouchEvent) {
      if (e.touches.length === 2) {
        e.preventDefault();
        initialDistance = getTouchDistance(e.touches);
        initialScale = videoScaleRef.current;
      }
    }

    function onTouchMove(e: TouchEvent) {
      if (e.touches.length === 2 && initialDistance > 0) {
        e.preventDefault();
        const currentDistance = getTouchDistance(e.touches);
        const scaleFactor = currentDistance / initialDistance;
        const newScale = Math.max(0.5, Math.min(3, initialScale * scaleFactor));
        videoScaleRef.current = newScale;
        setVideoScale(newScale);
      }
    }

    function onTouchEnd(e: TouchEvent) {
      if (e.touches.length < 2) {
        initialDistance = 0;
      }
    }

    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd);

    return () => {
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('touchstart', onTouchStart);
      canvas.removeEventListener('touchmove', onTouchMove);
      canvas.removeEventListener('touchend', onTouchEnd);
    };
  }, []);

  // ── Global mouse move / up (drag works even outside the canvas) ──────────────
  useEffect(() => {
    function applyDrag(dx: number, dy: number, shiftKey: boolean) {
      if (!drag.current) return;
      const { handle: h, sb, videoOffsetStart } = drag.current;
      const nx = sb.x, nw = sb.w;
      let ny = sb.y, nh = sb.h;

      if (h === 'move') {
        // Dragging the center pans the video under a fixed crop box
        videoOffsetRef.current = {
          x: videoOffsetStart.x + dx,
          y: videoOffsetStart.y + dy,
        };
        return;
      }

      switch (h) {
        case 'br':
          if (shiftKey) {
            nh = Math.max(MIN_DIM, sb.h + dy * 2); ny = sb.y - dy;
          } else {
            nh = Math.max(MIN_DIM, sb.h + dy);
          }
          break;
        case 'bl':
          if (shiftKey) {
            nh = Math.max(MIN_DIM, sb.h + dy * 2); ny = sb.y - dy;
          } else {
            nh = Math.max(MIN_DIM, sb.h + dy);
          }
          break;
        case 'tr':
          if (shiftKey) {
            nh = Math.max(MIN_DIM, sb.h - dy * 2); ny = sb.y + dy;
          } else {
            nh = Math.max(MIN_DIM, sb.h - dy); ny = sb.y + sb.h - nh;
          }
          break;
        case 'tl':
          if (shiftKey) {
            nh = Math.max(MIN_DIM, sb.h - dy * 2); ny = sb.y + dy;
          } else {
            nh = Math.max(MIN_DIM, sb.h - dy); ny = sb.y + sb.h - nh;
          }
          break;
        case 'tc':
          if (shiftKey) {
            nh = Math.max(MIN_DIM, sb.h - dy * 2); ny = sb.y + dy;
          } else {
            nh = Math.max(MIN_DIM, sb.h - dy); ny = sb.y + sb.h - nh;
          }
          break;
        case 'bc':
          if (shiftKey) {
            nh = Math.max(MIN_DIM, sb.h + dy * 2); ny = sb.y - dy;
          } else {
            nh = Math.max(MIN_DIM, sb.h + dy);
          }
          break;
      }

      const b = { x: nx, y: ny, w: nw, h: nh };
      boxRef.current = b;
      setBox({ ...b });
    }

    function onMove(e: MouseEvent) {
      if (!drag.current) return;
      // Convert screen-space drag delta to canvas-space by dividing to DISPLAY_SCALE
      const dx = (e.clientX - drag.current.sx) / DISPLAY_SCALE;
      const dy = (e.clientY - drag.current.sy) / DISPLAY_SCALE;
      applyDrag(dx, dy, e.shiftKey);
    }
    function onUp() { drag.current = null; }

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup',   onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup',   onUp);
    };
  }, []);

  function startDrag(e: React.MouseEvent, handle: Handle) {
    e.preventDefault();
    e.stopPropagation();
    drag.current = {
      handle,
      sx: e.clientX,
      sy: e.clientY,
      sb: { ...boxRef.current },
      videoOffsetStart: { ...videoOffsetRef.current },
    };
  }

  function resetBox() {
    const video = videoRef.current;
    if (video && video.videoWidth && video.videoHeight) {
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      // Fill the target width; very tall videos crop top/bottom (cap to canvas height).
      const drawW = VIDEO_TARGET_W;
      const drawH = Math.min(vh * (VIDEO_TARGET_W / vw), CANVAS_H);
      // Center the crop box on the canvas
      const x = (CANVAS_W - drawW) / 2;
      const y = (CANVAS_H - drawH) / 2;
      const b = { x, y, w: drawW, h: drawH };
      boxRef.current = b;
      setBox(b);
    } else {
      // Fallback if video not loaded yet
      const b = { x: 0, y: 0, w: CANVAS_W, h: CANVAS_H };
      boxRef.current = b;
      setBox(b);
    }
    videoOffsetRef.current = { x: 0, y: 0 };
    videoScaleRef.current = 1;
    setVideoScale(1);
  }

  function centerEverything() {
    // Calculate header height
    let headerHeight = BASE_HEADER_HEIGHT;
    if (overlayCaption) {
      // Use canvas context to measure text accurately
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const captionLines = countCaptionLines(ctx);
          const CAPTION_BOTTOM_OFFSET = 18;
          headerHeight = BASE_HEADER_HEIGHT + CAPTION_TOP_PADDING + (captionLines * CAPTION_LINE_HEIGHT) - CAPTION_BOTTOM_OFFSET;
        }
      }
    }

    const currentBox = boxRef.current;
    const oldY = currentBox.y;
    const cropBoxHeight = currentBox.h;

    // Market box / banner height (if present)
    const hasMarketBox = tag?.trim() && marketData && marketData.markets && marketData.markets.length > 0;
    const hasDuelrocketBanner = brand === 'culturesparadox' && tag?.toLowerCase() === 'duelrocket';
    const hasBetonlineBanner = tag?.toLowerCase() === 'betonline'; // Works for both culturesparadox and empty
    const hasPolymarketBanner = tag?.toLowerCase() === 'polymarket'; // Works for both culturesparadox and empty
    // DuelRocket: 385px height (1027 * 720/1920) minus 15px overlap = 370px effective
    // BetOnline: 152px height (2021 * 720/9603) minus 15px overlap = 137px effective
    // Polymarket: 78px height (153 * 720/1407) minus 15px overlap = 63px effective
    const hasIndexCarousel = tag?.toLowerCase() === 'index';
    // The FeedForce sticker sits below the crop, so it has to be part of the
    // balance too — otherwise Center treats the composition as if it isn't there.
    const hasFeedforceSticker = tag?.toLowerCase() === 'feedforce';
    const marketBoxHeight = hasIndexCarousel ? INDEX_BAND_RESERVE : hasFeedforceSticker ? FEEDFORCE_BAND_RESERVE : hasMarketBox ? 140 + 30 : hasDuelrocketBanner ? 385 - 15 : hasBetonlineBanner ? 152 - 15 : hasPolymarketBanner ? 78 - 15 : 0;

    // Total content height
    const totalHeight = headerHeight + cropBoxHeight + marketBoxHeight;

    // Calculate starting Y to center everything on canvas
    const startY = (CANVAS_H - totalHeight) / 2;

    // Header is positioned at startY (drawn above crop box)
    // Crop box Y = startY + headerHeight
    const newY = startY + headerHeight;

    // Calculate how much the crop box moved
    const deltaY = newY - oldY;

    // Update crop box position (keep width and x position)
    const b = { x: currentBox.x, y: newY, w: currentBox.w, h: currentBox.h };
    boxRef.current = b;
    setBox({ ...b });

    // Move video with the crop box (maintain relative position)
    videoOffsetRef.current = {
      x: videoOffsetRef.current.x,
      y: videoOffsetRef.current.y + deltaY
    };
  }

  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      v.play();
      setIsPlaying(true);
    } else {
      v.pause();
      setIsPlaying(false);
    }
  }

  // ── Handle positions ─────────────────────────────────────────────────────────
  const handles: { type: Handle; cx: number; cy: number }[] = [
    { type: 'tl', cx: box.x * DISPLAY_SCALE,           cy: box.y * DISPLAY_SCALE           },
    { type: 'tc', cx: (box.x + box.w / 2) * DISPLAY_SCALE, cy: box.y * DISPLAY_SCALE       },
    { type: 'tr', cx: (box.x + box.w) * DISPLAY_SCALE,   cy: box.y * DISPLAY_SCALE         },
    { type: 'bl', cx: box.x * DISPLAY_SCALE,           cy: (box.y + box.h) * DISPLAY_SCALE },
    { type: 'bc', cx: (box.x + box.w / 2) * DISPLAY_SCALE, cy: (box.y + box.h) * DISPLAY_SCALE },
    { type: 'br', cx: (box.x + box.w) * DISPLAY_SCALE,   cy: (box.y + box.h) * DISPLAY_SCALE },
  ];

  // ── Professional export: demux → decode → render → encode → mux ──────────────────
  async function startRecording(): Promise<void> {
    const canvas = canvasRef.current;
    const video = videoRef.current;

    if (!canvas || !video || isRecordingSyncRef.current) {
      throw new Error('Cannot start recording');
    }

    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    const signal = abortController.signal;

    // Decoded media is GPU-backed and MUST be released on every exit path. A
    // failed export that leaks VideoFrames (or leaves an errored decoder open)
    // exhausts the browser's decoder pool and cascades into generic "Decoding
    // error" failures for every later export in a bulk run — so these live
    // outside the try, and the finally sweeps whatever a failure left behind.
    const decodedFrames: Array<{ frame: VideoFrame; timestamp: number }> = [];
    let decodedAudioSamples: MbAudioSample[] = [];
    let activeDecoder: VideoDecoder | null = null;
    // The mediabunny Output owns WebCodecs encoders; a throw between start()
    // and finalize() must cancel() it or they leak just like decoder frames.
    let activeOutput: { state: string; cancel: () => Promise<unknown> } | null = null;

    isRecordingSyncRef.current = true;
    setIsRecording(true);
    setRecProgress(0);
    setRecStatus('Initializing...');
    console.log('[startRecording] Starting professional MP4 export...');

    try {
      // Import libraries dynamically
      const mediabunny = await import('mediabunny');

      const {
        Output,
        Mp4OutputFormat,
        BufferTarget,
        VideoSample,
        VideoSampleSource,
        AudioSampleSource,
        AudioSampleSink,
        EncodedAudioPacketSource,
        EncodedPacketSink,
        Input,
        BlobSource,
        ALL_FORMATS,
        QUALITY_HIGH,
      } = mediabunny;

      console.log('[startRecording] MP4Box:', MP4Box);
      const MP4BoxFile = MP4Box.createFile();
      console.log('[startRecording] MP4BoxFile created:', MP4BoxFile);

      // Get the video URL - try to get the original URL from videoSrc prop
      // The proxy URL (/api/video-reels/proxy?stream=1&...) doesn't work well with mp4box
      const videoSrc = video.src || video.currentSrc;

      // Extract the original URL from the proxy URL
      let videoUrl = videoSrc;
      if (videoSrc.includes('/api/video-reels/proxy')) {
        try {
          const urlParam = new URL(videoSrc, window.location.origin).searchParams.get('url');
          if (urlParam) {
            videoUrl = decodeURIComponent(urlParam);
            console.log('[startRecording] Using original URL instead of proxy');
          }
        } catch (e) {
          console.warn('[startRecording] Could not extract original URL from proxy URL');
        }
      }

      if (!videoUrl) {
        throw new Error('No video source URL available');
      }

      console.log('[startRecording] Video URL:', videoUrl);
      setRecStatus('Downloading video file...');

      // Fetch the video bytes. For each candidate URL try the direct CDN fetch
      // first (mp4box-friendly), then the proxy (which adds the Referer/UA the
      // TikTok CDN requires) if the direct fetch is hotlink-rejected (403). Each
      // source gets one quick retry, validates a non-empty/untruncated body, and
      // respects the export abort signal.
      let lastFetchError: unknown = null;
      const buildByteSources = (raw: string): string[] =>
        raw.startsWith('/api/video-reels/proxy')
          ? [raw]
          : [raw, `/api/video-reels/proxy?stream=1&url=${encodeURIComponent(raw)}`];

      const tryFetchBytes = async (sources: string[]): Promise<ArrayBuffer | null> => {
        for (const src of sources) {
          for (let attempt = 0; attempt < 2; attempt++) {
            if (signal.aborted) throw new Error('Cancelled');
            try {
              const response = await fetch(src, { signal });
              if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
              const buf = await response.arrayBuffer();
              if (buf.byteLength === 0) throw new Error('Empty video body');
              const expected = Number(response.headers.get('Content-Length') || 0);
              if (expected > 0 && buf.byteLength < expected) {
                throw new Error(`Truncated video body (${buf.byteLength}/${expected} bytes)`);
              }
              console.log('[startRecording] Video fetched, size:', buf.byteLength, src.startsWith('/api/video-reels/proxy') ? '(via proxy)' : '(direct)');
              return buf;
            } catch (fetchError) {
              // Propagate a real cancellation immediately; otherwise record and retry.
              if (signal.aborted || (fetchError as { name?: string } | null)?.name === 'AbortError') throw fetchError;
              lastFetchError = fetchError;
              console.warn('[startRecording] Byte fetch failed', { via: src.startsWith('/api/video-reels/proxy') ? 'proxy' : 'direct', attempt }, fetchError);
              if (attempt === 0) await new Promise((r) => setTimeout(r, 400));
            }
          }
        }
        return null;
      };

      let arrayBuffer: ArrayBuffer | null = await tryFetchBytes(buildByteSources(videoUrl));

      // If every source failed, the signed CDN token has likely expired (the
      // proxy can't re-sign it). Re-mint a fresh URL once and retry — this is the
      // primary recovery for "the link works but fetch fails" at export time.
      if (!arrayBuffer && onRefetchSrcRef.current) {
        console.warn('[startRecording] All byte sources failed — re-minting a fresh URL and retrying');
        try {
          const fresh = await onRefetchSrcRef.current();
          if (typeof fresh === 'string' && fresh) {
            videoUrl = fresh;
            arrayBuffer = await tryFetchBytes(buildByteSources(fresh));
          }
        } catch (e) {
          console.error('[startRecording] Re-mint failed:', e);
        }
      }

      if (!arrayBuffer) {
        console.error('[startRecording] Fetch error:', lastFetchError);
        throw new Error(`Failed to download video: ${lastFetchError instanceof Error ? lastFetchError.message : 'Unknown error'}`);
      }

      // Demux with mp4box.js
      setRecStatus('Parsing video file...');
      console.log('[startRecording] Demuxing with mp4box...');

      // Set up sample tracking
      const videoSamples: Array<{ data: Uint8Array; timestamp: number; duration: number; isKeyframe: boolean }> = [];
      const audioSamples: Array<{ data: Uint8Array; timestamp: number; duration: number }> = [];
      let videoTrackId: number | null = null;
      let audioTrackId: number | null = null;
      let videoTimescale = 90000;
      let audioTimescale = 44100;
      // Real codec + coded dimensions parsed from the track. The decoder used to
      // be hardcoded to avc1.64001F / 1080x1920, which silently produced a black
      // video for any other format; we now derive these from the actual track.
      let videoCodec = '';
      let videoCodedWidth = 0;
      let videoCodedHeight = 0;
      const samplesReady = false;
      let audioDecoderConfig: Uint8Array | null = null; // AAC AudioSpecificConfig

      // Set up mp4box callbacks
      MP4BoxFile.onReady = (info: MP4BoxMovieInfo) => {
        console.log('[startRecording] MP4 onReady - info:', info);
        setRecStatus('Parsing video file...');

        // Find video and audio tracks
        for (const track of info.tracks || []) {
          console.log('[startRecording] Track:', track.id, track.codec, track.type);
          if (track.type === 'video' && !videoTrackId) {
            videoTrackId = track.id;
            videoTimescale = track.timescale || 90000;
            // Capture the REAL codec + dimensions so the decoder isn't pinned to
            // 1080x1920/High-profile (the cause of black exports for other formats).
            videoCodec = track.codec || '';
            videoCodedWidth = track.video?.width || track.track_width || 0;
            videoCodedHeight = track.video?.height || track.track_height || 0;
            console.log('[startRecording] Track video codec/dims:', videoCodec, `${videoCodedWidth}x${videoCodedHeight}`);
          }
          if (track.type === 'audio' && !audioTrackId) {
            audioTrackId = track.id;
            audioTimescale = track.timescale || 44100;
          }
        }

        console.log('[startRecording] Video track ID:', videoTrackId, 'Audio track ID:', audioTrackId);

        // Extract AAC AudioSpecificConfig from audio track
        if (audioTrackId) {
          try {
            const audioSampleDescs = MP4BoxFile.getSampleDescription(audioTrackId);
            console.log('[startRecording] Audio sample descriptions:', audioSampleDescs);
            if (audioSampleDescs && audioSampleDescs[0]) {
              const desc = audioSampleDescs[0];
              // Log all properties of the description for debugging
              console.log('[startRecording] Audio desc keys:', Object.keys(desc));
              console.log('[startRecording] Audio desc:', desc);

              // Try different paths to find the AudioSpecificConfig
              if (desc.esds) {
                console.log('[startRecording] esds keys:', Object.keys(desc.esds));
                console.log('[startRecording] esds:', desc.esds);

                // Try esds.ESDescriptor.decConfigDescr.decSpecificInfo
                if (desc.esds.ESDescriptor && desc.esds.ESDescriptor.decConfigDescr) {
                  const decConfig = desc.esds.ESDescriptor.decConfigDescr;
                  if (decConfig.decSpecificInfo && decConfig.decSpecificInfo.data) {
                    audioDecoderConfig = new Uint8Array(decConfig.decSpecificInfo.data);
                    console.log('[startRecording] AAC AudioSpecificConfig extracted from decSpecificInfo, length:', audioDecoderConfig.length);
                  }
                  else if (decConfig.decSpecificInfo) {
                    audioDecoderConfig = new Uint8Array(decConfig.decSpecificInfo);
                    console.log('[startRecording] AAC AudioSpecificConfig extracted (direct), length:', audioDecoderConfig.length);
                  }
                }

                // Fallback: try esds.descriptor directly
                if (!audioDecoderConfig && desc.esds.descriptor) {
                  audioDecoderConfig = new Uint8Array(desc.esds.descriptor);
                  console.log('[startRecording] AAC AudioSpecificConfig extracted from descriptor, length:', audioDecoderConfig.length);
                }

                // Another fallback: try esds.data
                if (!audioDecoderConfig && desc.esds.data) {
                  audioDecoderConfig = new Uint8Array(desc.esds.data);
                  console.log('[startRecording] AAC AudioSpecificConfig extracted from esds.data, length:', audioDecoderConfig.length);
                }
              }

              // Last resort: try to find any buffer-like property
              if (!audioDecoderConfig) {
                for (const key in desc) {
                  const val = desc[key];
                  if (val && (val instanceof Uint8Array || (val.buffer && val.buffer instanceof ArrayBuffer))) {
                    audioDecoderConfig = new Uint8Array(val);
                    console.log('[startRecording] AAC AudioSpecificConfig extracted from', key, ', length:', audioDecoderConfig.length);
                    break;
                  }
                }
              }

              if (!audioDecoderConfig) {
                console.warn('[startRecording] Could not extract AAC AudioSpecificConfig, will use default');
                // Use a default AAC-LC AudioSpecificConfig for 44.1kHz stereo
                // This is [0x11, 0x90] = AAC-LC, 44.1kHz, stereo
                audioDecoderConfig = new Uint8Array([0x11, 0x90]);
                console.log('[startRecording] Using default AAC AudioSpecificConfig');
              }
            }
          } catch (e) {
            console.warn('[startRecording] Failed to extract audio decoder config:', e);
            // Use default as fallback
            audioDecoderConfig = new Uint8Array([0x11, 0x90]);
            console.log('[startRecording] Using default AAC AudioSpecificConfig after error');
          }
        }

        // Start extracting samples
        if (videoTrackId) {
          MP4BoxFile.setExtractionOptions(videoTrackId, null, { nbSamples: Infinity });
        }
        if (audioTrackId) {
          MP4BoxFile.setExtractionOptions(audioTrackId, null, { nbSamples: Infinity });
        }
        MP4BoxFile.start();
      };

      MP4BoxFile.onSamples = (id: number, user: unknown, samples: MP4BoxSample[]) => {
        console.log('[startRecording] onSamples called - track ID:', id, 'sample count:', samples.length);
        if (id === videoTrackId) {
          for (const sample of samples) {
            // sample.data is already a Uint8Array in mp4box
            videoSamples.push({
              data: new Uint8Array(sample.data), // Clone to prevent reference issues
              timestamp: sample.cts / videoTimescale,
              duration: sample.duration / videoTimescale,
              isKeyframe: sample.is_sync,
            });
          }
          console.log('[startRecording] Video samples total:', videoSamples.length);
        }
        if (id === audioTrackId) {
          for (const sample of samples) {
            // sample.data is already a Uint8Array in mp4box
            audioSamples.push({
              data: new Uint8Array(sample.data), // Clone to prevent reference issues
              timestamp: sample.cts / audioTimescale,
              duration: sample.duration / audioTimescale,
            });
          }
          console.log('[startRecording] Audio samples total:', audioSamples.length);
        }
      };

      // Append the buffer and parse
      console.log('[startRecording] Appending buffer to mp4box...');
      const arrayBufferCopy = arrayBuffer.slice(0);

      // Check file header to see if it's a valid MP4
      const header = new Uint8Array(arrayBufferCopy.slice(0, 12));
      console.log('[startRecording] File header:', Array.from(header).map(b => b.toString(16).padStart(2, '0')).join(' '));
      // MP4 files start with FTYP box (usually 00 00 00 XX 66 74 79 70)

      // Set up error handler for mp4box
      MP4BoxFile.onError = (error: unknown) => {
        console.error('[startRecording] MP4Box error:', error);
      };

      try {
        // mp4box requires the buffer to have a fileStart property
        (arrayBufferCopy as ArrayBuffer & { fileStart: number }).fileStart = 0;
        const offset = MP4BoxFile.appendBuffer(arrayBufferCopy);
        console.log('[startRecording] appendBuffer returned offset:', offset);

        console.log('[startRecording] Calling flush...');
        MP4BoxFile.flush();

        console.log('[startRecording] Flush completed, waiting for onReady callback...');
      } catch (e) {
        console.error('[startRecording] Error during mp4box append/flush:', e);
        throw new Error(`MP4 parsing error: ${e instanceof Error ? e.message : 'Unknown error'}`);
      }

      // Wait for samples to be extracted (with timeout)
      console.log('[startRecording] Waiting for sample extraction...');
      const maxWaitTime = 10000; // 10 seconds
      const startTime = Date.now();

      await new Promise<void>((resolve, reject) => {
        const checkInterval = setInterval(() => {
          const elapsed = Date.now() - startTime;
          if (videoSamples.length > 0) {
            clearInterval(checkInterval);
            console.log('[startRecording] Samples extracted successfully');
            resolve();
          } else if (elapsed > maxWaitTime) {
            clearInterval(checkInterval);
            reject(new Error('Timeout waiting for video samples extraction. The video format may not be supported.'));
          }
        }, 100);
      });

      console.log('[startRecording] Video samples extracted:', videoSamples.length);
      console.log('[startRecording] Audio samples extracted:', audioSamples.length);

      if (videoSamples.length === 0) {
        throw new Error('No video samples found in file - the video may be corrupted or in an unsupported format');
      }

      // Calculate export parameters
      const lastVideoSample = videoSamples[videoSamples.length - 1];
      const videoDuration = lastVideoSample.timestamp + lastVideoSample.duration;
      // Match the SOURCE frame rate rather than resampling everything to 30. A 60fps
      // reel kept all its motion detail instead of having half its frames thrown
      // away, and a 24/25fps source stops juddering from uneven duplication into 30.
      // Clamped to [24, 60]: 60 is Reels' ceiling, and below 24 the frame-duplication
      // cost isn't worth it. Falls back to 30 if the measurement looks implausible.
      const measuredFps = videoDuration > 0 ? videoSamples.length / videoDuration : 0;
      const outputFps = measuredFps >= 10 && measuredFps <= 65
        ? Math.min(60, Math.max(24, Math.round(measuredFps)))
        : 30;
      const totalFrames = Math.floor(videoDuration * outputFps);
      const frameDuration = 1 / outputFps;

      console.log('[startRecording] Video duration:', videoDuration, 'sourceFps:', measuredFps.toFixed(2), 'outputFps:', outputFps, 'totalFrames:', totalFrames);

      setRecStatus('Decoding video...');

      // Set up video decoder (decodedFrames lives above the try so the finally
      // can release frames on any failure path)
      let decodeIndex = 0;

      let decodeError: Error | null = null;
      const decoder = new VideoDecoder({
        output: (frame: VideoFrame) => {
          decodedFrames.push({ frame, timestamp: frame.timestamp / 1_000_000 });
          decodeIndex++;
        },
        error: (e: Error) => {
          console.error('[VideoDecoder] error:', e);
          // Remember the failure so we can abort instead of emitting black frames.
          decodeError = e;
        },
      });
      activeDecoder = decoder;

      // Get the video track to extract codec description
      const videoTrack = MP4BoxFile.getTrackById(videoTrackId);
      console.log('[startRecording] Video track:', videoTrack);
      // Log all properties of videoTrack
      for (const key in videoTrack) {
        try {
          console.log('[startRecording] videoTrack.' + key + ':', typeof videoTrack[key]);
        } catch (e) {}
      }

      // Try to get the AVC decoder configuration record
      let description: Uint8Array | undefined;

      // Method 1: Try mp4box's getSampleDescription
      if (typeof MP4BoxFile.getSampleDescription === 'function') {
        const sampleDescriptions = MP4BoxFile.getSampleDescription(videoTrackId);
        console.log('[startRecording] Sample descriptions:', sampleDescriptions);
        if (sampleDescriptions && sampleDescriptions[0]) {
          console.log('[startRecording] Sample desc[0]:', sampleDescriptions[0]);
          // avcC for H.264 sources, hvcC for HEVC (hvc1/hev1 — Instagram serves
          // many reels as HEVC). Same extraction rules apply to both boxes.
          const descBox = sampleDescriptions[0].avcC ?? sampleDescriptions[0].hvcC;
          description = descBox?.config || descBox;
        }
      }

      // Method 2: Try accessing through track structure (stsd entries)
      if (!description) {
        try {
          const stsd = videoTrack?.mdia?.minf?.stbl?.stsd;
          console.log('[startRecording] stsd:', stsd);
          const entries = stsd?.entries;
          console.log('[startRecording] stsd.entries:', entries);
          if (entries && entries[0]) {
            // HEVC sample entries carry hvcC instead of avcC; every extraction
            // path below (config / subarray / raw start+size slice past the
            // 8-byte box header) is box-agnostic, so reuse them unchanged.
            const avcC = entries[0].avcC ?? entries[0].hvcC;
            if (avcC) {
              console.log('[startRecording] avcC.config:', avcC.config);
              console.log('[startRecording] avcC.data:', avcC.data);
              console.log('[startRecording] avcC.size:', avcC.size);
              console.log('[startRecording] avcC.start:', avcC.start);
              console.log('[startRecording] avcC.fileStart:', avcC.fileStart);
              console.log('[startRecording] avcC.hdr_size:', avcC.hdr_size);
              console.log('[startRecording] avcC.subarray:', typeof avcC.subarray);

              // The config is typically a Uint8Array stored in avcC.config
              if (avcC.config && avcC.config.length > 0) {
                description = new Uint8Array(avcC.config);
                console.log('[startRecording] Got config from avcC.config, length:', description.length);
              }
              // Try using subarray if available
              else if (typeof avcC.subarray === 'function') {
                description = avcC.subarray();
                if (description) {
                  console.log('[startRecording] Got config from avcC.subarray, length:', description.length);
                }
              }
              // If avcC has a start position and size, read from original buffer
              else if (typeof avcC.start !== 'undefined' && avcC.size) {
                const start = avcC.start;
                const size = avcC.size;
                // The start position includes the 8-byte box header (4 bytes size + 4 bytes type "avcC")
                // The actual AVC decoder configuration record starts after the header
                // We need to skip the 8-byte header to get the actual config
                const headerSize = 8;
                const configStart = start + headerSize;
                const configSize = size - headerSize;
                const configData = new Uint8Array(arrayBuffer, configStart, configSize);
                description = configData;
                console.log('[startRecording] Got config from raw buffer at', configStart, 'size', configSize, 'length:', description.length);
                console.log('[startRecording] Config data (first 20 bytes):', Array.from(description.slice(0, Math.min(20, description.length))).map(b => b.toString(16).padStart(2, '0')).join(' '));
              }
            }
          }
        } catch (e) {
          console.log('[startRecording] Error accessing stsd:', e);
        }
      }

      // Method 3: Try description property on codec
      if (!description) {
        description = videoTrack?.codec?.description;
      }

      console.log('[startRecording] AVC decoder config:', description ? 'found, length=' + description.length : 'not found');

      // If still no description, try to extract from the first sample's data
      // The AVC decoder configuration is often at the beginning of H.264 streams
      if (!description) {
        console.log('[startRecording] Trying to extract description from samples...');
        // Find first keyframe sample
        const firstKeyframe = videoSamples.find(s => s.isKeyframe);
        if (firstKeyframe) {
          // The AVC decoder configuration record starts with 0x00 0x00 0x00 0x01 followed by SPS
          // Let's try to find it in the sample data
          const data = firstKeyframe.data;
          console.log('[startRecording] First keyframe data (first 20 bytes):', Array.from(data.slice(0, 20)).map(b => b.toString(16).padStart(2, '0')).join(' '));
        }
      }

      // Configure decoder with the proper codec string and description
      // The codec is avc1.64001f which means H.264 High Profile Level 3.1
      const decoderConfig: VideoDecoderConfig = {
        // Use the real codec + dimensions parsed from the track; fall back to the
        // previous hardcoded H.264 High@3.1 / 1080x1920 only when unknown.
        codec: videoCodec || 'avc1.64001F',
        codedWidth: videoCodedWidth || 1080,
        codedHeight: videoCodedHeight || 1920,
        // description is required for AVC H.264
        description: description,
        // Software decode preferred, same reason as the encoder below: the macOS
        // hardware (VideoToolbox) codec pool caps at ~64 sessions, and a bulk run
        // creates a fresh source decoder every export. On hardware that pool fills
        // and every export past ~64 fails with "Decoding error". Software keeps an
        // export at zero hardware sessions for H.264 sources; HEVC falls back to
        // hardware below. (The <video> preview elements still use hardware decode.)
        hardwareAcceleration: 'prefer-software',
      };
      console.log('[startRecording] Decoder config:', decoderConfig.codec, `${decoderConfig.codedWidth}x${decoderConfig.codedHeight}`);

      let isSupported = await VideoDecoder.isConfigSupported(decoderConfig);
      // prefer-software is a batch-size guard, not a requirement. Chrome ships NO
      // software decoder for HEVC (hvc1/hev1 — licensing), so Instagram's HEVC
      // renditions report unsupported here even though the machine decodes them
      // fine in hardware — this failed 28 of 75 rows in one real batch. Retry
      // without the software pin before giving up. Pool-safety holds: the source
      // decoder is closed right after flush(), before the next row allocates, so
      // its hardware session never accumulates (the ~64-session exhaustion bug was
      // the ENCODER's, whose sessions leaked one per export — it stays software).
      if (!isSupported.supported) {
        const hwConfig: VideoDecoderConfig = { ...decoderConfig, hardwareAcceleration: 'no-preference' };
        const hwSupported = await VideoDecoder.isConfigSupported(hwConfig);
        console.log('[startRecording] prefer-software unsupported; retry with no-preference →', hwSupported.supported);
        if (hwSupported.supported) {
          decoderConfig.hardwareAcceleration = 'no-preference';
          isSupported = hwSupported;
        }
      }
      console.log('[startRecording] Decoder config supported:', isSupported.supported);
      // Don't proceed with an unsupported config — that path silently yields a
      // black video. Fail with an actionable error instead.
      if (!isSupported.supported) {
        if (decoder.state !== 'closed') decoder.close();
        const err = new Error(
          `This video can't be exported: its format isn't supported by your browser (codec ${decoderConfig.codec}, ${decoderConfig.codedWidth}x${decoderConfig.codedHeight}).`
        );
        // Deterministic failure — same input, same result. Named so the bulk
        // exporter can skip its retry pass instead of re-rendering a doomed row.
        err.name = 'UnsupportedFormatError';
        throw err;
      }

      decoder.configure(decoderConfig);

      // Decode all video samples
      for (let i = 0; i < videoSamples.length; i++) {
        if (signal.aborted) {
          if (decoder.state !== 'closed') decoder.close();
          throw new Error('Cancelled');
        }
        // A fatal decode error closes the codec from its error callback — stop
        // feeding samples instead of throwing "decode on a closed codec".
        if (decodeError || decoder.state === 'closed') break;

        const sample = videoSamples[i];
        const chunk = new EncodedVideoChunk({
          type: sample.isKeyframe ? 'key' : 'delta',
          timestamp: sample.timestamp * 1_000_000,
          data: sample.data,
        });

        await decoder.decode(chunk);
        setRecProgress(0.1 + (i / videoSamples.length) * 0.3);
      }

      try {
        await decoder.flush();
      } catch (e) {
        // A decode error rejects flush(); capture it so we surface the friendly
        // message below instead of the raw WebCodecs rejection.
        if (!decodeError) decodeError = e as Error;
      }
      // A fatal decode error auto-closes the codec; closing again throws
      // InvalidStateError and would mask the real failure below.
      if (decoder.state !== 'closed') decoder.close();

      console.log('[startRecording] Decoded frames:', decodedFrames.length);

      // Fail loudly instead of silently exporting a black video when decoding
      // errored or produced no frames (e.g. an unsupported codec/profile).
      if (decodeError || decodedFrames.length === 0) {
        // Release any frames already decoded before bailing out.
        for (const { frame } of decodedFrames) {
          try { frame.close(); } catch {}
        }
        if (decodeError) {
          throw new Error(
            `Video decoding failed (${(decodeError as Error).message || 'unknown error'}). The video format may be unsupported.`
          );
        }
        throw new Error('No video frames could be decoded — refusing to export a black video. The video format is likely unsupported.');
      }

      setRecStatus('Preparing audio...');

      // Create Mediabunny output
      const output = new Output({
        format: new Mp4OutputFormat(),
        target: new BufferTarget(),
      });
      activeOutput = output;

      // Bitrate is quality-first, not size-first.
      //
      // This used to back a bitrate out of a 7 MB file target, justified as "Meta's
      // hidden ~10 MB upload cap". No such cap applies here: we never POST the bytes
      // to Meta — the export goes to Vercel Blob (100 MB ceiling, see
      // /api/video-reels/upload) and the publish route hands Graph a `video_url` it
      // fetches itself, against a documented ~1 GB Reels limit. The 7 MB target was
      // starving anything over ~20s (a 60s reel got ~0.85 Mbps at 1080x1920, a 90s
      // one ~0.5 Mbps) — visibly soft and blocky in motion.
      //
      // Now: target a flat high bitrate for 1080x1920 and only fall back to a
      // size-derived number if a clip is long enough to threaten the Blob ceiling.
      // Handing Instagram a high-quality source also gives ITS re-encode better
      // material to work from, which is most of what viewers actually see.
      const TARGET_BITRATE_30FPS = 8_000_000;
      // Blob's hard limit is 100 MB; leave headroom for audio + muxing overhead.
      const MAX_TOTAL_BYTES = 85 * 1024 * 1024;
      const AUDIO_BITRATE_BPS = 192_000;
      // More frames need proportionally more bits to hold the same quality.
      const qualityBitrate = Math.round(TARGET_BITRATE_30FPS * (outputFps / 30));
      const sizeCeilingBitrate = Math.floor((MAX_TOTAL_BYTES * 8) / videoDuration - AUDIO_BITRATE_BPS);
      // Never let the ceiling push us below the old behaviour's best case.
      const videoBitrate = lowBitrate
        ? 1_500_000
        : Math.max(5_000_000, Math.min(qualityBitrate, sizeCeilingBitrate));
      console.log('[startRecording] Video bitrate:', videoBitrate, 'bps @', outputFps, 'fps (lowBitrate=' + lowBitrate + ')');

      const videoSource = new VideoSampleSource({
        codec: 'avc',
        bitrate: videoBitrate,
        // Force the H.264 ENCODER onto a software codec. On macOS the hardware
        // VideoToolbox pool caps at ~64 concurrent sessions, and a fresh encoder
        // is created every export whose session isn't reclaimed before the next
        // row starts — so a bulk run of >64 reels exhausts the pool and every
        // later export fails with a decode error (the decoder is the first
        // hardware-video allocation of the next row, so it's what gets refused).
        // Software encoders aren't gated by that ceiling. The source DECODER
        // stays on hardware: it's closed seconds before the next row allocates,
        // so it never accumulates. (mediabunny forwards this to VideoEncoderConfig.)
        hardwareAcceleration: 'prefer-software',
      });
      output.addVideoTrack(videoSource);

      // Set up audio track BEFORE starting output.
      //
      // Audio strategy:
      //   - If source is already AAC-LC (e.g., Instagram), do PASSTHROUGH — fast and lossless,
      //     and avoids the AAC-encoder priming/edit-list pitfalls that some IG uploads tripped on.
      //   - If source is HE-AAC / HE-AACv2 (e.g., many TikTok clips), DECODE → RE-ENCODE to AAC-LC.
      //     IG Reels rejects HE-AAC profiles outright, so we have no choice there.
      // `audioMode` is the discriminant that says which of the two sources this holds.
      let audioSource: MbEncodedAudioPacketSource | MbAudioSampleSource | null = null;
      decodedAudioSamples = [];
      let passthroughPackets: MbEncodedPacket[] = [];
      let passthroughDecoderConfig: AudioDecoderConfig | null = null;
      let audioMode: 'passthrough' | 'reencode' | null = null;

      if (stripAudio) {
        console.log('[startRecording] stripAudio=true — skipping audio entirely (debug)');
      }

      if (!stripAudio && audioSamples.length > 0) {
        console.log('[startRecording] Setting up audio...');

        // Hoisted so the finally can dispose it: an undisposed Input retains its
        // demuxer + the ~7 MB source blob every export, a real leak across a bulk run.
        let input: MbInput | null = null;
        try {
          const videoBlob = await fetch(videoSrc).then(r => r.blob());

          input = new Input({
            source: new BlobSource(videoBlob),
            formats: ALL_FORMATS,
          });

          const audioTrack = await input.getPrimaryAudioTrack();

          if (audioTrack) {
            const decoderConfig = await audioTrack.getDecoderConfig();
            // Read AAC AudioObjectType from AudioSpecificConfig (top 5 bits of first byte).
            // 2 = AAC-LC, 5 = HE-AAC (SBR), 29 = HE-AACv2 (PS).
            let aot: number | null = null;
            if (decoderConfig?.description) {
              const desc = decoderConfig.description as ArrayBuffer | ArrayBufferView;
              const u8 = desc instanceof ArrayBuffer
                ? new Uint8Array(desc)
                : new Uint8Array(desc.buffer, desc.byteOffset, desc.byteLength);
              if (u8.length > 0) aot = u8[0] >> 3;
            }
            console.log('[startRecording] Source AAC AudioObjectType:', aot);

            if (aot === 2) {
              // AAC-LC: passthrough. Preserves byte-exact encoded audio.
              audioMode = 'passthrough';
              passthroughDecoderConfig = decoderConfig;
              audioSource = new EncodedAudioPacketSource('aac');
              output.addAudioTrack(audioSource);

              const sink = new EncodedPacketSink(audioTrack);
              for await (const packet of sink.packets()) {
                passthroughPackets.push(packet);
              }
              console.log('[startRecording] Passthrough: collected', passthroughPackets.length, 'AAC-LC packets');

              const firstTs = passthroughPackets[0]?.timestamp ?? 0;
              if (firstTs !== 0) {
                // mediabunny declares EncodedPacket.timestamp readonly; the rebase has
                // always written it in place, so cast rather than change the behaviour.
                for (const p of passthroughPackets) (p as { timestamp: number }).timestamp = p.timestamp - firstTs;
              }
              passthroughPackets = passthroughPackets.filter((p) => p.timestamp >= 0);
            } else {
              // HE-AAC / HE-AACv2 / unknown: re-encode to AAC-LC for IG compatibility.
              audioMode = 'reencode';
              audioSource = new AudioSampleSource({
                codec: 'aac',
                bitrate: AUDIO_BITRATE_BPS,
              });
              output.addAudioTrack(audioSource);

              const sink = new AudioSampleSink(audioTrack);
              for await (const sample of sink.samples()) {
                decodedAudioSamples.push(sample);
              }
              console.log('[startRecording] Re-encode: decoded', decodedAudioSamples.length, 'audio samples');

              const firstTs = decodedAudioSamples[0]?.timestamp ?? 0;
              if (firstTs !== 0) {
                for (const s of decodedAudioSamples) s.setTimestamp(s.timestamp - firstTs);
              }
              decodedAudioSamples = decodedAudioSamples.filter((s) => s.timestamp >= 0);
            }
          }
        } catch (audioError) {
          console.error('[startRecording] Audio setup failed:', audioError);
        } finally {
          // Free the demuxer + source blob every export (never disposed otherwise).
          try { input?.dispose(); } catch { /* already disposed */ }
        }
      }

      // Audio-loss tripwire. The catch above deliberately never fails an export
      // (a silent reel beats a dead row mid-batch), but that made the degrade
      // INVISIBLE: mp4box demuxed audio samples, mediabunny couldn't, and the
      // only evidence was a console line while a muted reel went into the zip.
      // Report the outcome to the parent on every export — true only when the
      // source HAS audio and none of it survived into the output.
      const audioLost = !stripAudio && audioSamples.length > 0 &&
        (!audioSource || (audioMode === 'passthrough' ? passthroughPackets.length === 0 : decodedAudioSamples.length === 0));
      if (audioLost) console.warn('[startRecording] Source has audio but none made it into the export — the file will be SILENT');
      onAudioLost?.(audioLost);

      setRecStatus('Rendering frames...');

      await output.start();

      // Force the Chirp caption font to load before rendering. It's a font-display:swap
      // @font-face used only on the canvas (never in the DOM), so it isn't guaranteed to be
      // resolved yet — without this the offscreen render falls back to a wider font, which
      // re-wraps the caption (extra lines → header grows → caption drifts up off the video).
      // load() actually triggers the download; fonts.ready alone wouldn't.
      try { await document.fonts.load('400 42px Chirp'); } catch { /* fall back silently */ }

      // Create offscreen canvas for rendering
      const offscreenCanvas = new OffscreenCanvas(CANVAS_W, CANVAS_H);
      const offscreenCtx = offscreenCanvas.getContext('2d')!;
      // Every source frame is resampled on the way in (a 1080-wide reel is drawn at
      // VIDEO_TARGET_W = 1000, and user zoom scales it further). The 2D default is
      // 'low', a cheap bilinear filter that visibly softens and aliases fine detail
      // — text in the source video especially. The preview canvas never looked this
      // way for the logo draw, so the export was strictly worse than what the user
      // approved on screen.
      offscreenCtx.imageSmoothingEnabled = true;
      offscreenCtx.imageSmoothingQuality = 'high';

      // Log for debugging
      if (decodedFrames.length > 0) {
        const firstFrame = decodedFrames[0].frame;
        console.log('[startRecording] First frame dimensions:', firstFrame.codedWidth, 'x', firstFrame.codedHeight);
      }

      // Render and encode each output frame
      for (let frameIdx = 0; frameIdx < totalFrames; frameIdx++) {
        if (signal.aborted) {
          await output.finalize();
          throw new Error('Cancelled');
        }

        const targetTimestamp = frameIdx * frameDuration;

        // Find the nearest decoded frame
        let sourceFrame = decodedFrames[0];
        for (const f of decodedFrames) {
          if (f.timestamp <= targetTimestamp) {
            sourceFrame = f;
          } else {
            break;
          }
        }

        // Clear canvas
        offscreenCtx.clearRect(0, 0, CANVAS_W, CANVAS_H);

        // Reuse the EXACT render state from the last preview frame the user saw, so the
        // export can't diverge from the preview. Fall back to live refs only if the preview
        // never rendered (e.g. a headless/queued export).
        const snap = lastRenderStateRef.current;
        const video = videoRef.current;
        const box = snap?.box ?? boxRef.current;
        const userScale = snap?.userScale ?? videoScaleRef.current;
        const ox = snap?.ox ?? videoOffsetRef.current.x;
        const oy = snap?.oy ?? videoOffsetRef.current.y;

        // Draw background (black)
        offscreenCtx.fillStyle = '#000';
        offscreenCtx.fillRect(0, 0, CANVAS_W, CANVAS_H);

        // Original video dimensions (from the same snapshot the preview drew with).
        const vw = snap?.vw ?? (video?.videoWidth || 1080);
        const vh = snap?.vh ?? (video?.videoHeight || 1920);

        // Use same scaling logic as main canvas:
        // Scale to fit VIDEO_TARGET_W (1000px) width or full canvas height
        // Fill the target width (matches calcVideoBox + preview); tall videos crop top/bottom.
        const scale = (VIDEO_TARGET_W / vw) * userScale;
        const drawW = vw * scale;
        const drawH = vh * scale;

        // Center in full canvas (not crop box), then apply offset
        const dx = (CANVAS_W - drawW) / 2 + ox;
        const dy = (CANVAS_H - drawH) / 2 + oy;

        // Draw the header FIRST, then the video on top — this matches the LIVE PREVIEW's
        // draw order. Previously the export drew the header AFTER the video, so the empty-
        // mode header's black background (which extends ~32px into the crop box) painted
        // over the top of the video, cropping it. The preview never had this because it
        // draws the video last, covering the overlap.
        // @ts-expect-error - OffscreenCanvasRenderingContext2D is compatible for our use
        const captionLines = overlayCaption ? countCaptionLines(offscreenCtx) : 0;

        const CAPTION_BOTTOM_OFFSET = 18;
        const headerHeight = overlayCaption
          ? BASE_HEADER_HEIGHT + CAPTION_TOP_PADDING + (captionLines * CAPTION_LINE_HEIGHT) - CAPTION_BOTTOM_OFFSET
          : BASE_HEADER_HEIGHT;
        const headerY = Math.max(0, box.y - headerHeight + 4);
        // @ts-expect-error - OffscreenCanvasRenderingContext2D is compatible for our use
        drawHeaderOnContext({ ctx: offscreenCtx, cx: 0, cy: headerY, cw: CANVAS_W, countCaptionLinesFn: countCaptionLines });

        // Clip and draw video to crop box (on top of the header, like the preview)
        offscreenCtx.save();
        offscreenCtx.beginPath();
        offscreenCtx.rect(box.x, box.y, box.w, box.h);
        offscreenCtx.clip();
        offscreenCtx.drawImage(sourceFrame.frame, dx, dy, drawW, drawH);
        offscreenCtx.restore();

        // Draw brand element below video (exact match with main canvas, skip for empty mode except betonline/polymarket/index/feedforce)
        if (brand !== 'empty' || (brand === 'empty' && (tag?.toLowerCase() === 'betonline' || tag?.toLowerCase() === 'polymarket' || tag?.toLowerCase() === 'index' || tag?.toLowerCase() === 'feedforce'))) {
          if (tag?.toLowerCase() === 'feedforce') {
            // Identical geometry to the preview above — WYSIWYG.
            // @ts-expect-error - OffscreenCanvasRenderingContext2D is compatible for our use
            drawFeedforceStickerOnContext({ ctx: offscreenCtx, bottomY: box.y + box.h, centerX: box.x + box.w / 2, maxW: box.w });
          } else if (brand === 'forum') {
            // @ts-expect-error - OffscreenCanvasRenderingContext2D is compatible for our use
            drawForumBannerOnContext({ ctx: offscreenCtx, boxY: box.y + box.h + 30 });
          } else if (brand === 'culturesparadox' && tag?.toLowerCase() === 'duelrocket') {
            // @ts-expect-error - OffscreenCanvasRenderingContext2D is compatible for our use
            drawDuelrocketBannerOnContext({ ctx: offscreenCtx, boxY: box.y + box.h - 15 });
          } else if (tag?.toLowerCase() === 'betonline') {
            // Works for both culturesparadox and empty brands
            // @ts-expect-error - OffscreenCanvasRenderingContext2D is compatible for our use
            drawBetonlineBannerOnContext({ ctx: offscreenCtx, boxY: box.y + box.h - 15 });
          } else if (tag?.toLowerCase() === 'polymarket') {
            // Works for both culturesparadox and empty brands
            // Overlap video by 15px (move banner up)
            // @ts-expect-error - OffscreenCanvasRenderingContext2D is compatible for our use
            drawPolymarketBannerOnContext({ ctx: offscreenCtx, boxY: box.y + box.h - 15 });
          } else if (tag?.toLowerCase() === 'index') {
            // Deterministic clock: targetTimestamp is this frame's time in seconds
            // @ts-expect-error - OffscreenCanvasRenderingContext2D is compatible for our use
            drawIndexCarouselOnContext({ ctx: offscreenCtx, boxY: box.y + box.h + 30, timeSeconds: targetTimestamp });
          } else if (brand !== 'empty') {
            // @ts-expect-error - OffscreenCanvasRenderingContext2D is compatible for our use
            drawMarketCardOnContext({ ctx: offscreenCtx, boxY: box.y + box.h + 30 });
          }
        }

        // Create VideoSample from offscreen canvas
        const sample = new VideoSample(offscreenCanvas, {
          timestamp: targetTimestamp,
          duration: frameDuration,
        });

        // close() even when add() rejects (encoder error) — the sample wraps a
        // real GPU-backed VideoFrame that would otherwise leak.
        try {
          await videoSource.add(sample);
        } finally {
          sample.close();
        }

        // Update progress
        setRecProgress(0.4 + (frameIdx / totalFrames) * 0.4);
      }

      // Clean up decoded frames
      for (const { frame } of decodedFrames) {
        frame.close();
      }

      // Mux audio according to the chosen mode.
      if (audioSource && audioMode === 'passthrough' && passthroughPackets.length > 0) {
        setRecStatus('Adding audio...');
        for (let i = 0; i < passthroughPackets.length; i++) {
          // audioMode === 'passthrough' means audioSource is the packet source and
          // passthroughDecoderConfig was set alongside it; casts only, no runtime change.
          if (i === 0) {
            await (audioSource as MbEncodedAudioPacketSource).add(passthroughPackets[i], { decoderConfig: passthroughDecoderConfig! });
          } else {
            await (audioSource as MbEncodedAudioPacketSource).add(passthroughPackets[i]);
          }
        }
        console.log('[startRecording] Audio passthrough complete');
      } else if (audioSource && audioMode === 'reencode' && decodedAudioSamples.length > 0) {
        setRecStatus('Encoding audio...');
        for (const sample of decodedAudioSamples) {
          await (audioSource as MbAudioSampleSource).add(sample);
          sample.close();
        }
        console.log('[startRecording] Audio re-encode complete');
      }

      setRecStatus('Finalizing...');
      setRecProgress(0.95);

      await output.finalize();

      console.log('[startRecording] Export complete');

      const buffer = output.target.buffer;
      if (!buffer) {
        throw new Error('No buffer received from output');
      }

      const blob = new Blob([buffer], { type: 'video/mp4' });

      const filename = `row-${String(rowNumber + 1).padStart(2, '0')}-${videoId ?? 'export'}.mp4`;

      // Call the appropriate callback based on upload mode
      const shouldUpload = isUploadMode || isUploadModeRef.current;
      console.log('[startRecording] Upload check - isUploadMode:', isUploadMode, 'isUploadModeRef.current:', isUploadModeRef.current, 'shouldUpload:', shouldUpload, 'has onUploadToInstagram:', !!onUploadToInstagram);

      if (exportBlobSinkRef.current) {
        // Bulk ZIP export — hand the blob to the exportBlob() caller and skip
        // the upload/export callbacks (the parent bundles the files itself).
        exportBlobSinkRef.current(blob);
      } else if (shouldUpload && onUploadToInstagram) {
        setRecStatus('Preparing for upload...');
        await onUploadToInstagram(blob, filename);
      } else if (onExportComplete) {
        setRecStatus('Uploading...');
        await onExportComplete(blob, filename);
      } else {
        // Download directly
        const url = URL.createObjectURL(blob);
        Object.assign(document.createElement('a'), {
          href: url,
          download: filename,
        }).click();
        URL.revokeObjectURL(url);
      }

      setRecProgress(1);
    } catch (error) {
      if (error instanceof Error && error.message !== 'Cancelled') {
        console.error('[startRecording] Export failed:', error);
        // Show error to user via status
        setRecStatus(`Error: ${error.message}`);
        // Keep the error visible for 3 seconds
        setTimeout(() => {
          setRecStatus('');
        }, 3000);
        throw error;
      }
    } finally {
      // Release any decoded media a failure path left behind — leaked frames
      // poison the decoder pool for every later export in a bulk run. Both
      // close() calls are no-ops for media already closed on the success path.
      for (const { frame } of decodedFrames) {
        try { frame.close(); } catch { /* already closed */ }
      }
      decodedFrames.length = 0;
      for (const s of decodedAudioSamples) {
        try { s.close(); } catch { /* already closed */ }
      }
      decodedAudioSamples.length = 0;
      if (activeDecoder && activeDecoder.state !== 'closed') {
        try { activeDecoder.close(); } catch { /* mid-transition */ }
      }
      // A throw after output.start() leaves mediabunny's internal WebCodecs
      // encoders open forever — cancel() force-closes them and the writer.
      if (activeOutput && activeOutput.state === 'started') {
        try { await activeOutput.cancel(); } catch { /* already closed */ }
      }
      isRecordingSyncRef.current = false;
      setIsRecording(false);
      // Reset upload mode on EVERY exit (success, failure, or cancel) — it was
      // previously only reset on success, so a failed upload render left the
      // flag set and the next plain export wrongly routed to the upload path.
      setIsUploadMode(false);
      isUploadModeRef.current = false;
      setRecProgress(0);
      setRecStatus('');

      const video = videoRef.current;
      if (video) {
        video.muted = true;
        video.pause();
        video.currentTime = 0;
        video.loop = true;
        video.playbackRate = 1.0;
      }
      abortControllerRef.current = null;
    }
  }

  function cancelRecording() {
    abortControllerRef.current?.abort();
    setIsRecording(false);
    setRecProgress(0);
    setRecStatus('');

    const video = videoRef.current;
    if (video) {
      video.muted = true;
      video.pause();
      video.currentTime = 0;
      video.playbackRate = 1.0;
      video.loop = true;
    }
  }

  function zoomIn() {
    const newScale = Math.min(3, videoScaleRef.current + 0.05);
    videoScaleRef.current = newScale;
    setVideoScale(newScale);
  }

  function zoomOut() {
    const newScale = Math.max(0.5, videoScaleRef.current - 0.05);
    videoScaleRef.current = newScale;
    setVideoScale(newScale);
  }

  return (
    <div className="flex flex-col items-center gap-4 mt-8">

      {/* Zoom controls */}
      <div className="flex items-center gap-2">
        <button
          onClick={zoomOut}
          disabled={videoScale <= 0.5}
          className="flex items-center justify-center w-8 h-8 rounded-md bg-surface-2 border border-separator text-label-secondary hover:text-label hover:border-label-quaternary transition-colors ease-out disabled:opacity-40 disabled:cursor-not-allowed"
          title="Zoom out"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/>
            <path d="M21 21l-4.35-4.35"/>
            <line x1="8" y1="11" x2="14" y2="11"/>
          </svg>
        </button>
        <span className="text-caption-sm text-label-tertiary tabular-nums w-12 text-center">{Math.round(videoScale * 100)}%</span>
        <button
          onClick={zoomIn}
          disabled={videoScale >= 3}
          className="flex items-center justify-center w-8 h-8 rounded-md bg-surface-2 border border-separator text-label-secondary hover:text-label hover:border-label-quaternary transition-colors ease-out disabled:opacity-40 disabled:cursor-not-allowed"
          title="Zoom in"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/>
            <path d="M21 21l-4.35-4.35"/>
            <line x1="11" y1="8" x2="11" y2="14"/>
            <line x1="8" y1="11" x2="14" y2="11"/>
          </svg>
        </button>
        <button
          onClick={() => {
            videoScaleRef.current = 1;
            setVideoScale(1);
          }}
          disabled={videoScale === 1}
          className="flex items-center justify-center w-8 h-8 rounded-md bg-surface-2 border border-separator text-label-secondary hover:text-label hover:border-label-quaternary transition-colors ease-out disabled:opacity-40 disabled:cursor-not-allowed"
          title="Reset zoom"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
            <path d="M3 3v5h5"/>
          </svg>
        </button>
      </div>

      {/* Outer wrapper — overflow:visible so handles can extend outside canvas bounds */}
      <div
        className="relative"
        style={{ width: CANVAS_W * DISPLAY_SCALE, height: CANVAS_H * DISPLAY_SCALE, overflow: 'visible' }}
      >

        {/* Canvas — black bg + video drawn in JS */}
        <canvas
          ref={canvasRef}
          width={CANVAS_W}
          height={CANVAS_H}
          style={{ width: CANVAS_W * DISPLAY_SCALE, height: CANVAS_H * DISPLAY_SCALE }}
          className="block rounded-xl border border-separator"
        />

        {/* Video loading overlay */}
        {isVideoLoading && !videoError && (
          <div
            className="absolute inset-0 flex items-center justify-center bg-black/60 rounded-2xl"
            style={{ width: CANVAS_W * DISPLAY_SCALE, height: CANVAS_H * DISPLAY_SCALE }}
          >
            <div className="text-center px-4">
              <svg className="animate-spin mx-auto mb-2" width="32" height="32" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25"/>
                <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" className="opacity-75"/>
              </svg>
              <p className="text-label-secondary text-body-sm font-medium">Loading video…</p>
              <p className="text-label-tertiary text-caption-sm mt-1">Large videos may take a minute</p>
            </div>
          </div>
        )}

        {/* Video error overlay */}
        {videoError && (
          <div
            className="absolute inset-0 flex items-center justify-center bg-black/80 rounded-2xl"
            style={{ width: CANVAS_W * DISPLAY_SCALE, height: CANVAS_H * DISPLAY_SCALE }}
          >
            <div className="text-center px-4">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-danger mx-auto mb-2">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              <p className="text-danger text-body-sm font-medium">{videoError}</p>
              <button
                onClick={() => {
                  // One-click recovery: reset guards, re-mint a fresh URL, reload.
                  retryCountRef.current = 0;
                  hasRefetchedRef.current = false;
                  setVideoError(null);
                  setIsVideoLoading(true);
                  const refetch = onRefetchSrcRef.current;
                  if (refetch) {
                    refetch().catch(() => {
                      setIsVideoLoading(false);
                      setVideoError('Still could not load — the source may be unavailable.');
                    });
                  } else {
                    const v = videoRef.current;
                    if (v) { v.src = videoSrc; v.load(); }
                  }
                }}
                className="mt-3 h-8 px-4 inline-flex items-center rounded-md bg-surface-2 border border-separator text-caption font-medium text-label-secondary hover:text-label hover:border-label-quaternary transition-colors ease-out"
              >
                Retry
              </button>
            </div>
          </div>
        )}

        {/* Handle overlay — sits on top of canvas, overflows freely */}
        <div className="absolute inset-0 pointer-events-none" style={{ overflow: 'visible' }}>

          {/* Selection border around the video box */}
          <div
            style={{
              position: 'absolute',
              left: box.x * DISPLAY_SCALE,
              top: box.y * DISPLAY_SCALE,
              width: box.w * DISPLAY_SCALE,
              height: box.h * DISPLAY_SCALE,
              border: '1px solid rgba(255,255,255,0.35)',
              pointerEvents: 'none',
              boxSizing: 'border-box',
            }}
          />

          {/* Move hit-area (inner part of box, excluding handle edges) */}
          <div
            style={{
              position: 'absolute',
              left: box.x * DISPLAY_SCALE + H_SIZE,
              top:  box.y * DISPLAY_SCALE + H_SIZE,
              width:  Math.max(0, box.w * DISPLAY_SCALE - H_SIZE * 2),
              height: Math.max(0, box.h * DISPLAY_SCALE - H_SIZE * 2),
              cursor: 'move',
              pointerEvents: 'auto',
            }}
            onMouseDown={e => startDrag(e, 'move')}
          />

          {/* Corner & edge handles */}
          {handles.map(h => (
            <div
              key={h.type}
              onMouseDown={e => startDrag(e, h.type)}
              style={{
                position: 'absolute',
                left:   h.cx - H_SIZE / 2,
                top:    h.cy - H_SIZE / 2,
                width:  H_SIZE,
                height: H_SIZE,
                background: '#fff',
                border: '1.5px solid rgba(0,0,0,0.4)',
                borderRadius: 2,
                cursor: CURSORS[h.type],
                pointerEvents: 'auto',
                boxShadow: '0 1px 4px rgba(0,0,0,0.5)',
              }}
            />
          ))}
        </div>
      </div>

      {/* Info row */}
      <div className="flex items-center gap-1.5 text-caption-sm text-label-quaternary tabular-nums">
        <span>{Math.round(box.w)}×{Math.round(box.h)}</span>
        <span>at ({Math.round(box.x)}, {Math.round(box.y)})</span>
        <span>·</span>
        <button
          onClick={togglePlay}
          className="text-label-tertiary hover:text-label-secondary underline underline-offset-2 transition-colors"
        >
          {isPlaying ? 'Pause template preview' : 'Play on template'}
        </button>
        <span>·</span>
        <button
          onClick={resetBox}
          className="text-label-tertiary hover:text-label-secondary underline underline-offset-2 transition-colors"
        >
          Reset
        </button>
        <span>·</span>
        <button
          onClick={centerEverything}
          className="text-label-tertiary hover:text-label-secondary underline underline-offset-2 transition-colors"
        >
          Center
        </button>
      </div>

      {/* Recording progress bar */}
      {isRecording && (
        <div className="w-[270px] space-y-1.5">
          <div className="h-1 w-full rounded-full bg-surface-2 overflow-hidden" role="progressbar" aria-valuenow={Math.round(recProgress * 100)} aria-valuemin={0} aria-valuemax={100}>
            <div
              className="h-full bg-tint transition-all ease-out"
              style={{ width: `${Math.round(recProgress * 100)}%` }}
            />
          </div>
          <div className="flex justify-between text-caption-sm text-label-tertiary tabular-nums">
            <span>{recStatus || (isUploadMode ? `Preparing for upload… ${Math.round(recProgress * 100)}%` : `Exporting… ${Math.round(recProgress * 100)}%`)}</span>
            <button onClick={cancelRecording} className="text-danger hover:text-danger/80 transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Queued status indicator */}
      {!isRecording && queuePosition !== undefined && (
        <div className="w-[270px] rounded-md bg-surface-2 px-3 py-2">
          <div className="flex items-center gap-2 text-caption-sm text-label-secondary">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="animate-pulse">
              <circle cx="12" cy="12" r="10"/>
              <polyline points="12 6 12 12 16 14"/>
            </svg>
            <span>Queued ({queuePosition} in line)...</span>
          </div>
        </div>
      )}

      {/* Export button */}
      {!isRecording && !isUploadMode && (
        <button
          onClick={startRecording}
          className="h-9 px-4 inline-flex items-center gap-2 rounded-md bg-surface-2 border border-separator text-caption font-medium text-label-secondary hover:text-label hover:border-label-quaternary transition-colors ease-out"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2"/>
            <circle cx="12" cy="12" r="4"/>
          </svg>
          Export Cropped Video
        </button>
      )}

      {/* Upload to Instagram button */}
      {!isRecording && !isUploadMode && igConnected && (
        <button
          disabled={uploadState !== 'idle'}
          onClick={() => {
            // Guard against duplicate publishes from repeated clicks.
            if (uploadState !== 'idle') return;
            // Call parent to add to queue (rendering will happen when it's our turn)
            if (onUploadRequest) {
              onUploadRequest(entryId ?? videoId ?? 'unknown');
            }
          }}
          className="h-9 px-4 inline-flex items-center gap-2 rounded-md bg-accent text-on-accent text-caption font-medium hover:bg-accent-hover active:bg-accent-pressed transition-colors ease-out disabled:bg-surface-2 disabled:text-label-quaternary disabled:cursor-not-allowed"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
          </svg>
          {uploadState === 'published'
            ? 'Published'
            : uploadState === 'uploading'
              ? 'Uploading…'
              : uploadState === 'queued'
                ? 'Queued…'
                : 'Upload Reel'}
        </button>
      )}

      {/* Hidden video — feeds the canvas draw loop */}
      <video
        ref={videoRef}
        crossOrigin="anonymous"
        preload="auto"
        loop muted playsInline
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onLoadedMetadata={() => {
          // Seek to 1 second and pause by default
          const v = videoRef.current;
          if (v && v.duration > 1) {
            v.currentTime = 1;
          }
        }}
        onProgress={() => {
          // Track loading progress for debugging
          const v = videoRef.current;
          if (v && v.buffered.length > 0) {
            const bufferedEnd = v.buffered.end(v.buffered.length - 1);
            if (v.duration > 0 && bufferedEnd > 0) {
              const percent = (bufferedEnd / v.duration) * 100;
              if (videoId && percent < 100) {
                console.log('[Row ' + (rowNumber + 1) + `] Video ${videoId} buffering: ${percent.toFixed(1)}%`);
              }
            }
          }
        }}
        onCanPlay={() => {
          console.log('[Row ' + (rowNumber + 1) + `] Video ${videoId} can play`);
        }}
        onCanPlayThrough={() => {
          console.log('[Row ' + (rowNumber + 1) + `] Video ${videoId} can play through`);
        }}
        onError={(e) => {
          const video = e.target as HTMLVideoElement;
          const errorCode = video.error?.code;
          const errorMessage = video.error?.message;

          // Skip error handling if there's no actual error (happens when we reset the video element)
          if (!errorCode) {
            return;
          }

          const errorDetails = {
            code: errorCode,
            message: errorMessage,
            src: videoSrc,
            networkState: video.networkState,
            readyState: video.readyState,
            currentSrc: video.currentSrc,
            error: video.error
          };
          console.error('[Row ' + (rowNumber + 1) + '] Video error:', errorDetails);

          // Every onVideoError() below flags the parent row as failed — pair it
          // with failureFlaggedRef so that if the video later proves playable
          // (e.g. a quick retry or an auto-refetch that resolves before the
          // load timeout), recoverFromFailure can clear the stale Retry state.
          failureFlaggedRef.current = true;

          // If error code is undefined but error was triggered, it might be a loading issue
          if (errorCode === undefined) {
            setVideoError('Video failed to load. The video URL may be invalid.');
            if (onVideoError) {
              onVideoError();
            }
            return;
          }

          // Set user-friendly error message
          if (errorCode === 4) {
            setVideoError('Video format not supported. Try refreshing the page.');
          } else if (errorCode === 3) {
            setVideoError('Video decode error. The file may be corrupted.');
          } else if (errorCode === 2) {
            setVideoError('Network error. Check your internet connection.');
          } else {
            setVideoError('Failed to load video. The link may be invalid.');
          }
          // Notify parent component so they can re-enable fetch button
          if (onVideoError) {
            onVideoError();
          }
        }}
        style={{ display: 'none' }}
      />
    </div>
  );
});
