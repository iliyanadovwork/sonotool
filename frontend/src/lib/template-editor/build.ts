// ─────────────────────────────────────────────────────────────────────────────
// Builder API — turns a compact SlideSpec into a valid SlideRow (a full
// CarouselSettings = defaults + overrides + element builders). Pure; runs in Node
// (headless CLI) and the browser. A headless agent authors SlideSpec/DesignSpec
// objects (or JSON) and hands them to the persist layer.
// ─────────────────────────────────────────────────────────────────────────────

import {
  defaultCarouselSettings, defaultTextBox, defaultImageBox, defaultChartBox,
  FADE_LAYER_ID,
} from '../../app/components/templateEditorTypes';
import type {
  CarouselSettings, TextBoxStyle, ImageBox, ChartBox,
} from '../../app/components/templateEditorTypes';
import type { SlideRow } from './slide-serde';

export type ImageBoxSpec = Parameters<typeof defaultImageBox>[0];
export type ChartBoxSpec = Parameters<typeof defaultChartBox>[0];
export type TextBoxSpec = Partial<TextBoxStyle> & { text: string };

export interface SlideSpec {
  name?: string;
  headline?: string;
  subheadline?: string;
  /** Per-slide Instagram caption (≤2199 chars). */
  caption?: string;
  /** Overrides merged over defaultCarouselSettings() (e.g. canvasColor, fontSize, headlineColor). */
  settings?: Partial<CarouselSettings>;
  textBoxes?: TextBoxSpec[];
  imageBoxes?: ImageBoxSpec[];
  chartBoxes?: ChartBoxSpec[];
}

export interface DesignSpec {
  name?: string;
  slides: SlideSpec[];
}

function newSlideId(): string {
  return (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
    ? crypto.randomUUID()
    : `sl-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

/** Build one valid SlideRow from a compact spec. templateId is left blank — the
 *  persist layer sets it to the created parent id. */
export function buildSlide(spec: SlideSpec, position = 0): SlideRow {
  // fillPlaceholder defaults ON in defaultTextBox() (the editor clears it the moment a human
  // types). A headless builder never types, so force it OFF for authored boxes — otherwise the
  // canvas's placeholder effect overwrites the real text with lorem (in the render AND, on next
  // editor open, in the DB). An explicit spec `fillPlaceholder: true` still wins (spread last).
  const textBoxes: TextBoxStyle[] = (spec.textBoxes ?? []).map(t => ({ ...defaultTextBox(), fillPlaceholder: false, ...t }));
  const imageBoxes: ImageBox[] = (spec.imageBoxes ?? []).map(defaultImageBox);
  const chartBoxes: ChartBox[] = (spec.chartBoxes ?? []).map(defaultChartBox);

  const settings: CarouselSettings = {
    ...defaultCarouselSettings(),
    ...spec.settings,
    textBoxes,
    imageBoxes,
    chartBoxes: chartBoxes.length ? chartBoxes : undefined,
  };

  // Deterministic z-order (bottom→top) unless the caller pinned one: images, fade,
  // charts, text on top. Fade sentinel only when a fade is on.
  if (!settings.layerOrderIds) {
    const fadeOn = !!(settings.showFade || settings.showTopFade);
    settings.layerOrderIds = [
      ...imageBoxes.map(b => b.id),
      ...(fadeOn ? [FADE_LAYER_ID] : []),
      ...chartBoxes.map(c => c.id),
      ...textBoxes.map(t => t.id),
    ];
  }

  return {
    id: newSlideId(),
    templateId: '',
    name: spec.name ?? (position === 0 ? 'main' : `supporting_${position}`),
    position,
    headline: spec.headline ?? '',
    subheadline: spec.subheadline ?? '',
    caption: spec.caption ?? '',
    settings,
  };
}

/** Build the ordered slide array for a template/post from a DesignSpec. */
export function buildSlides(spec: DesignSpec): SlideRow[] {
  return spec.slides.map((s, i) => buildSlide(s, i));
}
