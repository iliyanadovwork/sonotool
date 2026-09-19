// ─────────────────────────────────────────────────────────────────────────────
// Inspect — read a template/post back as a compact, agent-readable summary.
// The write path (build/persist) turns a spec into ~94 columns; this is the
// reverse: rows → what an agent needs to know to reason about or edit a design
// (elements, geometry, fonts/weights/spans, placeholders, charts, fades).
// ─────────────────────────────────────────────────────────────────────────────

import type { SupabaseClient } from '@supabase/supabase-js';
import { rowToSlide, TEMPLATE_TABLES, POST_TABLES } from './slide-serde';
import { safeZone, outsideSafeZone } from '../../app/components/templateEditorTypes';

interface ElementSummary {
  layer: number;                 // z-position (bottom → top) from layerOrderIds
  kind: 'image' | 'placeholder' | 'text' | 'chart' | 'fade';
  // Edges on which this element escapes the slide's safe zone (absent = inside).
  // A deliberate bleed is fine; an accidental one is what this surfaces.
  outsideSafeZone?: ('top' | 'left' | 'right' | 'bottom')[];
  id?: string;
  [k: string]: unknown;
}

export interface SlideSummary {
  slideId: string;
  name: string;
  position: number;
  canvasColor?: string;
  // The rectangle content should sit inside: 60px from top/sides and 60px above
  // the fade floor. Place subject imagery here; escapes are listed per element.
  safeZone?: { x: number; y: number; width: number; height: number; bottom: number; fadeFloor: number };
  caption?: string;            // this slide's own IG caption (slide 0's publishes)
  captionLength?: number;
  lockedSettings?: string[];   // slide-wide settings a post may not change
  fade?: { bottom?: { intensity: number; floor: number; reach: number }; top?: { intensity: number; floor: number; reach: number } };
  elements: ElementSummary[];    // in z-order, bottom → top
}

export interface DesignSummary {
  id: string;
  kind: 'template' | 'post';
  name: string;
  userId: string;
  createdAt?: string;
  caption?: string;         // EFFECTIVE publish caption: slide 0's, else the legacy post-level value
  captionLength?: number;
  slides: SlideSummary[];
  unfilledPlaceholders: { slide: string; label: string; box: string }[];
}

const short = (u?: string | null) => (u ? u.split('/').slice(-1)[0].slice(0, 60) : undefined);

export async function inspectDesign(
  client: SupabaseClient, kind: 'template' | 'post', id: string,
): Promise<DesignSummary> {
  const tables = kind === 'post' ? POST_TABLES : TEMPLATE_TABLES;

  const { data: parent, error: pErr } = await client
    .from(tables.parent).select('*').eq('id', id).single();
  if (pErr || !parent) throw new Error(`${kind} ${id} not found: ${pErr?.message ?? 'no row'}`);

  const { data: rows, error: sErr } = await client
    .from(tables.slides).select('*').eq(tables.slideFk, id).order('position');
  if (sErr) throw new Error(`fetch slides failed: ${sErr.message}`);

  const p = parent as Record<string, unknown>;
  const unfilled: DesignSummary['unfilledPlaceholders'] = [];

  const slides: SlideSummary[] = ((rows ?? []) as Record<string, unknown>[]).map(row => {
    const sl = rowToSlide(row);
    const s = sl.settings;
    // z-order: layerOrderIds when present, else images → fade → charts → text
    // A deleted fade layer is absent, not merely off — don't report it as an
    // element (CLI render won't draw it, so reporting it would mislead an agent).
    const fadeOn = !s.fadeRemoved && !!(s.showFade || s.showTopFade);
    const order: string[] = s.layerOrderIds ?? [
      ...(s.imageBoxes ?? []).map(b => b.id),
      ...(fadeOn ? ['__fade__'] : []),
      ...(s.chartBoxes ?? []).map(c => c.id),
      ...(s.textBoxes ?? []).map(t => t.id),
    ];
    const at = (eid: string) => { const i = order.indexOf(eid); return i < 0 ? order.length : i; };

    // The rectangle content should live in (60px inset, 60px above the fade
    // floor). Reported so an agent places inside it instead of inferring the
    // fade geometry by hand — which is how a face ended up clipped at the top.
    const zone = safeZone(s);
    const elements: ElementSummary[] = [];
    for (const b of s.imageBoxes ?? []) {
      const isPh = !!b.placeholder && !b.url;
      if (isPh) unfilled.push({ slide: sl.name, label: b.placeholderLabel ?? '(unlabelled)', box: b.id });
      elements.push({
        layer: at(b.id), id: b.id,
        ...(b.name ? { name: b.name } : {}),
        kind: b.placeholder ? 'placeholder' : 'image',
        ...(b.placeholder ? { label: b.placeholderLabel, filled: !!b.url } : {}),
        x: b.x, y: b.y, w: b.width, h: b.height,
        ...(b.url ? { file: short(b.url) } : {}),
        ...(b.videoUrl ? { video: short(b.videoUrl) } : {}),
        ...(b.lockedProps?.length ? { lockedProps: b.lockedProps } : {}),
        ...(b.hidden ? { hidden: true } : {}), ...(b.locked ? { locked: true } : {}),
        ...(() => {
          // Skip what the builder can't (and shouldn't) move: full-bleed
          // background textures, and geometry-locked template furniture like the
          // brand logo, which sits outside the zone on purpose.
          const fullBleed = b.x <= 0 && b.y <= 0 && b.width >= 1080 && b.height >= 1350;
          const geomLocked = (b.lockedProps ?? []).some(pn => pn === 'x' || pn === 'y' || pn === 'width' || pn === 'height');
          const esc = (fullBleed || geomLocked) ? [] : outsideSafeZone(b, zone);
          return esc.length ? { outsideSafeZone: esc } : {};
        })(),
      });
    }
    if (fadeOn) elements.push({ layer: at('__fade__'), kind: 'fade' });
    for (const c of s.chartBoxes ?? []) {
      elements.push({
        layer: at(c.id), id: c.id, ...(c.name ? { name: c.name } : {}), kind: 'chart',
        artist: c.artistName, period: c.period, mode: c.mode,
        points: c.data?.length ?? 0, releases: c.releases?.length ?? 0,
        x: c.x, y: c.y, w: c.width, h: c.height,
        ...(c.hidden ? { hidden: true } : {}),
        ...(() => { const esc = outsideSafeZone(c, zone); return esc.length ? { outsideSafeZone: esc } : {}; })(),
      });
    }
    for (const t of s.textBoxes ?? []) {
      elements.push({
        layer: at(t.id), id: t.id, ...(t.name ? { name: t.name } : {}), kind: 'text',
        text: (t.text ?? '').slice(0, 80),
        font: t.fontLabel, size: t.fontSize, weight: t.fontWeight,
        ...(t.secondaryWeight != null ? { secondaryWeight: t.secondaryWeight } : {}),
        ...(t.spans?.length ? { spans: t.spans.map(sp => ({ text: sp.text.slice(0, 40), ...(sp.secondary ? { secondary: true } : {}), ...(sp.weight != null ? { weight: sp.weight } : {}) })) } : {}),
        ...(t.fitToWidth ? { fitToWidth: true } : {}),
        ...(t.singleLine ? { singleLine: true } : {}),
        ...(t.fillPlaceholder ? { loremPlaceholder: true } : {}),
        ...(t.lockedProps?.length ? { lockedProps: t.lockedProps } : {}),
        color: t.color, align: t.align,
        x: t.x, y: t.y, w: t.width, h: t.height,
        ...(t.hidden ? { hidden: true } : {}), ...(t.locked ? { locked: true } : {}),
      });
    }
    elements.sort((a, b) => a.layer - b.layer);

    return {
      slideId: sl.id, name: sl.name, position: sl.position,
      safeZone: { x: zone.x, y: zone.y, width: zone.width, height: zone.height, bottom: zone.bottom, fadeFloor: zone.fadeFloor },
      // Per-slide caption (each slide carries its own; slide 0's publishes).
      ...(sl.caption ? { caption: sl.caption, captionLength: sl.caption.length } : {}),
      canvasColor: s.canvasColor,
      ...(s.lockedSettings?.length ? { lockedSettings: s.lockedSettings } : {}),
      ...(fadeOn ? {
        fade: {
          ...(s.showFade ? { bottom: { intensity: s.fadeIntensity, floor: s.fadeFloor, reach: s.fadeReach } } : {}),
          ...(s.showTopFade ? { top: { intensity: s.topFadeIntensity ?? 85, floor: s.topFadeFloor ?? 20, reach: s.topFadeReach ?? 40 } } : {}),
        },
      } : {}),
      elements,
    };
  });

  return {
    id, kind,
    name: String(p.name ?? ''),
    userId: String(p.user_id ?? ''),
    createdAt: p.created_at ? String(p.created_at) : undefined,
    // EFFECTIVE publish caption: the first slide's, falling back to the legacy
    // post-level column for pre-migration rows.
    ...(() => {
      const eff = slides[0]?.caption || (kind === 'post' && typeof p.caption === 'string' ? p.caption : '');
      return eff ? { caption: eff, captionLength: eff.length } : {};
    })(),
    slides,
    unfilledPlaceholders: unfilled,
  };
}
