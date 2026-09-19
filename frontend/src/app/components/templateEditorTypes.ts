// ── Shared types, interfaces and constants for the Carousel feature ──────────

export const MAX_FONT = 88;
export const SUB_MAX  = 52;

// A selected free element on the canvas — text, image, or chart box, by array index.
export interface SelectedElement { kind: 'text' | 'image' | 'chart'; index: number }

export interface TemplateEditorCanvasRef {
  // Select a free element (or clear selection with null) from outside the canvas (e.g. the inspector).
  selectElement: (sel: SelectedElement | null) => void;
  // Place an already-uploaded image on the canvas (fill an empty placeholder at centre, else add a
  // new image box). Lets clipboard paste upload work in the template editor, which has no image tray.
  pasteImageUrl: (url: string) => void;
  startDownload: () => Promise<void>;
  downloadVideo: () => Promise<void>;   // export the slide as an .mp4 (when it has video boxes)
  cancelExport: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetTransform: () => void;
  setZoom: (s: number) => void;
  enterCropMode: () => void;
  toggleSplit: () => void;
  toggleBlur: () => void;
  // Video control (for VideoControlsBar in video sub-mode)
  play: () => void;
  pause: () => void;
  seekTo: (t: number) => void;
  setTrimRange: (start: number, end: number) => void;
  resetTrim: () => void;
  resetBox: () => void;
  centerBox: () => void;
  addOverlay: (url: string) => void;
  addLightLeak: (color: string) => void;
  // Rich-text run styling — applied to the current selection inside the inline text-box editor
  setSelectionWeight: (weight: number) => void;
  toggleSelectionItalic: () => void;
  setSelectionColor: (color: string) => void;
  toggleSelectionSecondary: () => void;   // mark/unmark the selection as the secondary style (secondaryWeight)
  getVideoElement: () => HTMLVideoElement | null;
  getTrimState: () => { trimStart: number; trimEnd: number; duration: number };
  // ── Posts → Instagram publish ──────────────────────────────────────────────
  // Render the currently-mounted slide off-screen and RETURN the blob (no browser
  // download): a JPEG for image slides, an .mp4 for slides with video boxes.
  // isReadyForPublish() reports whether this slide's assets (base image, image-box
  // images, video-box elements, in-flight cut-outs) have finished loading, so the
  // batch publisher can wait before capturing each slide.
  renderImageBlob: () => Promise<Blob>;
  renderVideoBlob: () => Promise<Blob>;
  // Render the slide at the Download-PNG quality (4× hi-res PNG) and RETURN the blob —
  // the batch "Export all" flow names + downloads it itself.
  renderPngBlob: () => Promise<Blob>;
  isReadyForPublish: () => boolean;
}

export type CarouselTextAlign  = 'left' | 'center' | 'right' | 'justify';
export type CarouselFontWeight = 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;

export const CAROUSEL_FONTS = [
  // Geometric / Modern Sans
  { label: 'Inter',                css: 'Inter, sans-serif',                          google: 'Inter:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,300;1,400;1,500;1,600;1,700;1,800;1,900' },
  { label: 'Outfit',               css: '"Outfit", sans-serif',                       google: 'Outfit:wght@300;400;500;600;700;800;900' },
  { label: 'Poppins',              css: '"Poppins", sans-serif',                      google: 'Poppins:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,300;1,400;1,500;1,600;1,700;1,800;1,900' },
  { label: 'Montserrat',           css: '"Montserrat", sans-serif',                   google: 'Montserrat:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,300;1,400;1,500;1,600;1,700;1,800;1,900' },
  { label: 'Raleway',              css: '"Raleway", sans-serif',                      google: 'Raleway:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,300;1,400;1,500;1,600;1,700;1,800;1,900' },
  { label: 'Plus Jakarta Sans',    css: '"Plus Jakarta Sans", sans-serif',            google: 'Plus+Jakarta+Sans:ital,wght@0,200;0,300;0,400;0,500;0,600;0,700;0,800;1,200;1,300;1,400;1,500;1,600;1,700;1,800' },
  { label: 'Figtree',              css: '"Figtree", sans-serif',                      google: 'Figtree:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,300;1,400;1,500;1,600;1,700;1,800;1,900' },
  { label: 'Space Grotesk',        css: '"Space Grotesk", sans-serif',                google: 'Space+Grotesk:wght@300;400;500;600;700' },
  { label: 'Urbanist',             css: '"Urbanist", sans-serif',                     google: 'Urbanist:ital,wght@0,100;0,200;0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,100;1,200;1,300;1,400;1,500;1,600;1,700;1,800;1,900' },
  { label: 'Syne',                 css: '"Syne", sans-serif',                         google: 'Syne:wght@400;500;600;700;800' },
  { label: 'Unbounded',            css: '"Unbounded", sans-serif',                    google: 'Unbounded:wght@200;300;400;500;600;700;800;900' },
  // Humanist Sans
  { label: 'Open Sans',            css: '"Open Sans", sans-serif',                    google: 'Open+Sans:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;1,300;1,400;1,500;1,600;1,700;1,800' },
  { label: 'Lato',                 css: '"Lato", sans-serif',                         google: 'Lato:ital,wght@0,300;0,400;0,700;0,900;1,300;1,400;1,700;1,900' },
  { label: 'Nunito',               css: '"Nunito", sans-serif',                       google: 'Nunito:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,300;1,400;1,500;1,600;1,700;1,800;1,900' },
  { label: 'Work Sans',            css: '"Work Sans", sans-serif',                    google: 'Work+Sans:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,300;1,400;1,500;1,600;1,700;1,800;1,900' },
  { label: 'Roboto',               css: '"Roboto", sans-serif',                       google: 'Roboto:ital,wght@0,300;0,400;0,500;0,700;0,900;1,300;1,400;1,500;1,700;1,900' },
  { label: 'DM Sans',              css: '"DM Sans", sans-serif',                      google: 'DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;0,9..40,800;0,9..40,900;1,9..40,300;1,9..40,400;1,9..40,500;1,9..40,600;1,9..40,700;1,9..40,800;1,9..40,900' },
  { label: 'Manrope',              css: '"Manrope", sans-serif',                      google: 'Manrope:wght@200;300;400;500;600;700;800' },
  { label: 'Karla',                css: '"Karla", sans-serif',                        google: 'Karla:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;1,300;1,400;1,500;1,600;1,700;1,800' },
  { label: 'Mulish',               css: '"Mulish", sans-serif',                       google: 'Mulish:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,300;1,400;1,500;1,600;1,700;1,800;1,900' },
  { label: 'Jost',                 css: '"Jost", sans-serif',                         google: 'Jost:ital,wght@0,100;0,200;0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,100;1,200;1,300;1,400;1,500;1,600;1,700;1,800;1,900' },
  // Grotesque / Neutral
  { label: 'Barlow',               css: '"Barlow", sans-serif',                       google: 'Barlow:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,300;1,400;1,500;1,600;1,700;1,800;1,900' },
  { label: 'Archivo',              css: '"Archivo", sans-serif',                      google: 'Archivo:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,300;1,400;1,500;1,600;1,700;1,800;1,900' },
  { label: 'Source Sans 3',        css: '"Source Sans 3", sans-serif',                google: 'Source+Sans+3:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,300;1,400;1,500;1,600;1,700;1,800;1,900' },
  { label: 'PT Sans',              css: '"PT Sans", sans-serif',                      google: 'PT+Sans:ital,wght@0,400;0,700;1,400;1,700' },
  { label: 'Overpass',             css: '"Overpass", sans-serif',                     google: 'Overpass:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,300;1,400;1,500;1,600;1,700;1,800;1,900' },
  // Display / Condensed
  { label: 'Oswald',               css: '"Oswald", sans-serif',                       google: 'Oswald:wght@200;300;400;500;600;700' },
  { label: 'Bebas Neue',           css: '"Bebas Neue", sans-serif',                   google: 'Bebas+Neue' },
  { label: 'Anton',                css: '"Anton", sans-serif',                        google: 'Anton' },
  { label: 'Barlow Condensed',     css: '"Barlow Condensed", sans-serif',             google: 'Barlow+Condensed:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,300;1,400;1,500;1,600;1,700;1,800;1,900' },
  { label: 'Fjalla One',           css: '"Fjalla One", sans-serif',                   google: 'Fjalla+One' },
  { label: 'Russo One',            css: '"Russo One", sans-serif',                    google: 'Russo+One' },
  { label: 'Black Han Sans',       css: '"Black Han Sans", sans-serif',               google: 'Black+Han+Sans' },
  { label: 'Exo 2',                css: '"Exo 2", sans-serif',                        google: 'Exo+2:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,300;1,400;1,500;1,600;1,700;1,800;1,900' },
  { label: 'Teko',                 css: '"Teko", sans-serif',                         google: 'Teko:wght@300;400;500;600;700' },
  { label: 'Big Shoulders Display',css: '"Big Shoulders Display", sans-serif',        google: 'Big+Shoulders+Display:wght@100;200;300;400;500;600;700;800;900' },
  { label: 'Orbitron',             css: '"Orbitron", sans-serif',                     google: 'Orbitron:wght@400;500;600;700;800;900' },
  { label: 'Chakra Petch',         css: '"Chakra Petch", sans-serif',                 google: 'Chakra+Petch:ital,wght@0,300;0,400;0,500;0,600;0,700;1,300;1,400;1,500;1,600;1,700' },
  // Display — Bold / Expressive
  { label: 'Abril Fatface',        css: '"Abril Fatface", cursive',                   google: 'Abril+Fatface' },
  { label: 'Righteous',            css: '"Righteous", sans-serif',                    google: 'Righteous' },
  { label: 'Paytone One',          css: '"Paytone One", sans-serif',                  google: 'Paytone+One' },
  { label: 'Passion One',          css: '"Passion One", sans-serif',                  google: 'Passion+One:wght@400;700;900' },
  { label: 'Boogaloo',             css: '"Boogaloo", sans-serif',                     google: 'Boogaloo' },
  { label: 'Lilita One',           css: '"Lilita One", sans-serif',                   google: 'Lilita+One' },
  // Serif — Elegant
  { label: 'Playfair Display',     css: '"Playfair Display", serif',                  google: 'Playfair+Display:ital,wght@0,400;0,500;0,600;0,700;0,800;0,900;1,400;1,500;1,600;1,700;1,800;1,900' },
  { label: 'Merriweather',         css: '"Merriweather", serif',                      google: 'Merriweather:ital,wght@0,300;0,400;0,700;0,900;1,300;1,400;1,700;1,900' },
  { label: 'Lora',                 css: '"Lora", serif',                              google: 'Lora:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500;1,600;1,700' },
  { label: 'EB Garamond',          css: '"EB Garamond", serif',                       google: 'EB+Garamond:ital,wght@0,400;0,500;0,600;0,700;0,800;1,400;1,500;1,600;1,700;1,800' },
  { label: 'Cormorant',            css: '"Cormorant Garamond", serif',                google: 'Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;0,700;1,300;1,400;1,500;1,600;1,700' },
  { label: 'Libre Baskerville',    css: '"Libre Baskerville", serif',                 google: 'Libre+Baskerville:ital,wght@0,400;0,700;1,400' },
  { label: 'Crimson Pro',          css: '"Crimson Pro", serif',                       google: 'Crimson+Pro:ital,wght@0,200;0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,200;1,300;1,400;1,500;1,600;1,700;1,800;1,900' },
  { label: 'Spectral',             css: '"Spectral", serif',                          google: 'Spectral:ital,wght@0,200;0,300;0,400;0,500;0,600;0,700;0,800;1,200;1,300;1,400;1,500;1,600;1,700;1,800' },
  { label: 'Domine',               css: '"Domine", serif',                            google: 'Domine:wght@400;500;600;700' },
  // Serif — Display
  { label: 'Bodoni Moda',          css: '"Bodoni Moda", serif',                       google: 'Bodoni+Moda:ital,opsz,wght@0,6..96,400;0,6..96,500;0,6..96,600;0,6..96,700;0,6..96,800;0,6..96,900;1,6..96,400;1,6..96,500;1,6..96,600;1,6..96,700;1,6..96,800;1,6..96,900' },
  { label: 'Cinzel',               css: '"Cinzel", serif',                            google: 'Cinzel:wght@400;500;600;700;800;900' },
  { label: 'DM Serif Display',     css: '"DM Serif Display", serif',                  google: 'DM+Serif+Display:ital,wght@0,400;1,400' },
  // Script / Decorative
  { label: 'Dancing Script',       css: '"Dancing Script", cursive',                  google: 'Dancing+Script:wght@400;500;600;700' },
  { label: 'Pacifico',             css: '"Pacifico", cursive',                        google: 'Pacifico' },
  { label: 'Lobster',              css: '"Lobster", cursive',                         google: 'Lobster' },
  // System
  { label: 'Georgia',              css: 'Georgia, serif',                             google: null },
  { label: 'Impact',               css: 'Impact, sans-serif',                         google: null },
] as const;

// Built-in labels (autocomplete) plus any string, so user-uploaded font labels are valid too.
export type CarouselFontLabel = typeof CAROUSEL_FONTS[number]['label'] | (string & {});

export const CAROUSEL_WEIGHTS = [
  { label: 'Light',   value: 300 as CarouselFontWeight },
  { label: 'Regular', value: 400 as CarouselFontWeight },
  { label: 'Medium',  value: 500 as CarouselFontWeight },
  { label: 'Semi',    value: 600 as CarouselFontWeight },
  { label: 'Bold',    value: 700 as CarouselFontWeight },
  { label: 'XBold',   value: 900 as CarouselFontWeight },
];

// ── Tag system ────────────────────────────────────────────────────────────────

export interface ShadowStyle {
  enabled:  boolean;
  color:    string;
  blur:     number;
  offsetX:  number;
  offsetY:  number;
  opacity:  number;
  lift:     number;
}
export function defaultShadowStyle(): ShadowStyle {
  return { enabled: false, color: '#000000', blur: 16, offsetX: 0, offsetY: 6, opacity: 60, lift: 0 };
}

export interface TagStyle {
  bgColor:       string;
  bgOpacity:     number;   // 0-100
  borderColor:   string;
  borderWidth:   number;   // 0-8
  borderOpacity: number;   // 0-100
  cornerRadius:  number;   // 0-40
  textColor:     string;
  fontSize:      number;   // 8-36
  fontWeight:    CarouselFontWeight;
  italic:        boolean;
  fontLabel:     CarouselFontLabel;
  paddingX:      number;   // 0-32
  paddingY:      number;   // 0-20
  letterSpacing: number;   // 0-20 px
  textCase:      'none' | 'upper' | 'smallcaps';
  shadow?:       ShadowStyle;
}

export function defaultTagStyle(): TagStyle {
  return {
    bgColor: '#dc2626', bgOpacity: 100,
    borderColor: '#ffffff', borderWidth: 0, borderOpacity: 100,
    cornerRadius: 4,
    textColor: '#ffffff',
    fontSize: 13, fontWeight: 700, italic: false, fontLabel: 'Inter',
    paddingX: 10, paddingY: 4,
    letterSpacing: 0, textCase: 'none',
  };
}

export interface TagPreset { id: string; label: string; initStyle: Partial<TagStyle> }

export const TAG_PRESETS: TagPreset[] = [
  { id: 'breaking',   label: 'BREAKING',   initStyle: { bgColor: '#dc2626', bgOpacity: 100, textColor: '#ffffff', fontWeight: 700, cornerRadius: 3 } },
  { id: 'trending',   label: 'TRENDING',   initStyle: { bgColor: '#ea580c', bgOpacity: 100, textColor: '#ffffff', fontWeight: 700, cornerRadius: 3 } },
  { id: 'live',       label: '● LIVE',     initStyle: { bgColor: '#dc2626', bgOpacity: 100, textColor: '#ffffff', fontWeight: 700, cornerRadius: 20 } },
  { id: 'exclusive',  label: 'EXCLUSIVE',  initStyle: { bgColor: '#000000', bgOpacity: 90,  textColor: '#ffffff', fontWeight: 700, cornerRadius: 3, borderColor: '#ffffff', borderWidth: 1, borderOpacity: 60 } },
  { id: 'developing', label: 'DEVELOPING', initStyle: { bgColor: '#fbbf24', bgOpacity: 100, textColor: '#000000', fontWeight: 700, cornerRadius: 3 } },
  { id: 'new',        label: 'NEWS',       initStyle: { bgColor: '#16a34a', bgOpacity: 100, textColor: '#ffffff', fontWeight: 700, cornerRadius: 3 } },
  { id: 'alert',      label: 'ALERT',      initStyle: { bgColor: '#7c3aed', bgOpacity: 100, textColor: '#ffffff', fontWeight: 700, cornerRadius: 3 } },
  { id: 'update',     label: 'UPDATE',     initStyle: { bgColor: '#0284c7', bgOpacity: 100, textColor: '#ffffff', fontWeight: 700, cornerRadius: 3 } },
  { id: 'opinion',    label: 'OPINION',    initStyle: { bgColor: '#00000000', bgOpacity: 0,  textColor: '#ffffff', fontWeight: 700, cornerRadius: 3, borderColor: '#ffffff', borderWidth: 1, borderOpacity: 100 } },
];

export type SwipeArrowType = 'line' | 'triangle' | 'chevron' | 'double-chevron' | 'curved';
export type SwipeLayout = 'text-arrow' | 'arrow-text' | 'stacked' | 'arrow-only' | 'text-only';
export type SwipeDirection = 'left' | 'right';

export interface SwipeStyle {
  text: string;
  allCaps: boolean;
  fontLabel: CarouselFontLabel;
  fontWeight: CarouselFontWeight;
  fontSize: number;        // canvas px
  textColor: string;
  letterSpacing: number;   // canvas px
  arrowType: SwipeArrowType;
  arrowLength: number;     // canvas px (line length, 0 = head only)
  arrowColor: string;
  arrowWeight: number;     // stroke width canvas px
  arrowHeadSize: number;   // half-height of arrowhead canvas px
  direction: SwipeDirection;
  layout: SwipeLayout;
  gap: number;             // canvas px between text and arrow
  opacity: number;         // 0-100
  shadow?: ShadowStyle;
}

export function defaultSwipeStyle(): SwipeStyle {
  return {
    text: 'SWIPE', allCaps: true,
    fontLabel: 'Inter', fontWeight: 700,
    fontSize: 22, textColor: '#ffffff', letterSpacing: 3,
    arrowType: 'line', arrowLength: 60, arrowColor: '#ffffff',
    arrowWeight: 2, arrowHeadSize: 10,
    direction: 'right', layout: 'text-arrow', gap: 12, opacity: 100,
  };
}

export const SWIPE_PRESETS: { id: string; label: string; style: SwipeStyle }[] = [
  { id: 'swipe-right',      label: 'Swipe →',         style: { text: 'SWIPE', allCaps: true, fontLabel: 'Inter', fontWeight: 700, fontSize: 22, textColor: '#ffffff', letterSpacing: 3, arrowType: 'line', arrowLength: 55, arrowColor: '#ffffff', arrowWeight: 2, arrowHeadSize: 10, direction: 'right', layout: 'text-arrow', gap: 12, opacity: 100 } },
  { id: 'swipe-left',       label: '← Swipe',         style: { text: 'SWIPE', allCaps: true, fontLabel: 'Inter', fontWeight: 700, fontSize: 22, textColor: '#ffffff', letterSpacing: 3, arrowType: 'line', arrowLength: 55, arrowColor: '#ffffff', arrowWeight: 2, arrowHeadSize: 10, direction: 'left', layout: 'arrow-text', gap: 12, opacity: 100 } },
  { id: 'swipe-for-more',   label: 'Swipe for more',  style: { text: 'Swipe for more', allCaps: false, fontLabel: 'Inter', fontWeight: 400, fontSize: 17, textColor: '#a1a1aa', letterSpacing: 0, arrowType: 'chevron', arrowLength: 0, arrowColor: '#a1a1aa', arrowWeight: 1.5, arrowHeadSize: 8, direction: 'right', layout: 'text-arrow', gap: 8, opacity: 100 } },
  { id: 'swipe-to-end',     label: 'Swipe to the end', style: { text: 'Swipe to the end', allCaps: false, fontLabel: 'Inter', fontWeight: 300, fontSize: 16, textColor: '#ffffff', letterSpacing: 0, arrowType: 'chevron', arrowLength: 0, arrowColor: '#ffffff', arrowWeight: 1.5, arrowHeadSize: 8, direction: 'right', layout: 'text-arrow', gap: 6, opacity: 80 } },
  { id: 'explore-more',     label: 'Explore more',    style: { text: 'EXPLORE MORE', allCaps: true, fontLabel: 'Outfit', fontWeight: 500, fontSize: 16, textColor: '#ffffff', letterSpacing: 3, arrowType: 'line', arrowLength: 40, arrowColor: '#ffffff', arrowWeight: 1.5, arrowHeadSize: 8, direction: 'right', layout: 'text-arrow', gap: 10, opacity: 100 } },
  { id: 'double-chevron-r', label: '>>',              style: { text: '', allCaps: false, fontLabel: 'Inter', fontWeight: 400, fontSize: 18, textColor: '#ffffff', letterSpacing: 0, arrowType: 'double-chevron', arrowLength: 0, arrowColor: '#ffffff', arrowWeight: 2.5, arrowHeadSize: 18, direction: 'right', layout: 'arrow-only', gap: 0, opacity: 100 } },
  { id: 'double-chevron-l', label: '<<',              style: { text: '', allCaps: false, fontLabel: 'Inter', fontWeight: 400, fontSize: 18, textColor: '#ffffff', letterSpacing: 0, arrowType: 'double-chevron', arrowLength: 0, arrowColor: '#ffffff', arrowWeight: 2.5, arrowHeadSize: 18, direction: 'left', layout: 'arrow-only', gap: 0, opacity: 100 } },
  { id: 'long-arrow',       label: 'Long arrow',      style: { text: '', allCaps: false, fontLabel: 'Inter', fontWeight: 400, fontSize: 18, textColor: '#ffffff', letterSpacing: 0, arrowType: 'line', arrowLength: 120, arrowColor: '#ffffff', arrowWeight: 1.5, arrowHeadSize: 10, direction: 'right', layout: 'arrow-only', gap: 0, opacity: 100 } },
  { id: 'bold-swipe-left',  label: 'Bold ←',          style: { text: 'SWIPE LEFT', allCaps: true, fontLabel: 'Bebas Neue', fontWeight: 400, fontSize: 26, textColor: '#ffffff', letterSpacing: 4, arrowType: 'triangle', arrowLength: 0, arrowColor: '#ffffff', arrowWeight: 3, arrowHeadSize: 14, direction: 'left', layout: 'arrow-text', gap: 12, opacity: 100 } },
  { id: 'stacked-swipe',    label: 'Stacked',         style: { text: 'SWIPE', allCaps: true, fontLabel: 'Inter', fontWeight: 600, fontSize: 18, textColor: '#ffffff', letterSpacing: 5, arrowType: 'line', arrowLength: 60, arrowColor: '#ffffff', arrowWeight: 1.5, arrowHeadSize: 8, direction: 'right', layout: 'stacked', gap: 8, opacity: 100 } },
];

export interface TextSpan {
  text:    string;
  color?:  string;
  bold?:   boolean;
  italic?: boolean;
  weight?: number;   // explicit per-run font weight (100-900); overrides `bold` when set
  secondary?: boolean; // role: this run uses the box's secondaryWeight (resolved at render, tracks the setting)
}

export type SlotContent = { type: 'image'; url: string };
export interface QuoteSlotContent { styleId: string }
export type LayerId = 'background' | 'circle' | 'circle2' | 'subject';

export interface SidebarElementData {
  type: 'divider' | 'tag' | 'logo' | 'quote' | 'swipe' | 'image' | 'video';
  id?: string;
  text?: string;
  url?: string;
  style?: TagStyle;
  swipeStyle?: SwipeStyle;
}

export type DividerSubSlotContent =
  | { type: 'image'; url: string }
  | { type: 'tag'; text: string; style: TagStyle }
  | { type: 'swipe'; style: SwipeStyle };

export interface DividerStyleSettings {
  lineColor:      string;   // hex color
  lineOpacity:    number;   // 0-100 (primary line opacity; secondary ~64% of this)
  lineWeight:     number;   // 1-20 canvas px
  dashLen:        number;   // dashed: dash length (canvas px)
  dashGap:        number;   // dashed: gap between dashes (canvas px)
  dotSize:        number;   // dotted: dot diameter (canvas px)
  dotSpacing:     number;   // dotted: gap between dots (canvas px)
  doubleSpacing:  number;   // double / double-fade / tag-double: half-offset from center (canvas px)
  tripleSpacing:  number;   // triple: offset of outer lines from center (canvas px)
  centerWeight:   number;   // triple: center line weight (canvas px)
  dotRadius:      number;   // dot-center: dot radius (canvas px)
  dotGap:         number;   // dot-center: gap from dot edge to line start (canvas px)
  taperHeight:    number;   // taper / thick-taper: height as % of slot height (5-60)
  shortLength:    number;   // short-center: total length as % of slot width (10-90)
  waveAmplitude:  number;   // wave: amplitude as % of slot height (2-50)
  bracketWidth:   number;   // brackets: bracket arm width (canvas px)
  bracketMargin:  number;   // brackets: margin from slot edge (canvas px)
  contentGap:     number;   // tag-* / logo-*: gap between content and line ends (canvas px)
  fadeSpread:     number;   // fade dividers: 0-50 for symmetric (% each side), 0-100 for directional (% of width that fades)
  shadow?:        ShadowStyle;
}

export function defaultDividerSettings(divId?: string): DividerStyleSettings {
  return {
    lineColor:     '#ffffff',
    lineOpacity:   55,
    lineWeight:    divId === 'thick' ? 6 : 2,
    dashLen:       28,
    dashGap:       20,
    dotSize:       3,
    dotSpacing:    18,
    doubleSpacing: divId === 'tag-double' ? 10 : divId === 'double-fade' ? 7 : 8,
    tripleSpacing: 10,
    centerWeight:  5,
    dotRadius:     8,
    dotGap:        20,
    taperHeight:   divId === 'thick-taper' ? 35 : 25,
    shortLength:   33,
    waveAmplitude: 18,
    bracketWidth:  24,
    bracketMargin: 30,
    contentGap:    20,
    fadeSpread:
      divId === 'double-fade' ? 25 :
      divId === 'dashed-fade' || divId === 'taper-dashed' ? 20 :
      divId === 'logo-center-fade' || divId === 'tag-center-fade' ? 40 :
      divId === 'fade-left' || divId === 'logo-left-fade' || divId === 'tag-left-fade' ? 100 :
      30,
  };
}

export interface TextBoxStyle {
  id:            string;
  name?:         string;   // custom layer name shown in the inspector's layer list (falls back to a text preview)
  text:          string;
  x:             number;   // anchor X in canvas px (0-1080)
  y:             number;   // top   Y in canvas px (0-1350)
  fontLabel:     CarouselFontLabel;
  fontSize:      number;   // canvas (design) px
  fontWeight:    CarouselFontWeight;
  secondaryWeight?: CarouselFontWeight;  // optional 2nd weight (same family) for highlighting; placeholder filler alternates primary/secondary per word
  italic:        boolean;
  allCaps?:      boolean;  // render the text uppercase (non-destructive — the typed text is unchanged)
  spans?:        TextSpan[];  // rich per-run styling (weight/italic/colour); when set, overrides `text` for rendering
  singleLine?:   boolean;     // hard one-line constraint: never wraps, Enter is ignored, and edits that would
                              // overflow the box width at the box's font size are REFUSED (font never shrinks).
                              // The headless renderer fails loudly if persisted text violates it.
  fillPlaceholder?: boolean;  // fill `text` with `placeholderWords` lorem words; off the moment the user types
  placeholderWords?: number;  // how many lorem words to insert when fillPlaceholder is on (default 8)
  color:         string;
  align:         CarouselTextAlign;   // left | center | right | justify
  fitToWidth?:   boolean;             // poster mode: auto-break + scale each line's font size to fill the box (overrides align)
  vAlign:        'top' | 'middle' | 'bottom';
  width:         number;   // box width  in canvas px (text wraps to this)
  height:        number;   // box height in canvas px (vertical-align region)
  letterSpacing: number;   // px
  lineHeight:    number;   // 0-100 (multiplier = 1 + v/100 * 1.2)
  opacity:       number;   // 0-100
  shadow?:       ShadowStyle;
  hidden?:       boolean;  // layers panel: skip rendering + canvas interaction
  locked?:       boolean;  // layers panel: render but block selection/move/resize on the canvas
  // ── Template-defined style locks ──────────────────────────────────────────
  // Property names a POST may not change on this box (enforced in posts mode only —
  // the template editor can always edit). Unlike `locked`, the box stays selectable
  // and its TEXT stays editable; only the listed styling/geometry is frozen. Geometry
  // locks ('x','y','width','height') block canvas drag/resize; style locks disable
  // their inspector controls. Set by the template author (editor or CLI `lock`).
  lockedProps?: (keyof TextBoxStyle)[];
}

// Reserved z-order sentinel left behind where a template's image-layer marker sat:
// "images added to this post insert HERE in the stack". Never a real element —
// orderedLayerIds skips unknown ids, so it is invisible to rendering and the panel.
export const IMAGES_LAYER_ID = '__images__';

// Image-layer markers are TEMPLATE-ONLY design visuals: a grey box that shows where
// images will sit in the z-stack. Posts never contain one — when cloning template
// slides into a post the marker box is stripped and its z-position is recorded as
// the IMAGES_LAYER_ID sentinel, which the image-insertion paths target.
export function stripUnfilledPlaceholders(s: CarouselSettings): CarouselSettings {
  const dropped = (s.imageBoxes ?? []).filter(b => b.placeholder && !b.url).map(b => b.id);
  if (dropped.length === 0) return s;
  let order = s.layerOrderIds;
  if (order) {
    const firstAt = order.findIndex(id => dropped.includes(id));
    order = order.filter(id => !dropped.includes(id) && id !== IMAGES_LAYER_ID);
    if (firstAt >= 0) order = [...order.slice(0, firstAt), IMAGES_LAYER_ID, ...order.slice(firstAt)];
  }
  return {
    ...s,
    imageBoxes: (s.imageBoxes ?? []).filter(b => !dropped.includes(b.id)),
    layerOrderIds: order,
  };
}

// Full lock presets — what the layer-card padlock applies, and what "fully locked"
// means for island-hiding / canvas inertness in posts. Shared by panel + canvas.
export const TEXT_LOCK_PRESET: (keyof TextBoxStyle)[] = ['x', 'y', 'width', 'height', 'vAlign', 'align', 'fontLabel', 'fontSize', 'fontWeight', 'secondaryWeight', 'fitToWidth', 'allCaps', 'singleLine', 'lineHeight', 'letterSpacing', 'color', 'opacity', 'italic', 'shadow'];
export const IMAGE_LOCK_PRESET: (keyof ImageBox)[] = ['x', 'y', 'width', 'height', 'opacity', 'cornerRadius', 'blend', 'crop', 'perspective', 'fade', 'shadow', 'fgStroke'];

// Every preset prop locked → the image has no editable surface left in posts.
export function hasFullImageLock(b: Pick<ImageBox, 'lockedProps'>): boolean {
  return IMAGE_LOCK_PRESET.every(p => !!b.lockedProps?.includes(p));
}

// True when a post-mode edit to `prop` on this element is forbidden by its template locks.
// Works for any lockable element (text boxes, image boxes).
export function isPropLocked(el: { lockedProps?: readonly string[] }, prop: string): boolean {
  return !!el.lockedProps?.includes(prop);
}

// Geometry lock = any of x/y/width/height locked → the element can't be dragged, resized,
// or (for images) cropped in posts.
export function hasGeometryLock(el: { lockedProps?: readonly string[] }): boolean {
  return !!el.lockedProps?.some(p => p === 'x' || p === 'y' || p === 'width' || p === 'height');
}

export function defaultTextBox(): TextBoxStyle {
  const id = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
    ? crypto.randomUUID()
    : `tb-${Math.floor(Math.random() * 1e9).toString(36)}`;
  return {
    id,
    text: 'Lorem ipsum',   // replaced by fitted filler once the canvas measures the box (fillPlaceholder)
    x: 270, y: 575, width: 540, height: 200,   // canvas px (1080×1350 space)
    fontLabel: 'Inter', fontSize: 40, fontWeight: 700, italic: false,
    fillPlaceholder: true, placeholderWords: 8,
    color: '#ffffff', align: 'center', vAlign: 'middle',
    letterSpacing: 0, lineHeight: 15, opacity: 100,
  };
}

// A free, positioned image dropped onto the canvas (from Uploads)
// Per-edge fade for an image box. Each value is 0-100 (% of that dimension that
// fades). color omitted/empty → fade to transparent; otherwise fade into the colour.
export type FadeEdge = 'top' | 'bottom' | 'left' | 'right';

// One stop in an edge's fade curve. loc runs 0 (at the edge) → 100 (at the reach distance);
// opacity is the image's visibility there (0 = fully faded, 100 = solid). mid is the
// Photoshop-style blend midpoint toward the next stop (0-100, default 50).
export interface FadeStop {
  loc:     number;
  opacity: number;
  mid?:    number;
}

export interface ImageBoxFade {
  enabled?: boolean;  // false collapses the controls and skips rendering; undefined = derive from edge values (legacy)
  top:    number;
  bottom: number;
  left:   number;
  right:  number;
  color?: string;
  // Per-edge opacity curve. Absent edge → default linear ramp (faded at the edge → solid at reach).
  stops?: Partial<Record<FadeEdge, FadeStop[]>>;
}

// Default fade curve = the original linear ramp: fully faded at the edge → solid at the reach distance.
export function defaultFadeStops(): FadeStop[] {
  return [{ loc: 0, opacity: 0, mid: 50 }, { loc: 100, opacity: 100 }];
}

// Sample a fade curve (honouring per-stop midpoints) into gradient stops.
// Returns [{ pos: 0-1 along the fade, vis: 0-1 image visibility }]; end stops are extended to 0/1.
export function sampleFadeStops(stops: FadeStop[]): { pos: number; vis: number }[] {
  const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
  const sorted = [...stops].sort((a, b) => a.loc - b.loc);
  if (sorted.length === 0) return [{ pos: 0, vis: 1 }, { pos: 1, vis: 1 }];
  if (sorted.length === 1) { const v = clamp01(sorted[0].opacity / 100); return [{ pos: 0, vis: v }, { pos: 1, vis: v }]; }
  const out: { pos: number; vis: number }[] = [];
  if (sorted[0].loc > 0) out.push({ pos: 0, vis: clamp01(sorted[0].opacity / 100) });
  for (let i = 0; i < sorted.length - 1; i++) {
    const A = sorted[i], B = sorted[i + 1];
    const pa = clamp01(A.loc / 100), pb = clamp01(B.loc / 100);
    const midPct = A.mid ?? 50;
    const linear = Math.abs(midPct - 50) < 0.5 || pb <= pa;
    const expo = linear ? 1 : Math.log(0.5) / Math.log(Math.min(0.999, Math.max(0.001, midPct / 100)));
    const steps = linear ? 1 : 12;
    for (let s = 0; s <= steps; s++) {
      const p = s / steps;
      const t = linear ? p : Math.pow(p, expo);
      out.push({ pos: pa + (pb - pa) * p, vis: clamp01((A.opacity + (B.opacity - A.opacity) * t) / 100) });
    }
  }
  const last = sorted[sorted.length - 1];
  if (last.loc < 100) out.push({ pos: 1, vis: clamp01(last.opacity / 100) });
  return out;
}

// Per-edge crop for an image box. Each value is 0-1 (fraction of the source image
// hidden on that edge). Dragging a box's centre-edge handle adjusts these — revealing
// or hiding source pixels at a fixed scale rather than scaling, so it changes the box aspect.
export interface ImageBoxCrop {
  top:    number;
  bottom: number;
  left:   number;
  right:  number;
}

// Per-layer adjustments for an image box's foreground (subject) and background,
// available once subject/background split is enabled. brightness: -100..100 (0 = none);
// blur: 0..40 canvas px (gaussian); noise: 0..100 monochromatic grayscale grain.
export interface ImageEffects {
  brightness?:   number;
  blur?:         number;
  noise?:        number;
  blurEdgeFade?: boolean;   // blur edge style (box-filling layers): false (default) = solid edge-to-edge; true = fade to transparent at the edges
}

// Perspective/distort transform: per-corner offsets (canvas px) added to the box's natural
// rectangle corners, defining the destination quadrilateral the image is warped onto. All-zero
// (or undefined) = no transform. Stored on the box; the warp is applied in drawImageBox so it
// survives reload and exports at any scale. The three edit modes (Distort/Perspective/Skew) only
// constrain how a drag updates these offsets — the stored shape and rendering are identical.
export interface ImageBoxPerspective {
  tl: { x: number; y: number };
  tr: { x: number; y: number };
  br: { x: number; y: number };
  bl: { x: number; y: number };
}

export type PerspectiveMode = 'distort' | 'perspective' | 'skew';

// A pure rotation about the box centre, expressed as corner offsets. Degrees are
// positive = clockwise on screen (canvas y points down). 0 → undefined (no warp).
// Shared by the panel's Rotate slider and the CLI `rotate` so both write the
// identical quad — rotation has no field of its own, it lives in `perspective`.
export function perspectiveForRotation(width: number, height: number, degrees: number): ImageBoxPerspective | undefined {
  if (!degrees) return undefined;
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const hw = width / 2, hh = height / 2;
  const rot = (px: number, py: number) => ({
    x: +(px * cos - py * sin - px).toFixed(2),
    y: +(px * sin + py * cos - py).toFixed(2),
  });
  return { tl: rot(-hw, -hh), tr: rot(hw, -hh), br: rot(hw, hh), bl: rot(-hw, hh) };
}

// Recover the rotation a quad encodes by reading the warped top edge's tilt —
// exact for quads made by perspectiveForRotation; for a hand-dragged warp it
// reports the top edge's angle (which is what the Rotate slider then replaces).
export function rotationFromPerspective(width: number, p?: ImageBoxPerspective): number {
  if (!p) return 0;
  const dx = width + (p.tr.x - p.tl.x), dy = p.tr.y - p.tl.y;
  return Math.round((Math.atan2(dy, dx) * 180) / Math.PI);
}

export interface ImageBox {
  id:           string;
  name?:        string;   // custom layer name shown in the inspector's layer list (falls back to "Image N" / the placeholder label)
  url:          string;
  x:            number;   // top-left, canvas px (0-1080)
  y:            number;   // top-left, canvas px (0-1350)
  width:        number;   // canvas px
  height:       number;   // canvas px
  opacity:      number;   // 0-100
  cornerRadius: number;   // px
  aspect?:      number;   // native width/height (full precision) — preserved for aspect-lock
  shadow?:      ShadowStyle;  // drop shadow
  fade?:        ImageBoxFade; // per-edge fade — foreground (subject when split) / whole image when not split
  bgFade?:      ImageBoxFade; // per-edge fade for the background layer (when "detect background" is on)
  crop?:        ImageBoxCrop; // source-rect crop (fraction off each edge); set by dragging centre-edge handles
  perspective?: ImageBoxPerspective; // per-corner offsets warping the box onto a quad (Distort/Perspective/Skew)
  hidden?:      boolean;      // layers panel: skip rendering + canvas interaction
  locked?:      boolean;      // layers panel: render but block selection/move/resize on the canvas
  blend?:       string;       // canvas globalCompositeOperation (blend mode); default 'source-over'
  isOverlay?:   boolean;      // a developer overlay texture — gets the "Overlay" settings panel (blend + opacity)
  // ── Subject split: per-box background removal + independent fg/bg effects ──
  splitEnabled?: boolean;       // split active — gates the (async) removeBackground run and the split draw path
  fgUrl?:        string;        // persisted cut-out PNG (subject on transparent bg) public URL — survives reload/export
  fgEffects?:    ImageEffects;  // foreground (subject) layer adjustments
  bgEffects?:    ImageEffects;  // background (everything-else) layer adjustments
  bgHidden?:     boolean;       // detect-background: drop the background entirely — render only the subject cut-out (transparent behind, revealing whatever is below on the slide)
  fgStroke?:     { color: string; width: number };  // outline around the detected subject's silhouette (needs splitEnabled + fgUrl); width in canvas px
  behindSubjectOf?: string;     // id of a detect-background image box: render THIS box between that box's background and subject
  glow?: { color: string; softness: number };  // light leak: render a radial colour gradient (no image), blended over the canvas
  // ── Video: when set, the box plays a video (mp4 / H.264) in place of the static image at `url`. ──
  videoUrl?:    string;       // public URL of the uploaded video; box renders its live frames
  videoMuted?:  boolean;      // editor-preview audio (default muted). Export is silent for now.
  // Fit mode: 'cover' renders the image like CSS object-fit: cover (fill the box,
  // preserve aspect, centre-crop the overflow) unless an explicit crop is set.
  // Independent of `placeholder` — a regular, fully-interactive image can cover-fit.
  fit?:         'cover';
  // ── Image placeholder (slot): an empty image box you fill later. While `url` is empty it renders a
  //    dashed frame in the EDITOR only (never in export/publish); once a url is set it's a normal image.
  //    Lets a template define where an image goes, filled per-post (in the editor or via the CLI). ──
  placeholder?: boolean;
  placeholderLabel?: string;  // optional slot label shown on the empty frame (e.g. "artist photo")
  // Template-defined style locks (same semantics as TextBoxStyle.lockedProps): properties a POST
  // may not change. The box stays selectable, and a placeholder stays FILLABLE (`url` isn't gated);
  // geometry locks block drag/resize/crop in posts mode. Set via the editor or the CLI `lock`.
  lockedProps?: (keyof ImageBox)[];
}

// ── Chart element: an artist index/price chart imported from the trading site, rendered natively
//    on the canvas (drawn in drawCanvas, so it stays crisp at any export scale). The series +
//    releases are snapshotted onto the box so it renders/exports with no network call. ──
export type ChartPeriod = '1D' | '1W' | '1M' | '3M' | '6M' | '1Y' | 'ALL';
export interface ChartRelease {
  date?:  string;   // ISO date of the release
  name?:  string;
  image?: string;   // album-art URL — drawn as a circular marker on the x-axis
  type?:  string;   // 'ALBUM' | 'SINGLE' | ...
}
export interface ChartBox {
  id:          string;
  name?:       string;   // custom layer name shown in the inspector's layer list (falls back to the artist name)
  x:           number;   // top-left, canvas px
  y:           number;
  width:       number;
  height:      number;
  opacity:     number;   // 0-100
  spotifyId:   string;
  artistName:  string;
  artistImage?: string;           // avatar URL for the header block
  // Snapshot of the series + releases at creation time → self-contained render/export.
  data:        { index: number; timestamp: string }[];
  releases?:   ChartRelease[];
  // ── Display config (aspect locked to the chosen layout's design) ──
  // 'mobile' (default) = the app's artist screen (390-wide design, Aug-4 "mobile-faithful" styling).
  // 'web' (Desktop) = the pre-Aug-4 panoramic chart (500-wide design: wider/flatter box, bigger
  // header text without platform icons, TIME-scaled x axis). Restored from commit 1688628^.
  layout?:       'mobile' | 'web';
  showHeader?:   boolean;         // the app's header block (avatar + name, price + "points", ▲ change%) above the chart — mobile layout only
  showPlatformIcons?: boolean;    // Spotify / Apple Music / YouTube icons after the name, like the site (default on)
  period:        ChartPeriod;     // timeframe window
  sinceRelease?: string;          // ISO date of a release anchoring the window: 1 week before it → end of data. Overrides period while set.
  endMode?: 'custom' | 'lowest' | 'highest'; // window end: a custom date, or the lowest/highest point after the start (default: end of data)
  endDate?: string;               // ISO date for endMode 'custom'; period windows then count back from this end
  startDate?: string;             // ISO date pinning the window START. Overrides `period` (and sinceRelease)
                                  // so an arbitrary range can be shown, e.g. one that skips a data outage.
  mode:          'line' | 'candle';
  showGrid?:     boolean;         // dashed horizontal gridlines + y-axis price labels (default on)
  showReleases?: boolean;         // album-art release markers (default on)
  showReleaseNames?: boolean;     // release names beneath the markers (default off; extends the design height)
  showReleaseDates?: boolean;     // release dates ("FEB 6") at the top of each release guide line (default off)
  showXDates?: boolean;           // x-axis date ticks along the bottom (default on; extends the design height)
  showWatermark?: boolean;        // "Sonotrade" watermark, top right (default on)
  animate?: boolean;              // play the site's chart animations (draw-on, dot pulse, spark); the slide exports as a 20s video
  showLastDot?:  boolean;         // dot at the latest point (default on)
  fillArea?:     boolean;         // gradient fill under the line (default on)
  positiveColor?: string;         // up colour (default #04df9d)
  negativeColor?: string;         // down colour (default #FF4B4B)
  gridColor?:    string;
  labelColor?:   string;
  bgColor?:      string;          // chart background fill (default transparent)
  hidden?:       boolean;
  locked?:       boolean;
}

// Pure builders for the free-positioned elements a headless CLI/agent constructs.
// Dimensions are explicit (no DOM aspect-probe); the id is a plain uuid.
function newElementId(prefix: string): string {
  return (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
    ? crypto.randomUUID()
    : `${prefix}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

export function defaultImageBox(opts: {
  url?: string; x: number; y: number; width: number; height: number;
  opacity?: number; cornerRadius?: number; aspect?: number;
  placeholder?: boolean; placeholderLabel?: string;
}): ImageBox {
  return {
    id: newElementId('img'),
    url: opts.url ?? '',
    x: opts.x, y: opts.y, width: opts.width, height: opts.height,
    opacity: opts.opacity ?? 100,
    cornerRadius: opts.cornerRadius ?? 0,
    aspect: opts.aspect ?? (opts.height > 0 ? opts.width / opts.height : undefined),
    ...(opts.placeholder ? { placeholder: true } : {}),
    ...(opts.placeholderLabel ? { placeholderLabel: opts.placeholderLabel } : {}),
  };
}

// An empty image SLOT for a template (no url yet). Renders a frame in the editor; fill later.
export function defaultImagePlaceholder(opts: {
  x: number; y: number; width: number; height: number;
  label?: string; opacity?: number; cornerRadius?: number; aspect?: number;
}): ImageBox {
  return defaultImageBox({ ...opts, url: '', placeholder: true, placeholderLabel: opts.label });
}

export function defaultChartBox(opts: {
  x: number; y: number; width: number; height: number;
  spotifyId: string; artistName: string;
  data: { index: number; timestamp: string }[];
  opacity?: number; period?: ChartPeriod; mode?: 'line' | 'candle';
  releases?: ChartRelease[]; artistImage?: string;
}): ChartBox {
  return {
    id: newElementId('chart'),
    x: opts.x, y: opts.y, width: opts.width, height: opts.height,
    opacity: opts.opacity ?? 100,
    spotifyId: opts.spotifyId,
    artistName: opts.artistName,
    artistImage: opts.artistImage,
    data: opts.data,
    releases: opts.releases,
    period: opts.period ?? 'ALL',
    mode: opts.mode ?? 'line',
  };
}

export type LayerKind = 'image' | 'text' | 'fade' | 'chart';

// Reserved layer id for the settings fade (bottom/top gradient overlay) so it can be ordered
// among the free elements. It's a sentinel, not a real element id.
export const FADE_LAYER_ID = '__fade__';

// Resolve the unified bottom→top draw order of the free elements (image + text boxes), and
// optionally the settings fade. Honours `orderIds`; elements missing from it are appended on top
// (images before text). The fade, if included and unordered, defaults to the very bottom (its
// original position, under everything) — so existing templates render unchanged.
export function orderedLayerIds(
  imageBoxes: { id: string }[],
  textBoxes: { id: string }[],
  orderIds?: string[],
  includeFade = false,
  chartBoxes: { id: string }[] = [],
): { kind: LayerKind; id: string }[] {
  const kindById = new Map<string, LayerKind>();
  for (const b of imageBoxes) kindById.set(b.id, 'image');
  for (const t of textBoxes) kindById.set(t.id, 'text');
  for (const c of chartBoxes) kindById.set(c.id, 'chart');
  if (includeFade) kindById.set(FADE_LAYER_ID, 'fade');
  const out: { kind: LayerKind; id: string }[] = [];
  const seen = new Set<string>();
  for (const id of orderIds ?? []) {
    const kind = kindById.get(id);
    if (kind && !seen.has(id)) { out.push({ kind, id }); seen.add(id); }
  }
  if (includeFade && !seen.has(FADE_LAYER_ID)) { out.unshift({ kind: 'fade', id: FADE_LAYER_ID }); seen.add(FADE_LAYER_ID); }
  for (const b of imageBoxes) if (!seen.has(b.id)) { out.push({ kind: 'image', id: b.id }); seen.add(b.id); }
  for (const t of textBoxes) if (!seen.has(t.id)) { out.push({ kind: 'text', id: t.id }); seen.add(t.id); }
  for (const c of chartBoxes) if (!seen.has(c.id)) { out.push({ kind: 'chart', id: c.id }); seen.add(c.id); }
  return out;
}

export interface CarouselSettings {
  showFade: boolean;
  fadeReach: number;
  fadeIntensity: number;
  fadeFloor: number;
  showTopFade: boolean;
  topFadeReach: number;
  topFadeIntensity: number;
  topFadeFloor: number;
  fontSize: number;
  lSpacing: number;
  lHeight: number;
  fontLabel: CarouselFontLabel;
  fontWeight: CarouselFontWeight;
  italic: boolean;
  textAlign: CarouselTextAlign;
  allCaps: boolean;
  subFontSize: number;
  subLSpacing: number;
  subLHeight: number;
  subFontLabel: CarouselFontLabel;
  subFontWeight: CarouselFontWeight;
  subItalic: boolean;
  subTextAlign: CarouselTextAlign;
  subAllCaps: boolean;
  headSubGap: number;
  aboveLogoGap: number;
  logoOpacity: number;
  logoScale: number;
  logoCornerRadius: number;
  contentPadding: number;
  tagStyle: TagStyle;
  tagSlots:       ({ text: string; style: TagStyle } | null)[];
  tagSlotAligns?:  ('left' | 'center' | 'right')[];
  logoSlotAligns?: ('left' | 'center' | 'right')[];
  // Zone-level independent slots: 9 entries, index = row*3 + zone (0=left,1=center,2=right)
  tagZoneSlots?:   ({ text: string; style: TagStyle } | null)[];
  quoteZoneSlots?: (string | null)[];
  zoneLogoSlots?:  (string | null)[];      // 9 entries — logo URL per zone, null = empty
  logoRowSlots?:   (string | null)[];     // 3 entries — logo URL per row slot, null = empty
  swipeZoneSlots?: (SwipeStyle | null)[];  // 9 entries, row*3+zone
  bgBlurEnabled:  boolean;
  bgBlurAmount:   number;
  bgDarkenAmount: number;
  canvasColor:    string;
  canvasTransparent?: boolean;   // render the background transparent (checkerboard in editor); keeps canvasColor so it can be restored
  // Bottom-fade floor anchor: a text box id — when set, the fade's FLOOR is that box's
  // top edge (resolved at draw time), so "solid black starts exactly at the headline"
  // stays true through every retext. Empty string = unset (fadeFloor % applies).
  fadeFloorAnchor?: string;
  // Slide-level template locks: SETTINGS names a POST may not change (e.g. 'canvasColor',
  // 'showFade', 'fadeIntensity'). Element-level locks live on each box's lockedProps;
  // this covers the slide-wide knobs. Enforced in posts mode only, like element locks.
  lockedSettings?: string[];
  textBoxes:      TextBoxStyle[];
  imageBoxes:     ImageBox[];
  chartBoxes?:    ChartBox[];   // trading-site index/price charts, rendered natively on the canvas
  // Unified bottom→top draw order for free elements (image + text boxes) + the fade (FADE_LAYER_ID).
  // Ids missing here render on top (images before text); the fade defaults to the bottom.
  layerOrderIds?: string[];
  fadeHidden?:    boolean;   // layers panel: hide the settings fade without touching its on/reach values
  fadeLocked?:    boolean;   // layers panel: pin the fade's stack position (can't be reordered)
  // layers panel: the fade layer has been DELETED from this slide — no card, never
  // drawn, out of the z-order. Distinct from showFade:false ("present, toggled
  // off") and fadeHidden ("present, temporarily hidden"). Re-added from the rail.
  fadeRemoved?:   boolean;
  layerOrder:     LayerId[];
  circleBorderWidth:   number;
  circleBorderColor:   string;
  circleBorderOpacity: number;
  circleShadowEnabled: boolean;
  circleShadowBlur:    number;
  circleShadowOffsetX: number;
  circleShadowOffsetY: number;
  circleShadowColor:   string;
  circleShadowOpacity: number;
  circleLift:          number;
  quoteSlots:     (string | null)[];
  dividerSlots?:     (string | null)[];
  dividerSubSlots?:  (DividerSubSlotContent | null)[];
  dividerSettings?:  (Partial<DividerStyleSettings> | null)[];
  quoteColor:     string;
  quoteSize:      number;
  quoteOpacity:   number;
  quoteGap:       number;
  headlineColor:  string;
  subheadlineColor: string;
  headlineShadow?:    ShadowStyle;
  subShadow?:         ShadowStyle;
  logoShadow?:        ShadowStyle;
  quoteShadow?:       ShadowStyle;
  headlineSpans:  TextSpan[] | null;
  subSpans:       TextSpan[] | null;
  circle2BorderWidth:   number;
  circle2BorderColor:   string;
  circle2BorderOpacity: number;
  circle2ShadowEnabled: boolean;
  circle2ShadowBlur:    number;
  circle2ShadowOffsetX: number;
  circle2ShadowOffsetY: number;
  circle2ShadowColor:   string;
  circle2ShadowOpacity: number;
  circle2Lift:          number;
}

// ── Safe zone ────────────────────────────────────────────────────────────────
// The rectangle content should live inside: SAFE_INSET from the top and both
// sides, and the same inset above the FADE FLOOR (the y where the bottom fade
// goes fully solid), not above the canvas floor. Expressed as a fixed rectangle
// but derived from the slide, so it stays correct as the fade is tuned.
//
// The width lands on 960 — the same 60px gutters charts already use, so the
// whole layout system agrees on one grid.
//
// Deliberately NOT applied to full-bleed background textures; those span the
// canvas on purpose. It governs subject imagery: faces, objects, charts.
export const SAFE_INSET = 60;

export interface SafeZone {
  x: number; y: number; width: number; height: number;
  right: number; bottom: number;
  fadeFloor: number;   // where the fade turns fully solid (bottom + SAFE_INSET)
}

// Mirrors the renderer's resolveFloorTop (TemplateEditorCanvas drawFade): an
// anchored fade follows its text box's top edge, otherwise it's the fadeFloor
// percentage. A slide with no bottom fade has no floor — the canvas edge stands
// in, so the zone is simply inset on all four sides.
export function fadeFloorTop(s: CarouselSettings, canvasH = 1350): number {
  const faded = !s.fadeRemoved && !!s.showFade;
  if (!faded) return canvasH;
  if (s.fadeFloorAnchor) {
    const tb = (s.textBoxes ?? []).find(t => t.id === s.fadeFloorAnchor);
    if (tb) return Math.max(0, Math.min(canvasH, tb.y));
  }
  return canvasH - canvasH * 0.6 * (s.fadeFloor / 100);
}

export function safeZone(s: CarouselSettings, canvasW = 1080, canvasH = 1350): SafeZone {
  const floor = fadeFloorTop(s, canvasH);
  const x = SAFE_INSET;
  const y = SAFE_INSET;
  const right = canvasW - SAFE_INSET;
  const bottom = Math.round(floor - SAFE_INSET);
  return {
    x, y, right, bottom,
    width: right - x,
    height: Math.max(0, bottom - y),
    fadeFloor: Math.round(floor),
  };
}

// How a box sits against the safe zone. Returns the edges it escapes on (empty
// = inside). Used to WARN on placement rather than to forbid it: a deliberate
// bleed is legitimate, an accidental one is the bug this catches.
export function outsideSafeZone(
  box: { x: number; y: number; width: number; height: number },
  zone: SafeZone,
): ('top' | 'left' | 'right' | 'bottom')[] {
  const out: ('top' | 'left' | 'right' | 'bottom')[] = [];
  if (box.y < zone.y) out.push('top');
  if (box.x < zone.x) out.push('left');
  if (box.x + box.width > zone.right) out.push('right');
  if (box.y + box.height > zone.bottom) out.push('bottom');
  return out;
}

export function defaultCarouselSettings(): CarouselSettings {
  return {
    showFade: true, fadeReach: 40, fadeIntensity: 85, fadeFloor: 20,
    showTopFade: false, topFadeReach: 40, topFadeIntensity: 85, topFadeFloor: 20,
    // Present by default. In the defaults (unlike fadeHidden/fadeLocked) so the
    // CLI's set-settings accepts it — deleting the fade layer is a real edit a
    // headless agent can make, not a UI-only gesture.
    fadeRemoved: false,
    fontSize: 68, lSpacing: 0, lHeight: 15,
    fontLabel: 'Inter', fontWeight: 700, italic: false, textAlign: 'left', allCaps: false,
    subFontSize: 32, subLSpacing: 0, subLHeight: 10,
    subFontLabel: 'Inter', subFontWeight: 400, subItalic: false, subTextAlign: 'left', subAllCaps: false,
    headSubGap: 20, aboveLogoGap: 8, logoOpacity: 100, logoScale: 100, logoCornerRadius: 0, contentPadding: 50,
    tagStyle: defaultTagStyle(),
    tagSlots: Array(3).fill(null),
    bgBlurEnabled: false, bgBlurAmount: 10, bgDarkenAmount: 0, canvasColor: '#000000', fadeFloorAnchor: '',
    textBoxes: [],
    imageBoxes: [],
    layerOrder: ['background', 'subject'] as LayerId[],
    circleBorderWidth: 10, circleBorderColor: '#ffffff', circleBorderOpacity: 100,
    circleShadowEnabled: false,
    circleShadowBlur: 20, circleShadowOffsetX: 0, circleShadowOffsetY: 8,
    circleShadowColor: '#000000', circleShadowOpacity: 50,
    circleLift: 0,
    quoteSlots:    Array(3).fill(null),
    quoteColor:    '#ffffff',
    quoteSize:     120,
    quoteOpacity:  100,
    quoteGap:      8,
    headlineColor: '#ffffff',
    subheadlineColor: '#ffffff',
    headlineSpans: null,
    subSpans:      null,
    circle2BorderWidth: 10, circle2BorderColor: '#ffffff', circle2BorderOpacity: 100,
    circle2ShadowEnabled: false,
    circle2ShadowBlur: 20, circle2ShadowOffsetX: 0, circle2ShadowOffsetY: 8,
    circle2ShadowColor: '#000000', circle2ShadowOpacity: 50,
    circle2Lift: 0,
  };
}

export interface CarouselBgLayerState {
  fgMaskReady: boolean;
  isBgProcessing: boolean;
  bgProcessError: boolean;
}

export interface TextBoxRichTextControls {
  activeBox: number | null;            // index of the text box currently being inline-edited (null = none)
  hasSelection: boolean;               // whether a run is selected inside that editor
  setWeight: (weight: number) => void; // style the current selection
  toggleItalic: () => void;
  setColor: (color: string) => void;
  toggleSecondary: () => void;         // toggle the selection between primary and secondary style
}

export interface TemplateEditorSettingsPanelProps {
  settings: CarouselSettings;
  onChange: (partial: Partial<CarouselSettings>) => void;
  // Posts only: the designated Instagram caption stored on the POST row (not the
  // slide). Present → the panel renders a Caption island in the global-settings
  // stack; the grid owns loading/saving (see TemplateEditorGrid's caption state).
  // Delete the fade LAYER from the active slide (clears both edges, drops the
  // __fade__ sentinel from layerOrderIds, sets fadeRemoved). Absent → no delete
  // affordance. Re-adding is the rail's job.
  onRemoveFade?: () => void;
  postCaption?: {
    value: string;          // current text ('' while loading or when unset)
    loading: boolean;       // initial fetch in flight — textarea disabled
    max: number;            // char cap (POST_CAPTION_MAX = 2199)
    onChange: (v: string) => void;
    // TEMPLATE mode: what is typed here becomes every post's caption, LOCKED.
    // Left blank, posts write their own. Drives the island's copy, not behaviour.
    isTemplate?: boolean;
    // POSTS mode: the template filled this in, so it is read-only here.
    locked?: boolean;
  };
  videoMode?: boolean;
  selectedImageBox?: number | null;
  // The currently-selected free element (text/image). Drives which element section is expanded in
  // the inspector; expanding a section calls onSelectElement to select that element on the canvas.
  selectedElement?: SelectedElement | null;
  onSelectElement?: (sel: SelectedElement | null) => void;
  lockImageAspect?: boolean;
  onLockImageAspectChange?: (v: boolean) => void;
  richText?: TextBoxRichTextControls;
  // Per-box subject-split bg-removal status (keyed by image box id) for the Background/Foreground UI.
  imageBoxBgState?: Record<string, 'processing' | 'error'>;
  // Per-box BRIA image-expansion status (keyed by box id) + the action that runs the expand.
  imageBoxExpandState?: Record<string, 'processing' | 'error'>;
  onExpandImageBox?: (boxId: string) => void;
  // Image-expansion preview: the box currently being set up (its fill area is shaded on the canvas),
  // and the toggle to enter (boxId) / exit (null) that preview before generating.
  expandPreviewBoxId?: string | null;
  onExpandPreview?: (boxId: string | null) => void;
  // Perspective/distort transform: the box currently in corner-edit mode (its corner handles show
  // on the canvas), the active edit mode, and the toggles to enter/exit + switch mode.
  perspectiveBoxId?: string | null;
  onPerspectiveBox?: (boxId: string | null) => void;
  perspectiveMode?: PerspectiveMode;
  onPerspectiveMode?: (mode: PerspectiveMode) => void;
}
