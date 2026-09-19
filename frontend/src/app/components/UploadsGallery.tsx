'use client';

import { useCallback, useEffect, useMemo, useState, type DragEvent } from 'react';
import type { BrandLogo } from '../types';

// Tray items can be images or uploaded videos (post-videos bucket / .mp4). Videos render as a muted,
// looping <video> thumbnail instead of an <img>.
const isVid = (u: string) => u.includes('/post-videos/') || /\.mp4($|\?)/i.test(u);

interface UploadsGalleryProps {
  logos: BrandLogo[];
  activeLogoUrl?: string | null;
  onSelect?: (url: string) => void;
  onDelete?: (id: string) => void;
  // When provided, each image becomes draggable with these handlers (e.g. drag onto the canvas)
  dragProps?: (url: string) => { draggable: boolean; onDragStart: (e: DragEvent) => void; onDragEnd: () => void };
}

type LayoutMode = 'compact' | 'normal';
interface ImageMeta { aspect: number; transparent: boolean; mode: LayoutMode }

// Canva-style justified gallery. Variable row heights; rows fill container
// width edge-to-edge (modulo the cap). Card inner area exactly matches each
// image's natural aspect ratio so the image renders with no padding and no
// clipping. Transparent images (PNG/SVG alpha) classify as 'compact' so wide
// wordmarks/icons don't dominate rows; opaque images (photos/screenshots)
// classify as 'normal' and can grow into feature-sized cards.
export function UploadsGallery({
  logos,
  activeLogoUrl,
  onSelect,
  onDelete,
  dragProps,
}: UploadsGalleryProps) {
  const [imageMeta, setImageMeta] = useState<Record<string, ImageMeta>>({});
  const [containerWidth, setContainerWidth] = useState(0);

  // Measure the gallery when the node attaches (commit time, DOM already laid
  // out) and keep it in sync via ResizeObserver. The returned cleanup runs when
  // the node detaches (React 19 ref cleanup), so the observer is disconnected.
  const galleryRef = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    setContainerWidth(el.offsetWidth);
    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width;
      if (typeof w === 'number' && w > 0) setContainerWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Probe each image: natural dimensions + transparency on a 32×32 canvas.
  useEffect(() => {
    let cancelled = false;
    logos.forEach(logo => {
      if (imageMeta[logo.id]) return;
      if (isVid(logo.url)) {   // video thumbnail: skip the Image probe; use a default 16:9 cell
        setImageMeta(prev => (prev[logo.id] ? prev : { ...prev, [logo.id]: { aspect: 16 / 9, transparent: false, mode: 'normal' } }));
        return;
      }
      const probe = new globalThis.Image();
      probe.crossOrigin = 'anonymous';
      probe.onload = () => {
        if (cancelled || !probe.naturalWidth || !probe.naturalHeight) return;
        const aspect = probe.naturalWidth / probe.naturalHeight;
        let transparent = false;
        try {
          const canvas = document.createElement('canvas');
          canvas.width  = 32;
          canvas.height = 32;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (ctx) {
            ctx.drawImage(probe, 0, 0, 32, 32);
            const data = ctx.getImageData(0, 0, 32, 32).data;
            for (let i = 3; i < data.length; i += 4) {
              if (data[i] < 200) { transparent = true; break; }
            }
          }
        } catch { /* CORS-tainted canvas — assume opaque */ }
        const mode: LayoutMode = transparent ? 'compact' : 'normal';
        if (cancelled) return;
        setImageMeta(prev => (prev[logo.id] ? prev : { ...prev, [logo.id]: { aspect, transparent, mode } }));
      };
      probe.src = logo.url;
    });
    return () => { cancelled = true; };
  }, [logos, imageMeta]);

  const rows = useMemo(() => {
    if (containerWidth <= 0) return [] as Array<{ items: Array<{ id: string; url: string; width: number; height: number }>; height: number }>;
    const GAP    = 4;
    const BORDER = 2;
    // Justified gallery with a soft height cap. Rows always fill container
    // width edge-to-edge. The cap caps each row's height only if the items
    // already in it collectively have enough "aspect budget" to fill at that
    // height. If they don't (e.g. one solo portrait), we KEEP adding items
    // until sum-of-aspects is large enough to fill at the cap. The last row
    // may still exceed the cap if we run out of items.
    const MAX_INNER = 120 - 2 * BORDER; // ~120px tall cap, tweak to taste

    type RawItem = { id: string; url: string; aspect: number };
    const items: RawItem[] = logos.map(l => ({
      id:     l.id,
      url:    l.url,
      aspect: imageMeta[l.id]?.aspect ?? 1.5,
    }));

    const result: Array<{ items: Array<{ id: string; url: string; width: number; height: number }>; height: number }> = [];
    let current: RawItem[] = [];

    function closeRow() {
      if (current.length === 0) return;
      const sumAspects   = current.reduce((s, it) => s + it.aspect, 0);
      const gapTotal     = (current.length - 1) * GAP;
      const borderTotal  = current.length * 2 * BORDER;
      const availableInner = Math.max(1, containerWidth - gapTotal - borderTotal);
      // Row fills width exactly: card_inner_height = availableInner / sumAspects
      const innerHeight  = availableInner / sumAspects;
      const outerHeight  = innerHeight + 2 * BORDER;
      result.push({
        items: current.map(it => ({
          id:     it.id,
          url:    it.url,
          width:  it.aspect * innerHeight + 2 * BORDER,
          height: outerHeight,
        })),
        height: outerHeight,
      });
      current = [];
    }

    for (const item of items) {
      current.push(item);
      // If the current row at fill-width would already be within the cap, close
      // it. Otherwise keep adding items to grow sum-of-aspects so the fill
      // height drops to/under the cap.
      const sumAspects   = current.reduce((s, it) => s + it.aspect, 0);
      const n            = current.length;
      const gapTotal     = (n - 1) * GAP;
      const borderTotal  = n * 2 * BORDER;
      const availableInner = Math.max(1, containerWidth - gapTotal - borderTotal);
      const innerHeight  = availableInner / sumAspects;
      if (innerHeight <= MAX_INNER) {
        closeRow();
      }
    }
    // Flush any leftover items as the last row (may exceed cap).
    closeRow();
    return result;
  }, [logos, imageMeta, containerWidth]);

  return (
    <div ref={galleryRef} className="flex flex-col gap-1 w-full">
      {rows.map((row, ri) => (
        <div key={ri} className="flex gap-1" style={{ height: row.height }}>
          {row.items.map(item => {
            const isActive = activeLogoUrl === item.url;
            return (
              <div
                key={item.id}
                className="relative group shrink-0"
                style={{ width: item.width, height: item.height }}
              >
                <button
                  {...(dragProps ? dragProps(item.url) : {})}
                  onClick={() => onSelect?.(item.url)}
                  aria-label="Use this upload"
                  aria-pressed={isActive}
                  className={`w-full h-full rounded-md overflow-hidden border-2 transition-colors bg-surface block ${
                    isActive ? 'border-tint' : 'border-separator hover:border-label-quaternary'
                  }${dragProps ? ' cursor-grab active:cursor-grabbing' : ''}`}
                >
                  {isVid(item.url) ? (
                    <video
                      src={item.url}
                      muted loop autoPlay playsInline
                      className="block w-full h-full object-cover"
                    />
                  ) : (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={item.url}
                      alt=""
                      className="block w-full h-full object-cover"
                    />
                  )}
                </button>

                {isActive && (
                  <div className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-tint flex items-center justify-center shadow-sm pointer-events-none z-10 text-on-accent">
                    <svg width="8" height="8" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                      <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </div>
                )}

                {onDelete && (
                  <button
                    onClick={e => { e.stopPropagation(); onDelete(item.id); }}
                    className="absolute -top-2 -left-2 z-10 w-6 h-6 rounded-full bg-surface-2/90 backdrop-blur-sm flex items-center justify-center text-label-secondary shadow-md ring-1 ring-black/30 hover:text-danger opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                    aria-label="Delete upload"
                    title="Delete upload"
                  >
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                      <line x1="2.5" y1="2.5" x2="7.5" y2="7.5"/>
                      <line x1="7.5" y1="2.5" x2="2.5" y2="7.5"/>
                    </svg>
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
