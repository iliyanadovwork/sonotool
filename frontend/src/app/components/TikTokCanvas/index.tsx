'use client';

import { useRef, useEffect, useState, forwardRef, useImperativeHandle } from 'react';

import {
  CANVAS_W, CANVAS_H, VIDEO_TARGET_W, DISPLAY_SCALE,
  BASE_HEADER_HEIGHT, CAPTION_LINE_HEIGHT, CAPTION_TOP_PADDING, HEADER_PADDING_X,
} from './constants';
import type { Box, TikTokCanvasProps, TikTokCanvasRef } from './types';
import { drawHeaderOnContext } from './drawing/drawHeader';
import { countCaptionLines, countSonotradeCaptionLines } from './drawing/countCaptionLines';
import { VideoOverlays } from './ui/VideoOverlays';
import { CanvasHandles } from './ui/CanvasHandles';
import { useVideoLoading } from './hooks/useVideoLoading';
import { usePanZoom } from './hooks/usePanZoom';
import { useDrag } from './hooks/useDrag';
import { useRecording } from './hooks/useRecording';

export type { TikTokCanvasRef } from './types';

export const TikTokCanvas = forwardRef<TikTokCanvasRef, TikTokCanvasProps>(function TikTokCanvas({
  videoSrc,
  videoId,
  rowNumber = 0,
  onVideoError,
  brand = 'sonotrade',
  overlayLogoSrc = '/templatelogo.png',
  overlayDisplayName = 'Sonotrade',
  overlayHandle = '@SonotradeHQ',
  overlayVerified = true,
  overlayCaption = '',
  onRecordingStateChange,
}: TikTokCanvasProps, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const raf = useRef(0);

  const verifiedImgRef = useRef<HTMLImageElement | null>(null);
  const logoImgRef = useRef<HTMLImageElement | null>(null);

  const videoOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const videoScaleRef = useRef<number>(1);
  const [videoScale, setVideoScale] = useState(1);

  const boxRef = useRef<Box>({ x: 0, y: 0, w: CANVAS_W, h: CANVAS_H });
  const [box, setBox] = useState<Box>({ x: 0, y: 0, w: CANVAS_W, h: CANVAS_H });

  const [includeEdit, setIncludeEdit] = useState(false);
  const includeEditRef = useRef(false);

  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => { logoImgRef.current = null; }, [overlayLogoSrc]);

  // ── Hooks ────────────────────────────────────────────────────────────────────

  const {
    isVideoLoading, videoError, setVideoError,
    videoDuration, trimStart, trimEnd, setTrimStart, setTrimEnd,
    currentTime, setCurrentTime, trimStartRef, trimEndRef,
  } = useVideoLoading({
    videoRef, videoSrc, brand, rowNumber, videoId,
    boxRef, setBox, videoOffsetRef, videoScaleRef, setVideoScale, onVideoError,
  });

  usePanZoom({ canvasRef, videoScaleRef, setVideoScale });

  const { startDrag, isDraggingRef } = useDrag({ boxRef, setBox, videoOffsetRef });

  const { isRecording, recProgress, recStatus, startRecording, cancelRecording } = useRecording({
    canvasRef, videoRef, brand, rowNumber, videoId,
    boxRef, videoOffsetRef, videoScaleRef,
    trimStartRef, trimEndRef, includeEditRef,
    logoImgRef, verifiedImgRef,
    overlayCaption, overlayLogoSrc, overlayDisplayName, overlayHandle, overlayVerified,
  });

  useImperativeHandle(ref, () => ({
    startDownload: () => (!isRecording ? startRecording() : Promise.resolve()),
    cancelExport: cancelRecording,
    play: () => { const v = videoRef.current; if (v) v.play(); },
    pause: () => { const v = videoRef.current; if (v) v.pause(); },
    seekTo: (t: number) => { const v = videoRef.current; if (v) v.currentTime = t; },
    setTrimRange: (start: number, end: number) => {
      trimStartRef.current = start; trimEndRef.current = end;
      setTrimStart(start); setTrimEnd(end);
    },
    resetTrim: () => {
      trimStartRef.current = 0; trimEndRef.current = videoDuration;
      setTrimStart(0); setTrimEnd(videoDuration);
      const v = videoRef.current; if (v) v.currentTime = 0;
    },
    zoomIn, zoomOut, resetZoom,
    setZoom: (s: number) => { const c = Math.max(0.5, Math.min(3, s)); videoScaleRef.current = c; setVideoScale(c); },
    resetBox,
    centerBox: centerEverything,
    setIncludeEdit: (v: boolean) => { setIncludeEdit(v); includeEditRef.current = v; },
    getVideoElement: () => videoRef.current,
    getTrimState: () => ({ trimStart, trimEnd, duration: videoDuration, includeEdit, videoScale }),
  }), [isRecording, startRecording, cancelRecording, videoDuration, trimStart, trimEnd, includeEdit, videoScale, zoomIn, zoomOut, resetZoom]);

  const onRecordingStateChangeRef = useRef(onRecordingStateChange);
  useEffect(() => { onRecordingStateChangeRef.current = onRecordingStateChange; });

  useEffect(() => {
    onRecordingStateChangeRef.current?.({ isRecording, recProgress, recStatus });
  }, [isRecording, recProgress, recStatus]);

  // ── Main draw loop ────────────────────────────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current;
    const v = videoRef.current;
    if (!canvas || !v) return;
    const video = v;
    const ctx = canvas.getContext('2d')!;
    let active = true;

    const drawOpts = {
      overlayCaption, overlayLogoSrc, overlayDisplayName, overlayHandle, overlayVerified,
      logoImgRef, verifiedImgRef,
    };

    // ── Pre-compute caption layout once per effect (caption text doesn't change mid-loop) ──
    const CAPTION_PAD_X   = HEADER_PADDING_X + 43;
    const CAPTION_MAX_W   = CANVAS_W - CAPTION_PAD_X * 2;
    const CAPTION_BOT_OFF = 18;
    const CLEAN_PAD_TOP   = 44;
    const CLEAN_PAD_BOT   = 40;

    // Groups of pre-wrapped lines; null entry = blank user-line (paragraph break)
    const captionGroups: (string[] | null)[] = [];
    if (overlayCaption && brand === 'clean') {
      ctx.font = '400 42px Chirp, "Comic Sans MS", cursive';
      for (const userLine of overlayCaption.split('\n')) {
        if (!userLine) { captionGroups.push(null); continue; }
        const words = userLine.split(' ');
        const wrapped: string[] = [];
        let cur = '';
        for (const word of words) {
          const test = cur + word + ' ';
          if (ctx.measureText(test).width > CAPTION_MAX_W && cur) {
            wrapped.push(cur); cur = word + ' ';
          } else { cur = test; }
        }
        if (cur) wrapped.push(cur);
        captionGroups.push(wrapped);
      }
    }
    const captionLineCount = captionGroups.reduce((n, g) => n + (g === null ? 1 : g.length), 0);
    const captionAreaH = captionLineCount > 0
      ? CLEAN_PAD_TOP + (captionLineCount * CAPTION_LINE_HEIGHT) + CLEAN_PAD_BOT - CAPTION_BOT_OFF
      : 0;

    // Pre-compute sonotrade header height (depends only on caption, not on box position)
    const sonotradeHeaderHeight = overlayCaption && brand !== 'clean'
      ? (() => {
          const lines = countSonotradeCaptionLines(ctx, overlayCaption);
          return BASE_HEADER_HEIGHT + CAPTION_TOP_PADDING + (lines * CAPTION_LINE_HEIGHT) - CAPTION_BOT_OFF;
        })()
      : BASE_HEADER_HEIGHT;

    // ── Draw loop — throttled to ~10 fps when paused to spare CPU ──────────────
    let lastDrawTime = 0;

    function draw() {
      if (!active) return;
      raf.current = requestAnimationFrame(draw);

      // Throttle to ~10fps when paused and idle; bypass throttle while dragging for smooth 60fps
      if (video.paused && !isDraggingRef.current) {
        const now = performance.now();
        if (now - lastDrawTime < 100) return;
        lastDrawTime = now;
      }

      if (brand === 'clean') {
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

        if (video.readyState >= 2 && video.videoWidth && video.videoHeight) {
          const { x, y, w, h } = boxRef.current;
          const { x: ox, y: oy } = videoOffsetRef.current;

          if (captionGroups.length > 0) {
            const captionAreaY = Math.max(0, y - captionAreaH + 4);
            ctx.font = '400 42px Chirp, "Comic Sans MS", cursive';
            ctx.fillStyle = '#000';
            let cy = captionAreaY + CLEAN_PAD_TOP + CAPTION_LINE_HEIGHT - 10;
            for (let gi = 0; gi < captionGroups.length; gi++) {
              const group = captionGroups[gi];
              const isLastGroup = gi === captionGroups.length - 1;
              if (group === null) { cy += CAPTION_LINE_HEIGHT; continue; }
              for (let wi = 0; wi < group.length; wi++) {
                ctx.fillText(group[wi], CAPTION_PAD_X, cy);
                if (wi < group.length - 1) cy += CAPTION_LINE_HEIGHT;
              }
              if (!isLastGroup) cy += CAPTION_LINE_HEIGHT;
            }
          }

          const scale = (CANVAS_W / video.videoWidth) * videoScaleRef.current;
          const drawW = video.videoWidth * scale;
          const drawH = video.videoHeight * scale;
          const dx = (CANVAS_W - drawW) / 2 + ox;
          const dy = (CANVAS_H - drawH) / 2 + oy;

          ctx.save();
          ctx.beginPath();
          ctx.rect(x, y, w, h);
          ctx.clip();
          ctx.drawImage(video, dx, dy, drawW, drawH);
          ctx.restore();
        }
        return;
      }

      // sonotrade (Twitter/X header template)
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

      if (video.readyState >= 2 && video.videoWidth && video.videoHeight) {
        const { x, y, w, h } = boxRef.current;
        const { x: ox, y: oy } = videoOffsetRef.current;

        const headerY = Math.max(0, y - sonotradeHeaderHeight + 4);
        drawHeaderOnContext({ ctx, cx: 0, cy: headerY, cw: CANVAS_W, ...drawOpts });

        const scale = Math.min(VIDEO_TARGET_W / video.videoWidth, CANVAS_H / video.videoHeight) * videoScaleRef.current;
        const drawW = video.videoWidth * scale;
        const drawH = video.videoHeight * scale;
        const dx = (CANVAS_W - drawW) / 2 + ox;
        const dy = (CANVAS_H - drawH) / 2 + oy;

        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, w, h);
        ctx.clip();
        ctx.drawImage(video, dx, dy, drawW, drawH);
        ctx.restore();
      }
    }

    draw();
    return () => { active = false; cancelAnimationFrame(raf.current); };
  // videoScale intentionally omitted: the draw loop reads videoScaleRef.current directly,
  // so including it would restart the RAF loop on every zoom step causing a visible frame drop.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoSrc, overlayDisplayName, overlayHandle, overlayVerified, overlayCaption, brand, overlayLogoSrc]);

  // ── Interaction handlers ──────────────────────────────────────────────────────

  function resetBox() {
    const video = videoRef.current;
    if (video && video.videoWidth && video.videoHeight) {
      const scale = Math.min(VIDEO_TARGET_W / video.videoWidth, CANVAS_H / video.videoHeight);
      const b = {
        x: (CANVAS_W - video.videoWidth * scale) / 2,
        y: (CANVAS_H - video.videoHeight * scale) / 2,
        w: video.videoWidth * scale,
        h: video.videoHeight * scale,
      };
      boxRef.current = b;
      setBox(b);
    } else {
      const b = { x: 0, y: 0, w: CANVAS_W, h: CANVAS_H };
      boxRef.current = b;
      setBox(b);
    }
    videoOffsetRef.current = { x: 0, y: 0 };
    videoScaleRef.current = 1;
    setVideoScale(1);
  }

  function centerEverything() {
    let headerHeight = BASE_HEADER_HEIGHT;
    if (overlayCaption && brand !== 'clean') {
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const captionLines = countSonotradeCaptionLines(ctx, overlayCaption);
          const CAPTION_BOTTOM_OFFSET = 18;
          headerHeight = BASE_HEADER_HEIGHT + CAPTION_TOP_PADDING + (captionLines * CAPTION_LINE_HEIGHT) - CAPTION_BOTTOM_OFFSET;
        }
      }
    }
    const currentBox = boxRef.current;
    const totalHeight = headerHeight + currentBox.h;
    const newY = (CANVAS_H - totalHeight) / 2 - 60 + headerHeight;
    const b = { x: currentBox.x, y: newY, w: currentBox.w, h: currentBox.h };
    boxRef.current = b;
    setBox({ ...b });
  }

  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) { v.play(); setIsPlaying(true); }
    else { v.pause(); setIsPlaying(false); }
  }

  function zoomIn() { const n = Math.min(3, videoScaleRef.current + 0.05); videoScaleRef.current = n; setVideoScale(n); }
  function zoomOut() { const n = Math.max(0.5, videoScaleRef.current - 0.05); videoScaleRef.current = n; setVideoScale(n); }
  function resetZoom() { videoScaleRef.current = 1; setVideoScale(1); }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div
      className="relative"
      style={{ width: CANVAS_W * DISPLAY_SCALE, height: CANVAS_H * DISPLAY_SCALE, overflow: 'visible' }}
    >
      <canvas
        ref={canvasRef}
        width={CANVAS_W}
        height={CANVAS_H}
        style={{ width: CANVAS_W * DISPLAY_SCALE, height: CANVAS_H * DISPLAY_SCALE }}
        className="block border border-separator shadow-[0_0_48px_rgba(254,44,85,0.1)]"
      />
      <VideoOverlays isVideoLoading={isVideoLoading} videoError={videoError} />
      <CanvasHandles box={box} onStartDrag={startDrag} />
      <video
        ref={videoRef}
        crossOrigin="anonymous"
        preload="auto"
        loop playsInline
        onPlay={() => {
          setIsPlaying(true);
          const v = videoRef.current;
          if (v && v.currentTime < trimStartRef.current) v.currentTime = trimStartRef.current;
        }}
        onPause={() => setIsPlaying(false)}
        onTimeUpdate={() => {
          const v = videoRef.current;
          if (!v) return;
          setCurrentTime(v.currentTime);
          if (trimEndRef.current > 0 && v.currentTime >= trimEndRef.current) {
            v.currentTime = trimStartRef.current;
          }
        }}
        onLoadedMetadata={() => {
          const v = videoRef.current;
          if (v && v.duration > 1) v.currentTime = 1;
        }}
        onError={(e) => {
          const v = e.target as HTMLVideoElement;
          const errorCode = v.error?.code;
          if (!errorCode) return;
          const msgs: Record<number, string> = {
            4: 'Video format not supported. Try refreshing the page.',
            3: 'Video decode error. The file may be corrupted.',
            2: 'Network error. Check your internet connection.',
          };
          setVideoError(msgs[errorCode] ?? 'Failed to load video. The link may be invalid.');
          onVideoError?.();
        }}
        style={{ display: 'none' }}
      />
    </div>
  );
});
