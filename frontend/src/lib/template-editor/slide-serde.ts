// ─────────────────────────────────────────────────────────────────────────────
// Framework-free serialization core for the template editor.
//
// This is the SINGLE SOURCE OF TRUTH for the row ↔ domain mapping between a
// CarouselSettings slide and its ~94-column Postgres row. It imports only the
// pure type/builder module (templateEditorTypes) — NO React, NO DOM, NO Next —
// so it runs unchanged in the browser hook AND in a headless Node CLI / renderer.
//
// The React hook (useTemplateEditor) re-imports these and re-exports the public
// shapes, so its callers are unchanged; a Node CLI imports them directly.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  CarouselSettings, CarouselFontLabel, CarouselFontWeight, CarouselTextAlign,
  LayerId, DividerSubSlotContent,
} from '../../app/components/templateEditorTypes';
import { defaultCarouselSettings, defaultTagStyle } from '../../app/components/templateEditorTypes';

// ── Public shapes ─────────────────────────────────────────────────────────────

// The canonical persisted unit: a slide = { headline, subheadline, settings }
// plus its identity/order. A template OR post is a parent row + an ordered array
// of these (the child tables share this exact shape).
export interface SlideRow {
  id: string;
  templateId: string;
  name: string;
  position: number;
  headline: string;
  subheadline: string;
  // Per-slide Instagram caption (posts; templates may carry defaults that clone
  // into posts). '' in the domain ↔ NULL in the row. The parent posts.caption
  // column is a legacy fallback only — new code reads/writes slide captions.
  caption: string;
  settings: CarouselSettings;
}

// Lets the SAME code drive either the template tables or the post tables.
export interface TableConfig {
  parent:  string;   // parent table: templates or posts
  slides:  string;   // child slides table
  slideFk: string;   // FK column on the slides table that points at the parent id
}
export const TEMPLATE_TABLES: TableConfig = {
  parent:  'template_editor_templates',
  slides:  'template_editor_slides',
  slideFk: 'template_id',
};
export const POST_TABLES: TableConfig = {
  parent:  'template_editor_posts',
  slides:  'template_editor_post_slides',
  slideFk: 'post_id',
};

// Deep clone of a settings object (used by history + duplication).
export function cloneSettings(s: CarouselSettings): CarouselSettings {
  return JSON.parse(JSON.stringify(s)) as CarouselSettings;
}

// ── Row → domain ──────────────────────────────────────────────────────────────
// Every missing column falls back to defaultCarouselSettings(), so partial rows
// are always valid.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function rowToSettings(row: Record<string, any>): CarouselSettings {
  const d = defaultCarouselSettings();
  return {
    logoOpacity:       row.logo_opacity        ?? d.logoOpacity,
    logoScale:         row.logo_scale          ?? d.logoScale,
    logoCornerRadius:  row.logo_corner_radius  ?? d.logoCornerRadius,
    logoShadow:        row.logo_shadow         ?? undefined,
    logoSlotAligns:    row.logo_slot_aligns    ?? undefined,
    headSubGap:        row.head_sub_gap        ?? d.headSubGap,
    aboveLogoGap:      row.above_logo_gap      ?? d.aboveLogoGap,
    contentPadding:    row.content_padding     ?? d.contentPadding,
    showFade:          row.show_fade           ?? d.showFade,
    fadeFloor:         row.fade_floor          ?? d.fadeFloor,
    fadeReach:         row.fade_reach          ?? d.fadeReach,
    fadeIntensity:     row.fade_intensity      ?? d.fadeIntensity,
    showTopFade:       row.show_top_fade       ?? d.showTopFade,
    topFadeFloor:      row.top_fade_floor      ?? d.topFadeFloor,
    topFadeReach:      row.top_fade_reach      ?? d.topFadeReach,
    topFadeIntensity:  row.top_fade_intensity  ?? d.topFadeIntensity,
    bgBlurEnabled:     row.bg_blur_enabled     ?? d.bgBlurEnabled,
    bgBlurAmount:      row.bg_blur_amount      ?? d.bgBlurAmount,
    bgDarkenAmount:    row.bg_darken_amount    ?? d.bgDarkenAmount,
    canvasColor:       row.canvas_color        ?? d.canvasColor,
    textBoxes:         row.text_boxes          ?? d.textBoxes,
    imageBoxes:        row.image_boxes         ?? d.imageBoxes,
    chartBoxes:        row.chart_boxes         ?? undefined,
    layerOrderIds:     row.layer_order_ids     ?? undefined,
    lockedSettings:    row.locked_settings     ?? undefined,
    fadeFloorAnchor:   row.fade_floor_anchor   ?? d.fadeFloorAnchor,
    fadeHidden:        row.fade_hidden         ?? undefined,
    fadeLocked:        row.fade_locked         ?? undefined,
    fadeRemoved:       row.fade_removed        ?? undefined,
    headlineColor:     row.headline_color      ?? d.headlineColor,
    fontSize:          row.font_size           ?? d.fontSize,
    lSpacing:          row.l_spacing           ?? d.lSpacing,
    lHeight:           row.l_height            ?? d.lHeight,
    fontLabel:         (row.font_label         ?? d.fontLabel) as CarouselFontLabel,
    fontWeight:        (row.font_weight        ?? d.fontWeight) as CarouselFontWeight,
    italic:            row.italic              ?? d.italic,
    textAlign:         (row.text_align         ?? d.textAlign) as CarouselTextAlign,
    allCaps:           row.all_caps            ?? d.allCaps,
    headlineShadow:    row.headline_shadow     ?? undefined,
    headlineSpans:     row.headline_spans      ?? null,
    subheadlineColor:  row.subheadline_color   ?? d.subheadlineColor,
    subFontSize:       row.sub_font_size       ?? d.subFontSize,
    subLSpacing:       row.sub_l_spacing       ?? d.subLSpacing,
    subLHeight:        row.sub_l_height        ?? d.subLHeight,
    subFontLabel:      (row.sub_font_label     ?? d.subFontLabel) as CarouselFontLabel,
    subFontWeight:     (row.sub_font_weight    ?? d.subFontWeight) as CarouselFontWeight,
    subItalic:         row.sub_italic          ?? d.subItalic,
    subTextAlign:      (row.sub_text_align     ?? d.subTextAlign) as CarouselTextAlign,
    subAllCaps:        row.sub_all_caps        ?? d.subAllCaps,
    subShadow:         row.sub_shadow          ?? undefined,
    subSpans:          row.sub_spans           ?? null,
    circleBorderColor:    row.circle_border_color    ?? d.circleBorderColor,
    circleBorderWidth:    row.circle_border_width    ?? d.circleBorderWidth,
    circleBorderOpacity:  row.circle_border_opacity  ?? d.circleBorderOpacity,
    circleShadowEnabled:  row.circle_shadow_enabled  ?? d.circleShadowEnabled,
    circleShadowBlur:     row.circle_shadow_blur     ?? d.circleShadowBlur,
    circleShadowOffsetX:  row.circle_shadow_offset_x ?? d.circleShadowOffsetX,
    circleShadowOffsetY:  row.circle_shadow_offset_y ?? d.circleShadowOffsetY,
    circleShadowColor:    row.circle_shadow_color    ?? d.circleShadowColor,
    circleShadowOpacity:  row.circle_shadow_opacity  ?? d.circleShadowOpacity,
    circleLift:           row.circle_lift            ?? d.circleLift,
    circle2BorderColor:   row.circle2_border_color   ?? d.circle2BorderColor,
    circle2BorderWidth:   row.circle2_border_width   ?? d.circle2BorderWidth,
    circle2BorderOpacity: row.circle2_border_opacity ?? d.circle2BorderOpacity,
    circle2ShadowEnabled: row.circle2_shadow_enabled ?? d.circle2ShadowEnabled,
    circle2ShadowBlur:    row.circle2_shadow_blur    ?? d.circle2ShadowBlur,
    circle2ShadowOffsetX: row.circle2_shadow_offset_x ?? d.circle2ShadowOffsetX,
    circle2ShadowOffsetY: row.circle2_shadow_offset_y ?? d.circle2ShadowOffsetY,
    circle2ShadowColor:   row.circle2_shadow_color   ?? d.circle2ShadowColor,
    circle2ShadowOpacity: row.circle2_shadow_opacity ?? d.circle2ShadowOpacity,
    circle2Lift:          row.circle2_lift           ?? d.circle2Lift,
    layerOrder:        (row.layer_order         ?? d.layerOrder) as LayerId[],
    quoteColor:        row.quote_color          ?? d.quoteColor,
    quoteSize:         row.quote_size           ?? d.quoteSize,
    quoteOpacity:      row.quote_opacity        ?? d.quoteOpacity,
    quoteGap:          row.quote_gap            ?? d.quoteGap,
    quoteShadow:       row.quote_shadow         ?? undefined,
    tagStyle:          row.default_tag_style    ?? defaultTagStyle(),
    tagSlots:          row.tag_slots            ?? Array(3).fill(null),
    tagSlotAligns:     row.tag_slot_aligns      ?? undefined,
    tagZoneSlots:      row.tag_zone_slots       ?? undefined,
    quoteSlots:        row.quote_slots          ?? Array(3).fill(null),
    quoteZoneSlots:    row.quote_zone_slots     ?? undefined,
    zoneLogoSlots:     row.zone_logo_slots      ?? undefined,
    logoRowSlots:      row.logo_row_slots       ?? Array(3).fill(false),
    swipeZoneSlots:    row.swipe_zone_slots     ?? undefined,
    dividerSlots:      row.divider_slots        ?? undefined,
    dividerSubSlots:   row.divider_sub_slots    ?? undefined,
    dividerSettings:   row.divider_settings     ?? undefined,
  };
}

// ── Domain → row ──────────────────────────────────────────────────────────────
// Explodes settings into ~90 snake_case scalar columns + JSONB arrays. NOTE:
// image-type divider sub-slots are dropped (they hold ephemeral blob: URLs).
export function slideToRow(slide: SlideRow): Record<string, unknown> {
  const s = slide.settings;
  return {
    name:               slide.name,
    position:           slide.position,
    headline:           slide.headline,
    subheadline:        slide.subheadline,
    caption:            slide.caption || null,
    logo_opacity:       s.logoOpacity,
    logo_scale:         s.logoScale       ?? 100,
    logo_corner_radius: s.logoCornerRadius ?? 0,
    logo_shadow:        s.logoShadow      ?? null,
    logo_slot_aligns:   s.logoSlotAligns  ?? ['center', 'center', 'center'],
    head_sub_gap:       s.headSubGap,
    above_logo_gap:     s.aboveLogoGap,
    content_padding:    s.contentPadding,
    show_fade:          s.showFade,
    fade_floor:         s.fadeFloor,
    fade_reach:         s.fadeReach,
    fade_intensity:     s.fadeIntensity,
    show_top_fade:      s.showTopFade,
    top_fade_floor:     s.topFadeFloor    ?? 20,
    top_fade_reach:     s.topFadeReach    ?? 40,
    top_fade_intensity: s.topFadeIntensity ?? 85,
    bg_blur_enabled:    s.bgBlurEnabled,
    bg_blur_amount:     s.bgBlurAmount,
    bg_darken_amount:   s.bgDarkenAmount,
    canvas_color:       s.canvasColor,
    text_boxes:         s.textBoxes,
    image_boxes:        s.imageBoxes,
    chart_boxes:        s.chartBoxes ?? null,
    layer_order_ids:    s.layerOrderIds,
    locked_settings:    s.lockedSettings ?? null,
    fade_floor_anchor:  s.fadeFloorAnchor || null,
    // `?? null` is load-bearing: the autosave PATCHes the full row, and
    // JSON.stringify DROPS undefined keys — without this, clearing a flag in the
    // editor leaves the old value in the column and it returns on reload.
    fade_hidden:        s.fadeHidden ?? null,
    fade_locked:        s.fadeLocked ?? null,
    fade_removed:       s.fadeRemoved ?? null,
    headline_color:     s.headlineColor,
    font_size:          s.fontSize,
    l_spacing:          s.lSpacing,
    l_height:           s.lHeight,
    font_label:         s.fontLabel,
    font_weight:        s.fontWeight,
    italic:             s.italic,
    text_align:         s.textAlign,
    all_caps:           s.allCaps,
    headline_shadow:    s.headlineShadow ?? null,
    headline_spans:     s.headlineSpans  ?? null,
    subheadline_color:  s.subheadlineColor,
    sub_font_size:      s.subFontSize,
    sub_l_spacing:      s.subLSpacing,
    sub_l_height:       s.subLHeight,
    sub_font_label:     s.subFontLabel,
    sub_font_weight:    s.subFontWeight,
    sub_italic:         s.subItalic,
    sub_text_align:     s.subTextAlign,
    sub_all_caps:       s.subAllCaps,
    sub_shadow:         s.subShadow ?? null,
    sub_spans:          s.subSpans  ?? null,
    circle_border_color:    s.circleBorderColor,
    circle_border_width:    s.circleBorderWidth,
    circle_border_opacity:  s.circleBorderOpacity,
    circle_shadow_enabled:  s.circleShadowEnabled,
    circle_shadow_blur:     s.circleShadowBlur,
    circle_shadow_offset_x: s.circleShadowOffsetX,
    circle_shadow_offset_y: s.circleShadowOffsetY,
    circle_shadow_color:    s.circleShadowColor,
    circle_shadow_opacity:  s.circleShadowOpacity,
    circle_lift:            s.circleLift,
    circle2_border_color:    s.circle2BorderColor,
    circle2_border_width:    s.circle2BorderWidth,
    circle2_border_opacity:  s.circle2BorderOpacity,
    circle2_shadow_enabled:  s.circle2ShadowEnabled,
    circle2_shadow_blur:     s.circle2ShadowBlur,
    circle2_shadow_offset_x: s.circle2ShadowOffsetX,
    circle2_shadow_offset_y: s.circle2ShadowOffsetY,
    circle2_shadow_color:    s.circle2ShadowColor,
    circle2_shadow_opacity:  s.circle2ShadowOpacity,
    circle2_lift:            s.circle2Lift,
    layer_order:        s.layerOrder,
    quote_color:        s.quoteColor,
    quote_size:         s.quoteSize,
    quote_opacity:      s.quoteOpacity,
    quote_gap:          s.quoteGap,
    quote_shadow:       s.quoteShadow ?? null,
    default_tag_style:  s.tagStyle,
    tag_slots:          s.tagSlots,
    tag_slot_aligns:    s.tagSlotAligns ?? ['center', 'center', 'center'],
    tag_zone_slots:     s.tagZoneSlots  ?? Array(9).fill(null),
    quote_slots:        s.quoteSlots,
    quote_zone_slots:   s.quoteZoneSlots ?? Array(9).fill(null),
    zone_logo_slots:    s.zoneLogoSlots  ?? Array(9).fill(false),
    logo_row_slots:     s.logoRowSlots   ?? Array(3).fill(false),
    swipe_zone_slots:   s.swipeZoneSlots ?? Array(9).fill(null),
    divider_slots:      s.dividerSlots   ?? Array(3).fill(null),
    divider_sub_slots:  (s.dividerSubSlots ?? Array(3).fill(null)).map(
      (sub: DividerSubSlotContent | null) => sub?.type === 'image' ? null : sub
    ),
    divider_settings:   s.dividerSettings ?? Array(3).fill(null),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function rowToSlide(row: Record<string, any>): SlideRow {
  return {
    id:          row.id,
    templateId:  row.template_id ?? row.post_id,   // FK column differs by table (template_id | post_id)
    name:        row.name,
    position:    row.position,
    headline:    row.headline    ?? '',
    subheadline: row.subheadline ?? '',
    caption:     row.caption     ?? '',
    settings:    rowToSettings(row),
  };
}
