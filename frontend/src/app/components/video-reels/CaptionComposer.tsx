'use client';

import { useEffect, useRef, useState } from 'react';
import type { ReelComment } from '@/lib/video-reels/comments-provider';
import { sampleVideoFrames } from '@/lib/video-reels/frame-sampler';
import { pickBestVideoUrl } from '@/lib/video-reels/proxy-url';

interface Props {
  open: boolean;
  onClose: () => void;
  rowLabel: string;
  /** Original Instagram/TikTok URL — used to lazily load the video and fetch comments. */
  sourceUrl: string;
  /** A pre-resolved proxied video URL if the parent already fetched the reel;
   *  when null the composer lazily loads the video from sourceUrl on open. */
  initialVideoUrl?: string | null;
  /** This row's current column-B caption; the panel's value and the fallback / starting text. */
  extractedCaption: string;
  /** Called with the final composed caption when the user confirms. */
  onConfirm: (caption: string) => void;
  /** Whether a sheet write will happen on confirm (affects the button hint). */
  writesSheet: boolean;
}

// Wait until a <video> has enough data to draw a frame (readyState >= 2),
// nudging it to load if it's only holding metadata. Bounded so it can't hang.
function whenVideoReady(video: HTMLVideoElement, timeoutMs = 8000): Promise<boolean> {
  if (video.readyState >= 2) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.removeEventListener('loadeddata', onOk);
      video.removeEventListener('canplay', onOk);
      video.removeEventListener('error', onErr);
      resolve(ok);
    };
    const onOk = () => finish(video.readyState >= 2);
    const onErr = () => finish(false);
    const timer = setTimeout(() => finish(video.readyState >= 2), timeoutMs);
    video.addEventListener('loadeddata', onOk);
    video.addEventListener('canplay', onOk);
    video.addEventListener('error', onErr);
    // Only nudge a PAUSED, metadata-only element. If the user is playing (even
    // still buffering), playback itself drives it to readyState>=2 — calling
    // load() there would abort their play() and reset currentTime to 0.
    if (video.paused) {
      if (video.preload !== 'auto') video.preload = 'auto';
      try { video.load(); } catch { /* ignore */ }
    }
  });
}

// Compose the on-video overlay caption from the extracted caption and/or the
// reel's top comments. The raw ORIGINAL video plays on the left (lazily loaded
// from the source URL) so you can watch the clip and extract its caption; the
// editable final caption is on the right.
export function CaptionComposer({ open, onClose, rowLabel, sourceUrl, initialVideoUrl, extractedCaption, onConfirm, writesSheet }: Props) {
  const [finalText, setFinalText] = useState('');
  const [extractedCap, setExtractedCap] = useState('');
  const [comments, setComments] = useState<ReelComment[]>([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [commentsError, setCommentsError] = useState('');
  const [commentsLoaded, setCommentsLoaded] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoLoading, setVideoLoading] = useState(false);
  const [videoError, setVideoError] = useState('');
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState('');
  const finalRef = useRef<HTMLTextAreaElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const isInstagram = /instagram\.com\//i.test(sourceUrl || '');

  // Reset each time the composer opens, and lazily load the video for this row.
  // Depend on `open` only: the source is captured on open, so a later prop
  // change must not clobber the user's in-progress edits. (The parent also keys
  // this component by row id, so a row switch remounts it.)
  useEffect(() => {
    if (!open) return;
    setFinalText(extractedCaption || '');
    setExtractedCap(extractedCaption || '');
    setComments([]);
    setCommentsError('');
    setCommentsLoaded(false);
    setLoadingComments(false);
    setExtractError('');
    setExtracting(false);
    setVideoError('');

    if (initialVideoUrl) {
      setVideoUrl(initialVideoUrl);
      setVideoLoading(false);
    } else {
      setVideoUrl(null);
      void loadVideo();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Close on Escape — expected for an aria-modal dialog.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  // Resolve the source URL to a playable (proxied) video for the left preview.
  async function loadVideo() {
    if (!sourceUrl?.trim()) { setVideoError('No source URL for this row.'); return; }
    setVideoLoading(true);
    setVideoError('');
    try {
      const res = await fetch('/api/video-reels/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: sourceUrl.trim() }),
      });
      const data = await res.json().catch(() => ({} as { play?: string; hdplay?: string; wmplay?: string; error?: string }));
      if (!res.ok) {
        setVideoError(typeof data.error === 'string' ? data.error : `Couldn't load video (HTTP ${res.status})`);
        return;
      }
      const best = pickBestVideoUrl(data);
      if (!best) {
        setVideoError('No playable video URL was returned for this link.');
        return;
      }
      setVideoUrl(best);
    } catch (e) {
      setVideoError(e instanceof Error ? e.message : 'Failed to load video');
    } finally {
      setVideoLoading(false);
    }
  }

  // Read the creator's overlay caption from the video (frames → Gemini vision).
  async function extractCaption() {
    const video = videoRef.current;
    if (!video) { setExtractError('Video isn’t loaded yet.'); return; }
    setExtracting(true);
    setExtractError('');
    try {
      const ready = await whenVideoReady(video);
      if (!ready) { setExtractError('Video isn’t ready yet — press play, then try again.'); return; }
      const frames = await sampleVideoFrames(video);
      if (!frames?.length) { setExtractError('Could not read frames from the video.'); return; }
      const res = await fetch('/api/video-reels/extract-caption', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ frames }),
      });
      const data = await res.json().catch(() => ({} as { caption?: string; error?: string }));
      if (!res.ok) {
        setExtractError(typeof data.error === 'string' ? data.error : `Extraction failed (HTTP ${res.status})`);
        return;
      }
      const cap = typeof data.caption === 'string' ? data.caption.trim() : '';
      if (!cap) { setExtractError('No caption detected in the video.'); return; }
      setExtractedCap(cap);
    } catch (e) {
      setExtractError(e instanceof Error ? e.message : 'Extraction failed');
    } finally {
      setExtracting(false);
    }
  }

  // Append a snippet to the final caption on its own line (never clobbers edits).
  function append(text: string) {
    const t = text.trim();
    if (!t) return;
    setFinalText((prev) => (prev.trim() ? `${prev.replace(/\s+$/, '')}\n${t}` : t));
    // Keep focus/scroll in the editable area.
    requestAnimationFrame(() => {
      const el = finalRef.current;
      if (el) { el.focus(); el.scrollTop = el.scrollHeight; }
    });
  }

  async function loadComments() {
    setLoadingComments(true);
    setCommentsError('');
    try {
      const res = await fetch('/api/video-reels/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: sourceUrl, limit: 5 }),
      });
      const data = await res.json().catch(() => ({} as { comments?: ReelComment[]; error?: string }));
      if (!res.ok) {
        setCommentsError(typeof data.error === 'string' ? data.error : `Failed (HTTP ${res.status})`);
      } else {
        setComments(Array.isArray(data.comments) ? data.comments : []);
        setCommentsLoaded(true);
      }
    } catch (e) {
      setCommentsError(e instanceof Error ? e.message : 'Failed to load comments');
    } finally {
      setLoadingComments(false);
    }
  }

  const videoReady = !!videoUrl;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label="Compose caption"
    >
      <div className="flex w-full max-w-4xl max-h-[90vh] overflow-hidden rounded-xl bg-surface border border-separator shadow-2xl">
        {/* Left — the RAW original video (lazily loaded) */}
        <div className="flex w-1/2 shrink-0 flex-col items-center justify-center gap-2 bg-black/60 p-3">
          {videoReady ? (
            <video
              key={videoUrl!}
              ref={videoRef}
              src={videoUrl!}
              controls
              playsInline
              preload="metadata"
              className="max-h-[80vh] w-auto max-w-full rounded-lg"
            />
          ) : videoLoading ? (
            <div className="text-caption text-label-tertiary">Loading video…</div>
          ) : videoError ? (
            <div className="flex flex-col items-center gap-2">
              <div className="text-caption text-danger max-w-[80%] text-center">{videoError}</div>
              <button onClick={() => void loadVideo()} className="h-7 px-2.5 rounded-md text-caption-sm font-medium text-accent hover:bg-surface-2">Retry</button>
            </div>
          ) : (
            <div className="text-caption text-label-tertiary">No video.</div>
          )}
          <span className="text-caption-sm text-label-quaternary">Original video (with sound)</span>
        </div>

        {/* Right — compose */}
        <div className="flex w-1/2 flex-col">
          <div className="flex items-center justify-between px-4 h-12 border-b border-separator shrink-0">
            <h2 className="text-headline font-semibold text-label">Compose caption — {rowLabel}</h2>
            <button onClick={onClose} aria-label="Close" className="text-label-tertiary hover:text-label text-xl leading-none">×</button>
          </div>

          <div className="flex flex-col gap-3 overflow-y-auto px-4 py-3">
            {/* Extracted caption */}
            <div className="rounded-lg bg-surface-1 border border-separator px-3 py-2.5">
              <div className="flex items-center justify-between mb-1 gap-2">
                <span className="text-caption-sm text-label-tertiary shrink-0">Caption (column B)</span>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => void extractCaption()}
                    disabled={extracting || !videoReady}
                    title={videoReady ? 'Read the on-video caption with AI vision' : 'Load the video first'}
                    className="h-6 px-2 rounded-md text-caption-sm font-medium text-accent hover:bg-surface-2 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {extracting ? 'Extracting…' : extractedCap.trim() ? 'Re-extract' : 'Extract'}
                  </button>
                  <button
                    onClick={() => append(extractedCap)}
                    disabled={!extractedCap.trim()}
                    className="h-6 px-2 rounded-md text-caption-sm font-medium text-accent hover:bg-surface-2 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    + Add
                  </button>
                </div>
              </div>
              {extractError && <p className="text-caption-sm text-danger mb-1">{extractError}</p>}
              <p className="text-footnote text-label-secondary whitespace-pre-wrap">
                {extractedCap.trim() || <span className="text-label-quaternary">Column B is empty for this row — press Extract to read it from the video.</span>}
              </p>
            </div>

            {/* Top comments */}
            <div className="rounded-lg bg-surface-1 border border-separator px-3 py-2.5">
              <div className="flex items-center justify-between mb-1">
                <span className="text-caption-sm text-label-tertiary">Top 5 comments</span>
                <button
                  onClick={loadComments}
                  disabled={loadingComments || !isInstagram}
                  title={isInstagram ? 'Fetch the reel\'s top comments' : 'Comments are only available for Instagram reels'}
                  className="h-6 px-2 rounded-md text-caption-sm font-medium text-accent hover:bg-surface-2 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {loadingComments ? 'Loading…' : commentsLoaded ? 'Reload' : 'Load comments'}
                </button>
              </div>
              {!isInstagram && <p className="text-caption-sm text-label-quaternary">Only available for Instagram reels.</p>}
              {commentsError && <p className="text-caption-sm text-danger">{commentsError}</p>}
              {commentsLoaded && comments.length === 0 && !commentsError && (
                <p className="text-caption-sm text-label-quaternary">No comments found.</p>
              )}
              {comments.length > 0 && (
                <ul className="flex flex-col gap-1.5 mt-1">
                  {comments.map((c, i) => (
                    <li key={i} className="flex items-start gap-2 rounded-md bg-surface px-2 py-1.5">
                      <span className="text-caption-sm tabular-nums text-label-tertiary shrink-0 pt-0.5">{c.likeCount}♥</span>
                      <span className="text-footnote text-label-secondary flex-1 min-w-0">
                        <span className="text-label-tertiary">@{c.username || 'user'}</span> {c.text}
                      </span>
                      <button
                        onClick={() => append(c.text)}
                        className="h-6 px-2 shrink-0 rounded-md text-caption-sm font-medium text-accent hover:bg-surface-2"
                      >
                        + Add
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Final caption */}
            <label className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="text-caption-sm text-label-tertiary">Final caption</span>
                <button
                  onClick={() => setFinalText('')}
                  disabled={!finalText}
                  className="h-6 px-2 rounded-md text-caption-sm font-medium text-label-tertiary hover:text-danger hover:bg-surface-2 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Clear
                </button>
              </div>
              <textarea
                ref={finalRef}
                value={finalText}
                onChange={(e) => setFinalText(e.target.value)}
                rows={4}
                placeholder="This becomes the on-video caption…"
                className="w-full resize-none rounded-lg bg-surface-1 border border-separator px-3 py-2 text-footnote text-label placeholder:text-label-quaternary focus:outline-none focus:ring-2 focus:ring-focus"
              />
            </label>
          </div>

          <div className="flex items-center justify-end gap-2 px-4 h-14 border-t border-separator shrink-0">
            <button onClick={onClose} className="h-8 px-3 rounded-md text-footnote text-label-secondary hover:bg-surface-1">Cancel</button>
            <button
              onClick={() => onConfirm(finalText.trim())}
              disabled={!finalText.trim()}
              title={!finalText.trim()
                ? 'Add a caption first — confirming empty would wipe the sheet cell'
                : writesSheet ? 'Set the overlay caption and write it to column B' : 'Set the overlay caption'}
              className="h-8 px-4 rounded-md bg-accent text-on-accent text-footnote font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Confirm{writesSheet ? ' → column B' : ''}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
