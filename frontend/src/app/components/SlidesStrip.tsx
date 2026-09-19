'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { SlideRow } from '../hooks/useTemplateEditor';

interface SlidesStripProps {
  slides: SlideRow[];
  activeSlideId: string | null;
  onSelect: (id: string) => void;
  onAdd: () => void;                              // add a blank slide
  onDuplicateSlide: (id: string) => void;         // add a copy of an existing slide (a template slide)
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onReorder: (orderedIds: string[]) => void;
}

const STRIP_HEIGHT_PX  = 96;
const CARD_WIDTH_PX    = 130;
const CARD_HEIGHT_PX   = 72;

export function SlidesStrip({
  slides,
  activeSlideId,
  onSelect,
  onAdd,
  onDuplicateSlide,
  onRename,
  onDelete,
  onReorder,
}: SlidesStripProps) {
  // Horizontal overflow state. The strip hides its scrollbar for looks, which means
  // that past ~8 slides it silently clipped the rest with no hint more existed.
  // These drive edge fades + arrow buttons so the overflow is visible and reachable.
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ overflowing: false, atStart: true, atEnd: true });

  function syncEdges() {
    const el = scrollerRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setEdges({
      overflowing: max > 1,
      atStart: el.scrollLeft <= 1,
      atEnd: el.scrollLeft >= max - 1,
    });
  }

  // Re-measure when the slide count changes and whenever the band resizes (the strip
  // sits between the sidebar and the inspector, so its width moves with the window).
  useEffect(() => {
    syncEdges();
    const el = scrollerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(syncEdges);
    ro.observe(el);
    return () => ro.disconnect();
  }, [slides.length]);

  // Keep the selected slide on screen — selection can move via keyboard or the canvas,
  // and with the strip scrolled the active card was often outside the viewport.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || !activeSlideId) return;
    const card = el.querySelector<HTMLElement>(`[data-slide-id="${CSS.escape(activeSlideId)}"]`);
    card?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  }, [activeSlideId]);

  function nudge(dir: -1 | 1) {
    scrollerRef.current?.scrollBy({ left: dir * (CARD_WIDTH_PX + 8) * 3, behavior: 'smooth' });
  }

  // Drag-to-reorder state (HTML5 DnD)
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; before: boolean } | null>(null);

  // "Add slide" picker — blank, or a copy of one of the template's slides. Portaled to <body> + fixed
  // (anchored above the button) so it isn't clipped by the strip's horizontal scroll.
  const [picker, setPicker] = useState<{ left: number; top: number } | null>(null);
  useEffect(() => {
    if (!picker) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPicker(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [picker]);

  function handleDragStart(e: React.DragEvent, id: string) {
    setDraggingId(id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
  }

  function handleDragOver(e: React.DragEvent, targetId: string) {
    if (!draggingId || draggingId === targetId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    // Decide if the drop should go before or after the target based on cursor X
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const before = e.clientX < rect.left + rect.width / 2;
    setDropTarget({ id: targetId, before });
  }

  function handleDrop(e: React.DragEvent, targetId: string) {
    e.preventDefault();
    if (!draggingId || draggingId === targetId) { resetDrag(); return; }
    const ids = slides.map(s => s.id);
    const fromIdx = ids.indexOf(draggingId);
    let toIdx = ids.indexOf(targetId);
    if (fromIdx === -1 || toIdx === -1) { resetDrag(); return; }

    const before = dropTarget?.before ?? true;
    ids.splice(fromIdx, 1);
    if (fromIdx < toIdx) toIdx -= 1;
    ids.splice(before ? toIdx : toIdx + 1, 0, draggingId);
    onReorder(ids);
    resetDrag();
  }

  function resetDrag() {
    setDraggingId(null);
    setDropTarget(null);
  }

  const arrow = 'absolute top-1/2 -translate-y-1/2 z-20 w-7 h-7 rounded-full bg-surface/95 backdrop-blur border border-separator shadow-lg flex items-center justify-center text-label-secondary hover:text-label hover:bg-surface-1 transition-colors disabled:opacity-0 disabled:pointer-events-none';

  return (
    <div className="relative min-w-0 max-w-full">
      {/* Arrow pills only — no edge-fade gradients. The strip floats directly over the
          canvas with no panel behind it, so a gradient fading to a surface colour would
          paint an opaque smear over the artwork rather than blending into anything. */}
      {edges.overflowing && (
        <>
          <button type="button" aria-label="Scroll slides left" disabled={edges.atStart} onClick={() => nudge(-1)} className={`${arrow} left-1`}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <button type="button" aria-label="Scroll slides right" disabled={edges.atEnd} onClick={() => nudge(1)} className={`${arrow} right-1`}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </>
      )}
      <div
        ref={scrollerRef}
        onScroll={syncEdges}
        className="flex items-center p-3 gap-2 overflow-x-auto overflow-y-visible scroll-smooth [&::-webkit-scrollbar]:hidden"
        style={{ minHeight: STRIP_HEIGHT_PX, scrollbarWidth: 'none' }}
        onDragEnd={resetDrag}
      >
        {slides.map((s, i) => (
          <SlideCard
            key={s.id}
            slide={s}
            index={i}
            isActive={s.id === activeSlideId}
            isDragging={draggingId === s.id}
            dropTarget={dropTarget?.id === s.id ? dropTarget : null}
            onSelect={() => onSelect(s.id)}
            onRename={name => onRename(s.id, name)}
            onDelete={() => onDelete(s.id)}
            onDragStart={e => handleDragStart(e, s.id)}
            onDragOver={e => handleDragOver(e, s.id)}
            onDrop={e => handleDrop(e, s.id)}
          />
        ))}

        <button
          type="button"
          onClick={e => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            setPicker(picker ? null : { left: Math.max(8, Math.min(r.left, window.innerWidth - 232)), top: r.top - 8 });
          }}
          aria-haspopup="menu"
          aria-expanded={!!picker}
          className="shrink-0 flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-separator hover:border-tint text-label-tertiary hover:text-label transition-colors"
          style={{ width: CARD_WIDTH_PX, height: CARD_HEIGHT_PX }}
          title="Add slide"
          aria-label="Add slide"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="12" y1="5" x2="12" y2="19"/>
            <line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          <span className="text-caption font-medium">Add slide</span>
        </button>

        {picker && createPortal(
          <>
            <div className="fixed inset-0 z-[60]" onClick={() => setPicker(null)} aria-hidden="true" />
            <div
              role="menu"
              aria-label="Add slide"
              className="fixed z-[61] w-56 max-h-[60vh] overflow-y-auto bg-surface-1/95 backdrop-blur-xl border border-separator rounded-xl shadow-2xl p-1.5 flex flex-col gap-0.5"
              style={{ left: picker.left, top: picker.top, transform: 'translateY(-100%)' }}
            >
              <button
                type="button" role="menuitem"
                onClick={() => { onAdd(); setPicker(null); }}
                className="flex items-center gap-2.5 w-full px-2 py-1.5 rounded-md text-body-sm text-label hover:bg-surface-2 transition-colors text-left"
              >
                <span className="shrink-0 w-7 h-7 rounded-md border border-dashed border-separator flex items-center justify-center text-label-tertiary">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                </span>
                Blank slide
              </button>
              {slides.length > 0 && (
                <>
                  <div className="px-2 pt-2 pb-1 text-caption-sm font-medium text-label-tertiary">From the template</div>
                  {slides.map((s, i) => (
                    <button
                      key={s.id} type="button" role="menuitem"
                      onClick={() => { onDuplicateSlide(s.id); setPicker(null); }}
                      className="flex items-center gap-2.5 w-full px-2 py-1.5 rounded-md text-body-sm text-label hover:bg-surface-2 transition-colors text-left"
                    >
                      <span className="shrink-0 w-7 h-7 rounded-md bg-surface-2 border border-separator flex items-center justify-center text-caption-sm font-semibold text-label-secondary">{i + 1}</span>
                      <span className="truncate">{s.name}</span>
                    </button>
                  ))}
                </>
              )}
            </div>
          </>,
          document.body,
        )}
      </div>
    </div>
  );
}

// ── SlideCard ────────────────────────────────────────────────────────────────

function SlideCard({
  slide, index, isActive, isDragging, dropTarget,
  onSelect, onRename, onDelete,
  onDragStart, onDragOver, onDrop,
}: {
  slide: SlideRow;
  index: number;
  isActive: boolean;
  isDragging: boolean;
  dropTarget: { id: string; before: boolean } | null;
  onSelect: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState(slide.name);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const inputRef              = useRef<HTMLInputElement>(null);

  // Keep the draft in sync when the slide's name changes underneath us (rename committed, undo,
  // reload). Adjusted during render instead of in an effect: identical resulting state, minus the
  // extra render pass. https://react.dev/learn/you-might-not-need-an-effect
  const [syncedName, setSyncedName] = useState(slide.name);
  if (syncedName !== slide.name) {
    setSyncedName(slide.name);
    setDraft(slide.name);
  }

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  function commit() {
    const trimmed = draft.trim();
    setEditing(false);
    if (trimmed && trimmed !== slide.name) onRename(trimmed);
    else                                    setDraft(slide.name);
  }
  function cancel() { setDraft(slide.name); setEditing(false); }

  return (
    <>
      <div
        draggable={!editing}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onClick={() => { if (!editing) onSelect(); }}
        data-slide-id={slide.id}
        className={`relative shrink-0 rounded-lg cursor-pointer transition-opacity group ${
          isDragging ? 'opacity-40' : 'opacity-100'
        }`}
        style={{ width: CARD_WIDTH_PX }}
      >
        {/* Drop indicator line */}
        {dropTarget && (
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-tint pointer-events-none"
            style={{ [dropTarget.before ? 'left' : 'right']: -4 }}
          />
        )}

        {/* Apple-style close button — top-left of thumbnail, visible on hover */}
        <button
          type="button"
          onClick={e => { e.stopPropagation(); setConfirmingDelete(true); }}
          className="absolute -top-1.5 -left-1.5 z-10 w-5 h-5 rounded-full bg-surface-2/85 backdrop-blur-sm flex items-center justify-center text-label shadow-lg ring-1 ring-separator hover:bg-surface-2 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
          title="Delete slide"
          aria-label={`Delete ${slide.name}`}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <line x1="2.5" y1="2.5" x2="7.5" y2="7.5" />
            <line x1="7.5" y1="2.5" x2="2.5" y2="7.5" />
          </svg>
        </button>

        {/* Thumbnail area */}
        <div
          className={`flex items-center justify-center rounded-lg border-2 transition-colors ${
            isActive
              ? 'border-tint bg-surface-2'
              : 'border-separator bg-surface-1 group-hover:border-label-quaternary'
          }`}
          style={{ height: CARD_HEIGHT_PX }}
        >
          <span className={`text-2xl font-semibold tracking-tight ${isActive ? 'text-label' : 'text-label-quaternary'}`}>
            {index + 1}
          </span>
        </div>

        {/* Name (inline-editable), centered */}
        <div className="mt-1 px-1 min-w-0">
          {editing ? (
            <input
              ref={inputRef}
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onBlur={commit}
              onClick={e => e.stopPropagation()}
              onKeyDown={e => {
                if (e.key === 'Enter')  { e.preventDefault(); commit(); }
                if (e.key === 'Escape') { e.preventDefault(); cancel(); }
              }}
              className="w-full bg-surface border border-tint rounded px-1.5 py-0.5 text-caption-sm outline-none text-label text-center"
            />
          ) : (
            <div
              onClick={e => {
                if (!isActive) return;             // first click = select; click again on active card name = edit
                e.stopPropagation();
                setEditing(true);
              }}
              className={`truncate text-center text-caption-sm font-medium ${isActive ? 'text-label' : 'text-label-tertiary'}`}
              title={slide.name}
            >
              {slide.name}
            </div>
          )}
        </div>
      </div>

      {confirmingDelete && (
        <ConfirmDeleteDialog
          slideName={slide.name}
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={() => { setConfirmingDelete(false); onDelete(); }}
        />
      )}
    </>
  );
}

// ── ConfirmDeleteDialog ──────────────────────────────────────────────────────
// iOS-style alert: frosted backdrop, centered card, side-by-side actions.

function ConfirmDeleteDialog({
  slideName, onCancel, onConfirm,
}: {
  slideName: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  // Escape cancels. Enter does NOT confirm — a destructive action must never fire from a stray
  // Enter (destructive-actions.md / confirmation-flows.md). Default focus is the safe action (Cancel).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onCancel}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="del-slide-title"
      aria-describedby="del-slide-desc"
    >
      <div
        onClick={e => e.stopPropagation()}
        className="bg-surface-1/95 backdrop-blur-xl rounded-2xl shadow-2xl border border-separator w-72 overflow-hidden"
      >
        <div className="px-5 pt-5 pb-4 text-center">
          <h3 id="del-slide-title" className="text-body-sm font-semibold text-label mb-1.5">Delete slide?</h3>
          <p id="del-slide-desc" className="text-caption-sm text-label-tertiary leading-relaxed">
            &ldquo;{slideName}&rdquo; will be removed. This cannot be undone.
          </p>
        </div>
        <div className="grid grid-cols-2 border-t border-separator">
          <button
            onClick={onCancel}
            autoFocus
            className="py-3 text-sm font-medium text-label-secondary hover:bg-surface-2/60 transition-colors border-r border-separator"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="py-3 text-sm font-semibold text-danger hover:bg-surface-2/60 transition-colors"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
