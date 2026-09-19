'use client';

import { useEffect, useState } from 'react';

// Progress of an in-flight carousel publish, driven by the orchestrator in TemplateEditorGrid.
export type IgPublishProgress =
  | { phase: 'idle' }
  | { phase: 'rendering'; index: number; total: number }
  | { phase: 'uploading'; index: number; total: number }
  | { phase: 'publishing' }
  | { phase: 'done'; permalink?: string }
  | { phase: 'error'; message: string };

type Account = { username?: string } | null;

interface Props {
  open: boolean;
  onClose: () => void;
  /** Per-slide media kind, in carousel order — for the summary + count guardrails. */
  slideKinds: ('image' | 'video')[];
  /** Fired with the typed caption when the user confirms. */
  onPublish: (caption: string) => void;
  progress: IgPublishProgress;
  /** Optional caption pre-fill (e.g. from slide 1's headline). */
  initialCaption?: string;
}

const MAX_CAPTION = 2200;

// Shown (and editable) in the dialog's "Generate with AI" panel; the user's typed topic is
// appended to it and the whole thing is sent to Gemini (grounded with Google Search).
const DEFAULT_PROMPT_PREFIX =
  'Generate me an instagram caption, no emojis, in exactly 2 paragraphs, on this topic. ' +
  'Before writing, you must use Google Search to look up current, accurate, up-to-date ' +
  'information about the topic, and base the caption on what you find — do not rely on prior knowledge alone. ' +
  'Do NOT include any source citations, URLs, website names, domain names, or reference markers ' +
  '(e.g. "[wikipedia.org]" or "[1]") in the caption — write it as clean prose with no references. ' +
  'Aim for roughly 1800 characters and never exceed 2000. Output only the caption text, nothing else. Topic:';

export function PostInstagramPublishDialog({ open, onClose, slideKinds, onPublish, progress, initialCaption }: Props) {
  const [account, setAccount] = useState<Account | 'loading'>('loading');
  const [caption, setCaption] = useState('');
  // AI caption generator state.
  const [promptPrefix, setPromptPrefix] = useState(DEFAULT_PROMPT_PREFIX);
  const [topic, setTopic] = useState('');
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState('');

  // Reset caption + (re)check the connected account each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setCaption(initialCaption ?? '');
    setTopic('');
    setGenError('');
    setAccount('loading');
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/video-reels/meta/me');
        if (cancelled) return;
        if (res.ok) setAccount(await res.json());
        else setAccount(null);
      } catch {
        if (!cancelled) setAccount(null);
      }
    })();
    return () => { cancelled = true; };
  }, [open, initialCaption]);

  if (!open) return null;

  const total = slideKinds.length;
  const videoCount = slideKinds.filter(k => k === 'video').length;
  const imageCount = total - videoCount;
  const tooMany = total > 10;
  const busy = progress.phase === 'rendering' || progress.phase === 'uploading' || progress.phase === 'publishing';
  const connected = account !== null && account !== 'loading';
  const canPublish = connected && total > 0 && total <= 10 && !busy;

  async function connect() {
    try {
      const res = await fetch('/api/video-reels/meta/auth', { cache: 'no-store' });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
    } catch {
      setAccount(null);
    }
  }

  // Ask Gemini (grounded with Google Search) to write the caption from the prefix + topic,
  // then drop the result into the caption box for the user to review/edit before publishing.
  async function generateCaption() {
    if (!topic.trim()) { setGenError('Type a topic first (e.g. "Playboi Carti career").'); return; }
    setGenerating(true);
    setGenError('');
    try {
      const res = await fetch('/api/posts/instagram/generate-caption', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: `${promptPrefix.trim()} ${topic.trim()}` }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to generate caption');
      setCaption((data.caption || '').slice(0, MAX_CAPTION));
    } catch (e) {
      setGenError(e instanceof Error ? e.message : 'Failed to generate caption');
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label="Publish to Instagram"
    >
      <div className="w-[28rem] max-w-[92vw] rounded-xl bg-surface border border-separator shadow-2xl flex flex-col max-h-[88vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 h-14 border-b border-separator shrink-0">
          <h2 className="text-headline font-semibold text-label">Publish to Instagram</h2>
          <button
            onClick={onClose}
            disabled={busy}
            className="text-label-tertiary hover:text-label-secondary disabled:opacity-40 text-xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="px-5 py-4 flex flex-col gap-4 overflow-y-auto">
          {/* Account */}
          <div className="flex items-center justify-between gap-3 rounded-lg bg-surface-1 border border-separator px-3 py-2.5">
            <span className="text-caption-sm text-label-tertiary">Account</span>
            {account === 'loading' ? (
              <span className="text-caption-sm text-label-tertiary">Checking…</span>
            ) : connected ? (
              <span className="text-footnote font-medium text-label">@{account?.username ?? 'connected'}</span>
            ) : (
              <button
                onClick={connect}
                className="h-7 px-3 rounded-md bg-accent text-on-accent text-caption-sm font-medium hover:opacity-90"
              >
                Connect Instagram
              </button>
            )}
          </div>

          {/* AI caption generator — shows the editable prompt prefix; the user adds a short
              topic and Gemini (grounded with Google Search) writes the caption below. */}
          <div className="flex flex-col gap-2 rounded-lg bg-surface-1 border border-separator px-3 py-3">
            <span className="text-caption-sm text-label-tertiary">Generate with AI</span>
            <textarea
              value={promptPrefix}
              onChange={e => setPromptPrefix(e.target.value)}
              disabled={generating || busy}
              rows={3}
              aria-label="AI prompt prefix"
              className="w-full resize-none rounded-md bg-surface border border-separator px-2.5 py-1.5 text-caption-sm text-label-secondary placeholder:text-label-quaternary focus:outline-none focus:ring-2 focus:ring-focus disabled:opacity-60"
            />
            <div className="flex items-center gap-2">
              <input
                value={topic}
                onChange={e => setTopic(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void generateCaption(); } }}
                disabled={generating || busy}
                placeholder="Topic — e.g. Playboi Carti career"
                className="flex-1 h-8 rounded-md bg-surface border border-separator px-2.5 text-footnote text-label placeholder:text-label-quaternary focus:outline-none focus:ring-2 focus:ring-focus disabled:opacity-60"
              />
              <button
                onClick={() => void generateCaption()}
                disabled={generating || busy || !topic.trim()}
                className="h-8 px-3 rounded-md bg-accent text-on-accent text-caption-sm font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
              >
                {generating ? 'Generating…' : 'Generate'}
              </button>
            </div>
            {genError && <span className="text-caption-sm text-danger">{genError}</span>}
          </div>

          {/* Caption */}
          <label className="flex flex-col gap-1.5">
            <span className="text-caption-sm text-label-tertiary">Caption</span>
            <textarea
              value={caption}
              onChange={e => setCaption(e.target.value.slice(0, MAX_CAPTION))}
              disabled={busy}
              rows={4}
              placeholder="Write a caption…"
              className="w-full resize-none rounded-lg bg-surface-1 border border-separator px-3 py-2 text-footnote text-label placeholder:text-label-quaternary focus:outline-none focus:ring-2 focus:ring-focus disabled:opacity-60"
            />
            <span className="text-caption-sm text-label-quaternary self-end tabular-nums">{caption.length}/{MAX_CAPTION}</span>
          </label>

          {/* Slide summary */}
          <div className="text-caption-sm text-label-tertiary">
            {total === 0
              ? 'This post has no slides.'
              : <>Publishing <span className="text-label-secondary font-medium">{total} slide{total === 1 ? '' : 's'}</span>
                  {' '}({imageCount} image{imageCount === 1 ? '' : 's'}{videoCount ? `, ${videoCount} video${videoCount === 1 ? '' : 's'}` : ''})
                  {total === 1 ? ' — as a single post.' : ' — as a carousel.'}</>}
          </div>
          {tooMany && (
            <p className="text-caption-sm text-danger">Instagram allows at most 10 slides per carousel. Remove {total - 10} to publish.</p>
          )}

          {/* Progress / result */}
          {progress.phase !== 'idle' && (
            <div className="rounded-lg bg-surface-1 border border-separator px-3 py-2.5 text-footnote">
              {progress.phase === 'rendering' && <span className="text-label-secondary">Rendering slide {progress.index + 1} of {progress.total}…</span>}
              {progress.phase === 'uploading' && <span className="text-label-secondary">Uploading slide {progress.index + 1} of {progress.total}…</span>}
              {progress.phase === 'publishing' && <span className="text-label-secondary">Publishing to Instagram… (this can take a minute)</span>}
              {progress.phase === 'done' && (
                <span className="text-success flex items-center gap-2">
                  Published! {progress.permalink && (
                    <a href={progress.permalink} target="_blank" rel="noopener noreferrer" className="underline text-accent">View on Instagram</a>
                  )}
                </span>
              )}
              {progress.phase === 'error' && <span className="text-danger">{progress.message}</span>}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 h-14 border-t border-separator shrink-0">
          <button
            onClick={onClose}
            disabled={busy}
            className="h-8 px-3 rounded-md text-footnote text-label-secondary hover:bg-surface-1 disabled:opacity-40"
          >
            {progress.phase === 'done' ? 'Close' : 'Cancel'}
          </button>
          <button
            onClick={() => onPublish(caption)}
            disabled={!canPublish}
            className="h-8 px-4 rounded-md bg-accent text-on-accent text-footnote font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {busy ? 'Publishing…' : 'Publish'}
          </button>
        </div>
      </div>
    </div>
  );
}
