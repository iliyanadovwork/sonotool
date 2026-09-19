'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import type { ImageBox, TextBoxStyle, ChartBox, LayerKind } from './templateEditorTypes';
import { orderedLayerIds } from './templateEditorTypes';

interface ElementLayersPanelProps {
  imageBoxes: ImageBox[];
  textBoxes: TextBoxStyle[];
  chartBoxes?: ChartBox[];
  orderIds?: string[];
  selectedImageBox: number | null;
  selectedTextBox: number | null;
  selectedChartBox?: number | null;
  onSelect: (kind: LayerKind, index: number) => void;
  onReorder: (ids: string[]) => void;                    // bottom→top id order
  onToggleHidden: (kind: LayerKind, index: number) => void;
  onToggleLocked: (kind: LayerKind, index: number) => void;
  fadeEnabled: boolean;            // show a "Fade" layer row for the settings fade
  fadeHidden: boolean;             // eye state for the fade layer
  onToggleFadeHidden: () => void;
  fadeLocked: boolean;             // lock state for the fade layer — pins its stack position
  onToggleFadeLocked: () => void;
  embedded?: boolean;              // inline mode: render statically (no floating gutter pill) for the right inspector
  renderBody?: (kind: LayerKind, index: number, id: string) => ReactNode;   // fused accordion: selected rows expand to this
}

const EyeIcon = ({ off }: { off: boolean }) => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {off ? (
      <>
        <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 10 8 10 8a18.5 18.5 0 0 1-2.16 3.19M6.61 6.61A18.5 18.5 0 0 0 2 12s3 8 10 8a9.12 9.12 0 0 0 5.39-1.61" />
        <line x1="2" y1="2" x2="22" y2="22" />
      </>
    ) : (
      <>
        <path d="M2 12s3-8 10-8 10 8 10 8-3 8-10 8-10-8-10-8z" />
        <circle cx="12" cy="12" r="3" />
      </>
    )}
  </svg>
);

const LockIcon = ({ locked }: { locked: boolean }) => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="11" width="18" height="11" rx="2" />
    {locked
      ? <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      : <path d="M7 11V7a5 5 0 0 1 9.9-1" />}
  </svg>
);

// Floating panel listing the free elements (image + text boxes) top→bottom by draw order.
// Drag to reorder, click to select, eye to show/hide, lock to block canvas interaction.
export function ElementLayersPanel({
  imageBoxes, textBoxes, chartBoxes = [], orderIds,
  fadeEnabled, fadeHidden, onToggleFadeHidden, fadeLocked, onToggleFadeLocked,
  selectedImageBox, selectedTextBox, selectedChartBox = null,
  onSelect, onReorder, onToggleHidden, onToggleLocked,
  embedded = false, renderBody,
}: ElementLayersPanelProps) {
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const [open, setOpen] = useState(false);

  // Source order is bottom→top; show top layer first.
  const rows = [...orderedLayerIds(imageBoxes, textBoxes, orderIds, fadeEnabled, chartBoxes)].reverse();

  // Per-type label + numbering for image boxes, matching the inspector exactly (numbered by array
  // order, so "Overlay 2" here is the same element as "Overlay 2" in the inspector). Overlays read
  // "Overlay", glow textures "Light leak", everything else "Image".
  const imgTypeOf = (b: ImageBox) => b.videoUrl ? 'Video' : b.isOverlay ? 'Overlay' : b.glow ? 'Light leak' : 'Image';
  const imgTypeCounts: Record<string, number> = {};
  imageBoxes.forEach(b => { const t = imgTypeOf(b); imgTypeCounts[t] = (imgTypeCounts[t] ?? 0) + 1; });
  const imgSeen: Record<string, number> = {};
  const imgLabelByIndex = imageBoxes.map(b => {
    const t = imgTypeOf(b); imgSeen[t] = (imgSeen[t] ?? 0) + 1;
    return imgTypeCounts[t] > 1 ? `${t} ${imgSeen[t]}` : t;
  });

  const resolve = (kind: LayerKind, id: string) => {
    const arr: Array<{ id: string }> = kind === 'image' ? imageBoxes : kind === 'chart' ? chartBoxes : textBoxes;
    const index = arr.findIndex(e => e.id === id);
    return { index, el: arr[index] as (ImageBox & TextBoxStyle & ChartBox) | undefined };
  };

  const commitReorder = (from: number, to: number) => {
    if (from === to) return;
    const next = [...rows];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onReorder(next.map(r => r.id).reverse());   // back to bottom→top
  };

  // The Outlines toggle sits above Layers in the gutter, but it only renders when there are free
  // elements — so offset Layers below it only then; otherwise Layers takes the top slot itself.
  const hasElements = imageBoxes.length + textBoxes.length + chartBoxes.length > 0;
  return (
    <div onMouseDown={e => e.stopPropagation()} style={embedded ? { position: 'static', width: '100%' } : { position: 'absolute', top: hasElements ? 36 : 0, right: '100%', marginRight: 8, zIndex: 1100 }}>
      {/* Collapsed "Layers" pill — gutter mode only; embedded (inspector) mode shows the list inline. */}
      {!embedded && (
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-label="Layers"
        style={{ display: 'flex', alignItems: 'center', gap: 6, height: 28, padding: '0 9px', borderRadius: 7, background: 'color-mix(in srgb, var(--c-bg-1) 78%, transparent)', border: '1px solid var(--c-sep)', color: 'var(--c-label-2)', fontSize: 11, fontWeight: 600, boxShadow: 'var(--sh-md)', backdropFilter: 'blur(10px)', cursor: 'pointer' }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" />
        </svg>
        Layers
        <span style={{ color: 'var(--c-label-4)', fontVariantNumeric: 'tabular-nums' }}>{rows.length}</span>
      </button>
      )}

      {(open || embedded) && (
        <div style={embedded ? {
          width: '100%', padding: '6px', display: 'flex', flexDirection: 'column', gap: 2,
        } : {
          // Absolute + right-aligned so the collapsed pill keeps its place when the list opens,
          // and the list drops down within the gutter rather than over the canvas.
          position: 'absolute', top: '100%', right: 0, marginTop: 6,
          width: 208, maxHeight: '64vh', overflowY: 'auto',
          background: 'color-mix(in srgb, var(--c-bg-1) 92%, transparent)', border: '1px solid var(--c-sep)', borderRadius: 10,
          padding: '6px', display: 'flex', flexDirection: 'column', gap: 2,
          boxShadow: 'var(--sh-lg)', backdropFilter: 'blur(12px)',
        }}>
          {rows.map((row, di) => {
        const isFade = row.kind === 'fade';
        let index = -1;
        let selected = false, hidden = false, locked = false;
        let label = 'Fade';
        let thumbUrl: string | undefined;
        if (isFade) {
          hidden = fadeHidden;
          locked = fadeLocked;
        } else {
          const r = resolve(row.kind, row.id);
          if (!r.el || r.index < 0) return null;
          index = r.index;
          selected = row.kind === 'image' ? selectedImageBox === index
                   : row.kind === 'chart' ? selectedChartBox === index
                   : selectedTextBox === index;
          hidden = !!r.el.hidden;
          locked = !!r.el.locked;
          label = row.kind === 'image' ? (imgLabelByIndex[index] ?? 'Image')
                : row.kind === 'chart' ? `Chart · ${r.el.artistName || 'Artist'}`
                : ((r.el.text || 'Text').split('\n')[0] || 'Text');
          thumbUrl = row.kind === 'image' ? r.el.url : undefined;
        }
        const isOver = overIdx === di;
        const isDragging = dragIdx === di;
        return (
          <div key={row.id}>
          <div
            draggable={!(isFade && locked)}
            onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; setDragIdx(di); }}
            onDragOver={e => { e.preventDefault(); setOverIdx(di); }}
            onDrop={e => { e.preventDefault(); if (dragIdx !== null) commitReorder(dragIdx, di); setDragIdx(null); setOverIdx(null); }}
            onDragEnd={() => { setDragIdx(null); setOverIdx(null); }}
            onClick={() => { if (!isFade) onSelect(row.kind, index); }}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              height: 34, padding: '0 6px', borderRadius: 6, cursor: (isFade && locked) ? 'default' : 'grab',
              border: `1px solid ${(isOver || selected) ? 'var(--c-tint)' : 'var(--c-sep-subtle)'}`,
              background: selected ? 'var(--c-bg-2)' : isOver ? 'var(--c-bg-1)' : 'transparent',
              opacity: isDragging ? 0.4 : hidden ? 0.45 : 1,
              userSelect: 'none', transition: 'background 0.1s, border-color 0.1s, opacity 0.1s',
            }}
          >
            {/* Grip */}
            <svg width="7" height="11" viewBox="0 0 7 11" aria-hidden="true" style={{ flexShrink: 0, fill: 'var(--c-label-4)' }}>
              <circle cx="1.5" cy="1.5" r="1.2" /><circle cx="5.5" cy="1.5" r="1.2" />
              <circle cx="1.5" cy="5.5" r="1.2" /><circle cx="5.5" cy="5.5" r="1.2" />
              <circle cx="1.5" cy="9.5" r="1.2" /><circle cx="5.5" cy="9.5" r="1.2" />
            </svg>

            {/* Thumbnail / type glyph */}
            {isFade ? (
              <div style={{ width: 22, height: 22, borderRadius: 3, flexShrink: 0, background: 'linear-gradient(to top, var(--c-bg-base), var(--c-label-3))', border: '1px solid var(--c-sep)' }} />
            ) : thumbUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={thumbUrl} alt="" style={{ width: 22, height: 22, objectFit: 'cover', borderRadius: 3, flexShrink: 0, background: 'var(--c-bg-2)' }} />
            ) : row.kind === 'chart' ? (
              <div style={{ width: 22, height: 22, borderRadius: 3, flexShrink: 0, background: 'var(--c-bg-2)', color: '#04df9d', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="3 17 9 11 13 15 21 7" /><polyline points="15 7 21 7 21 13" />
                </svg>
              </div>
            ) : (
              <div style={{ width: 22, height: 22, borderRadius: 3, flexShrink: 0, background: 'var(--c-bg-2)', color: 'var(--c-label-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700 }}>T</div>
            )}

            {/* Label */}
            <span style={{ flex: 1, minWidth: 0, fontSize: 11, color: 'var(--c-label-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {label}
            </span>

            {/* Show / hide */}
            <button
              type="button"
              onClick={e => { e.stopPropagation(); if (isFade) onToggleFadeHidden(); else onToggleHidden(row.kind, index); }}
              onMouseDown={e => e.stopPropagation()}
              title={hidden ? 'Show' : 'Hide'}
              aria-label={`${hidden ? 'Show' : 'Hide'} ${label} layer`}
              aria-pressed={!hidden}
              style={{ flexShrink: 0, width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', background: 'transparent', cursor: 'pointer', color: hidden ? 'var(--c-label-4)' : 'var(--c-label-2)' }}
            >
              <EyeIcon off={hidden} />
            </button>

            {/* Lock — fade included. A locked fade is pinned in the stack (can't be reordered);
                a locked element can't be selected/moved on the canvas. */}
            <button
              type="button"
              onClick={e => { e.stopPropagation(); if (isFade) onToggleFadeLocked(); else onToggleLocked(row.kind, index); }}
              onMouseDown={e => e.stopPropagation()}
              title={locked ? 'Unlock' : 'Lock'}
              aria-label={`${locked ? 'Unlock' : 'Lock'} ${label} layer`}
              aria-pressed={locked}
              style={{ flexShrink: 0, width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', background: 'transparent', cursor: 'pointer', color: locked ? 'var(--c-tint)' : 'var(--c-label-3)' }}
            >
              <LockIcon locked={locked} />
            </button>
          </div>
          {/* Fused accordion: the selected row expands to its element controls (body stays mounted
              while collapsed via grid-rows 0fr/1fr so in-progress drafts survive). */}
          {renderBody && !isFade && (
            <div style={{ display: 'grid', gridTemplateRows: selected ? '1fr' : '0fr', transition: 'grid-template-rows 180ms cubic-bezier(0.2,0,0,1)' }}>
              <div style={{ overflow: 'hidden' }}>
                <div style={{ padding: '8px 4px 10px' }}>{renderBody(row.kind, index, row.id)}</div>
              </div>
            </div>
          )}
          </div>
        );
          })}
        </div>
      )}
    </div>
  );
}
