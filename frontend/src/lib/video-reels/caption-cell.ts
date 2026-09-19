// Column B (overlay caption) write rules for caption EXTRACTION, shared by the
// grid's per-card + bulk buttons, the sheet-driven extract-title-prompt route,
// and the /google/sheets/update endpoint that performs the write.
//
//   {…}   → locked. The row is skipped outright: no frames, no vision call, no
//           write. The braces are the manual "I wrote this, hands off" marker.
//   ''    → plain write of the extracted caption.
//   other → the extracted caption is PREPENDED to what's already there.
//
// Note this governs extraction only. The Caption Composer's confirm still
// replaces column B — that value is authored by the user, not read off a video.

// A cell is locked when its trimmed value is wrapped in braces. Deliberately
// shallow: `{anything}` counts, since the marker is about the cell as a whole
// rather than the syntax of what's inside it.
export function isLockedCaptionCell(value: string | null | undefined): boolean {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  return trimmed.length >= 2 && trimmed.startsWith('{') && trimmed.endsWith('}');
}

// The value to actually RENDER as the on-video overlay. The `{…}` wrapper is a
// control marker for extraction, never meant to be seen — so a locked cell is
// shown with its single outer brace pair stripped (`{hi}` → `hi`, `{}` → ``).
// Detection still runs on the raw cell elsewhere; only display unwraps. A cell
// that isn't wrapped is returned verbatim (no trim) so intentional whitespace
// and line breaks the overlay relies on survive.
export function captionForDisplay(value: string | null | undefined): string {
  if (typeof value !== 'string') return '';
  if (isLockedCaptionCell(value)) return value.trim().slice(1, -1).trim();
  return value;
}

// Compose the new column B value. A single space joins the two parts: the
// extractor already collapses its output to one line and the canvas overlay
// word-wraps on its own, so the result stays one logical line. Either side
// being empty degrades to the other, so an empty cell is a plain write.
export function prependCaption(extracted: string | null | undefined, existing: string | null | undefined): string {
  const add = typeof extracted === 'string' ? extracted.trim() : '';
  const old = typeof existing === 'string' ? existing.trim() : '';
  if (!add) return old;
  if (!old) return add;
  return `${add} ${old}`;
}
