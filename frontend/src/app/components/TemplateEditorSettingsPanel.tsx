'use client';

import { Fragment, useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type {
  CarouselSettings, CarouselFontLabel, CarouselFontWeight, CarouselTextAlign,
  TagStyle, LayerId, TemplateEditorSettingsPanelProps, DividerStyleSettings,
  SwipeStyle, SwipeArrowType, SwipeLayout, SwipeDirection, ShadowStyle,
  DividerSubSlotContent, TextBoxStyle, ImageBox, ImageBoxFade, ImageEffects, TextBoxRichTextControls, PerspectiveMode, TextSpan,
  ChartBox, ChartPeriod, LayerKind,
} from './templateEditorTypes';
import { perspectiveForRotation, rotationFromPerspective } from './templateEditorTypes';

// Re-map rich spans onto edited plain text (for the panel's text field): keep each run's styling on the
// unchanged head/tail of the text and make only the edited middle plain. This lets you edit a box's text
// from the settings panel without wiping its per-word secondary-style highlights.
function remapSpans(spans: TextSpan[], newText: string): TextSpan[] | undefined {
  const oldText = spans.map(s => s.text).join('');
  if (oldText === newText) return spans;
  const minLen = Math.min(oldText.length, newText.length);
  let p = 0; while (p < minLen && oldText[p] === newText[p]) p++;
  let suf = 0; while (suf < minLen - p && oldText[oldText.length - 1 - suf] === newText[newText.length - 1 - suf]) suf++;
  const out: TextSpan[] = [];
  const slice = (from: number, to: number) => {        // emit old-span pieces covering [from,to), keeping style
    let pos = 0;
    for (const sp of spans) {
      const a = pos, b = pos + sp.text.length; pos = b;
      const lo = Math.max(a, from), hi = Math.min(b, to);
      if (hi > lo) out.push({ ...sp, text: sp.text.slice(lo - a, hi - a) });
    }
  };
  slice(0, p);                                          // unchanged head — styling preserved
  const mid = newText.slice(p, newText.length - suf);
  if (mid) out.push({ text: mid });                     // edited middle — plain (primary)
  slice(oldText.length - suf, oldText.length);          // unchanged tail — styling preserved
  const res = out.filter(r => r.text);
  return res.length ? res : undefined;
}
import { CAROUSEL_FONTS, CAROUSEL_WEIGHTS, MAX_FONT, SUB_MAX, defaultTagStyle, defaultDividerSettings, defaultSwipeStyle, defaultShadowStyle, orderedLayerIds, FADE_LAYER_ID, IMAGES_LAYER_ID, isPropLocked, hasGeometryLock, TEXT_LOCK_PRESET, IMAGE_LOCK_PRESET } from './templateEditorTypes';

// Hard single-line width check for the panel's text textarea (mirrors the canvas inline-edit
// guard and the headless render guard: same font shorthand, per-run weights, letterSpacing).
let slMeasureCtx: CanvasRenderingContext2D | null = null;
function singleLineTextFits(tb: TextBoxStyle, text: string, spans?: TextSpan[]): boolean {
  if (!slMeasureCtx) slMeasureCtx = document.createElement('canvas').getContext('2d');
  const ctx = slMeasureCtx;
  if (!ctx) return true;   // measurement unavailable — don't block editing
  const entry = resolveCarouselFont(tb.fontLabel);
  try { (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${tb.letterSpacing ?? 0}px`; } catch { /* older engines */ }
  const caps = (s: string) => (tb.allCaps ? s.toUpperCase() : s).replace(/\n/g, ' ');
  const secW = tb.secondaryWeight ?? tb.fontWeight;
  const runs = spans?.length
    ? spans.map(sp => ({ text: caps(sp.text), weight: sp.weight ?? (sp.secondary ? secW : sp.bold ? Math.max(700, tb.fontWeight) : tb.fontWeight), italic: sp.italic ?? tb.italic }))
    : [{ text: caps(text), weight: tb.fontWeight, italic: tb.italic }];
  let w = 0;
  for (const r of runs) {
    ctx.font = `${r.italic ? 'italic ' : ''}${r.weight} ${tb.fontSize}px ${entry.css}`;
    w += ctx.measureText(r.text).width;
  }
  return w <= tb.width + 0.5;
}
import { chartAspect } from './TemplateEditorCanvas/drawing/chart';
import { CAROUSEL_W, CAROUSEL_H } from './TemplateEditorCanvas/constants';
import { QUOTE_STYLES } from './templateEditorQuoteStyles';
import { TemplateEditorSwipePreviewMini } from './TemplateEditorSwipePreviewMini';
import { FadeGradientEditor } from './FadeGradientEditor';
import { useCustomFonts, resolveCarouselFont } from './customFonts';

// Swatch palette for per-run text colour (mirrors the canvas inline editor)
const RICH_COLORS = [
  '#ffffff', '#000000', '#9ca3af',
  '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899', '#f43f5e',
];

// ── Shared settings UI components ────────────────────────────────────────────

function Slider({ label, value, min = 0, max = 100, unit = '%', onChange }: {
  label: string; value: number; min?: number; max?: number; unit?: string; onChange: (v: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-micro text-label-secondary truncate">{label}</span>
        <div className="flex items-center gap-0.5 shrink-0">
          <input
            type="number" min={min} max={max} value={Math.round(value)}
            onChange={e => { const n = Number(e.target.value); if (Number.isFinite(n)) onChange(Math.max(min, Math.min(max, n))); }}
            aria-label={`${label} value`}
            className="w-9 h-6 bg-surface border border-separator rounded text-micro text-label-secondary text-right tabular-nums px-1 focus:border-tint [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          {unit && <span className="text-micro text-label-tertiary w-2.5 text-center">{unit}</span>}
        </div>
      </div>
      <input type="range" min={min} max={max} value={value} onChange={e => onChange(Number(e.target.value))}
        aria-label={label} aria-valuetext={`${value}${unit}`}
        className="w-full h-1.5 cursor-pointer" />
    </div>
  );
}

function PillBtn({ active, onClick, children, compact }: { active: boolean; onClick: () => void; children: ReactNode; compact?: boolean }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active} className={`px-2 flex items-center rounded-md text-micro transition-colors ${
      compact ? 'py-2' : 'h-9'
    } ${
      active ? 'bg-accent text-on-accent' : 'bg-surface border border-separator text-label-tertiary hover:text-label-secondary hover:border-label-quaternary'
    }`}>{children}</button>
  );
}

// ── Apple-HIG control primitives (local, presentational) ─────────────────────
// These replace the styled-button patterns above with controls that match the
// HIG: a segmented control for exclusive choices (buttons.md — exclusive sets are
// segmented controls, not button variants), a switch for binary on/off
// (settings.md — toggles use role="switch"), a touch-sized colour swatch
// (buttons.md — ≥40px hit targets, named via aria-label), and a numeric stepper
// (text-fields.md — real number input with clear ± affordances).

// A small caption above a control. Establishes the label hierarchy:
// section titles are text-body-sm semibold text-label (CollapsibleSection);
// control labels are this — text-micro text-label-secondary.
function ControlLabel({ children }: { children: ReactNode }) {
  return <span className="text-micro text-label-secondary">{children}</span>;
}

// Exclusive single-choice control. One option is selected at a time; the
// selected segment fills with the accent, the rest read as quiet text. Items
// are real buttons with aria-pressed and a group role (buttons.md, forms.md).
function SegmentedControl<T extends string>({
  label, value, options, onChange, columns,
}: {
  label?: string;
  value: T;
  options: { value: T; label?: ReactNode; icon?: ReactNode; title?: string }[];
  onChange: (v: T) => void;
  columns?: number;        // wrap into a grid when there are many options
}) {
  const grid = columns != null;
  return (
    <div className="flex flex-col gap-1.5">
      {label && <ControlLabel>{label}</ControlLabel>}
      <div
        role="group"
        aria-label={label}
        className={`p-0.5 rounded-md bg-surface-1 border border-separator ${grid ? 'grid gap-0.5' : 'flex gap-0.5'}`}
        style={grid ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : undefined}
      >
        {options.map(opt => {
          const selected = opt.value === value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange(opt.value)}
              aria-pressed={selected}
              aria-label={opt.title ?? (typeof opt.label === 'string' ? opt.label : undefined)}
              title={opt.title}
              className={`min-w-0 flex-1 flex items-center justify-center gap-1 h-8 px-2 rounded text-micro transition-colors ${
                selected
                  ? 'bg-accent text-on-accent shadow-sm'
                  : 'text-label-tertiary hover:text-label-secondary hover:bg-surface-2'
              }`}
            >
              {opt.icon && <span className="shrink-0 flex items-center">{opt.icon}</span>}
              {opt.label != null && <span className="truncate">{opt.label}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Binary on/off switch. Label sits left, switch right; the whole row is the
// control so the hit target is generous (settings.md — toggles use role="switch"
// and expose aria-checked; pair risky toggles with a one-line note via helper).
function ToggleSwitch({
  label, checked, onChange, title, helper,
}: {
  label: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  title?: string;
  helper?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => onChange(!checked)}
        role="switch"
        aria-checked={checked}
        title={title}
        className="w-full flex items-center justify-between gap-2 rounded-md min-h-6"
      >
        <span className="text-micro text-label-secondary text-left">{label}</span>
        <span className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${checked ? 'bg-tint' : 'bg-surface-2'}`}>
          <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${checked ? 'translate-x-4' : ''}`} />
        </span>
      </button>
      {helper && <span className="text-micro text-label-quaternary leading-snug">{helper}</span>}
    </div>
  );
}

// Touch-friendly colour swatch that opens the native picker. Renders a labelled
// row by default (label left, swatch + hex right). The swatch is a real button
// with an aria-label naming the colour (buttons.md — icon-only controls get a
// programmatic name; ≥28px hit target).
function ColourSwatch({
  label, value, onChange, showHex = true,
}: {
  label?: ReactNode;
  value: string;
  onChange: (c: string) => void;
  showHex?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const name = typeof label === 'string' ? label : 'Colour';
  return (
    <div className="flex items-center justify-between gap-2">
      {label && <ControlLabel>{label}</ControlLabel>}
      <div className="relative flex items-center gap-2 shrink-0">
        {showHex && <span className="text-micro text-label-quaternary tabular-nums uppercase">{value}</span>}
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          aria-label={`${name}: ${value}`}
          title="Change colour"
          className="w-7 h-7 rounded-md border border-separator hover:border-label-quaternary transition-colors shrink-0"
          style={{ backgroundColor: value }}
        />
        <input
          ref={inputRef}
          type="color"
          value={value}
          onChange={e => onChange(e.target.value)}
          tabIndex={-1}
          aria-hidden
          className="absolute right-0 top-0 w-7 h-7 opacity-0 pointer-events-none"
        />
      </div>
    </div>
  );
}

// Numeric stepper: a real number input flanked by −/+ buttons, sharing one
// bordered shell. Keeps a local draft while focused so the field can be cleared
// and retyped; commits valid numbers live (text-fields.md — real number input,
// clamp to bounds, preserve typed value).
function Stepper({
  value, min, max, step = 1, unit, onCommit, width = 'w-12', disabled = false, ariaLabel, title,
}: {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  onCommit: (v: number) => void;
  width?: string;
  disabled?: boolean;
  ariaLabel?: string;
  title?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? String(Math.round(value * 100) / 100);
  const clamp = (n: number) => {
    let v = n;
    if (min != null) v = Math.max(min, v);
    if (max != null) v = Math.min(max, v);
    return v;
  };
  const atMin = disabled || (min != null && value <= min);
  const atMax = disabled || (max != null && value >= max);
  const bump = (d: number) => onCommit(clamp(value + d));
  return (
    <div className="flex items-center gap-1 shrink-0">
      <div className={`flex items-stretch rounded-md border bg-surface overflow-hidden ${disabled ? 'border-separator opacity-50' : 'border-separator focus-within:border-tint'}`}>
        <button
          type="button"
          onClick={() => bump(-step)}
          disabled={atMin}
          aria-label="Decrease"
          className="w-6 flex items-center justify-center text-label-tertiary hover:text-label-secondary hover:bg-surface-1 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M2 6h8" /></svg>
        </button>
        <input
          type="number" min={min} max={max} step="any" value={shown}
          disabled={disabled}
          aria-label={ariaLabel}
          title={title}
          onChange={e => {
            setDraft(e.target.value);
            const n = Number(e.target.value);
            if (e.target.value.trim() !== '' && Number.isFinite(n)) onCommit(n);
          }}
          onBlur={() => { if (draft != null && draft.trim() !== '') onCommit(clamp(Number(draft))); setDraft(null); }}
          className={`${width} h-7 bg-transparent border-x border-separator text-center text-micro text-label tabular-nums outline-none disabled:cursor-not-allowed [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`}
        />
        <button
          type="button"
          onClick={() => bump(step)}
          disabled={atMax}
          aria-label="Increase"
          className="w-6 flex items-center justify-center text-label-tertiary hover:text-label-secondary hover:bg-surface-1 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 2v8M2 6h8" /></svg>
        </button>
      </div>
      {unit && <span className={`text-micro ${unit === 'auto' ? 'text-tint' : 'text-label-quaternary'} min-w-4`}>{unit}</span>}
    </div>
  );
}

// A labelled row of two paired number steppers (used for Position X/Y and Size W/H).
function DimRow({ label, fields }: {
  label: string;
  fields: { tag: string; node: ReactNode }[];
}) {
  return (
    <div className="flex items-center gap-2">
      <ControlLabel>{label}</ControlLabel>
      <div className="flex items-center gap-2 ml-auto">
        {fields.map(f => (
          <label key={f.tag} className="flex items-center gap-1 text-micro text-label-tertiary">
            {f.tag}
            {f.node}
          </label>
        ))}
      </div>
    </div>
  );
}

// Secondary disclosure used INSIDE a section to defer rare/advanced controls
// (progressive-disclosure.md — common controls first; rare ones under a labelled,
// keyboard-operable trigger with honest aria-expanded; collapsed content stays
// out of the a11y tree).
function Disclosure({ title, children, defaultOpen = false }: {
  title: string; children: ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  // When an advanced edit becomes active (defaultOpen flips true), keep the
  // section open so its controls are never hidden mid-task. The user can still
  // collapse it once the edit is no longer active.
  const expanded = open || defaultOpen;
  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={() => setOpen(!expanded)}
        aria-expanded={expanded}
        className="flex items-center gap-1.5 py-1 text-left text-micro font-semibold text-label-secondary hover:text-label transition-colors"
      >
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`}>
          <polyline points="9 6 15 12 9 18" />
        </svg>
        {title}
      </button>
      {expanded && <div className="flex flex-col gap-2.5 pt-1.5">{children}</div>}
    </div>
  );
}

// Per-edge fade controls (toggle + fade-to + 4 edge sliders + gradient editor). Reused for the
// foreground and the background layers of an image box.
function ImageFadeControls({ fade, onChange }: { fade?: ImageBoxFade; onChange: (next: ImageBoxFade) => void }) {
  const f: ImageBoxFade = fade ?? { top: 0, bottom: 0, left: 0, right: 0 };
  const hasColor = f.color != null && f.color !== '';
  const anyEdge = (f.top ?? 0) > 0 || (f.bottom ?? 0) > 0 || (f.left ?? 0) > 0 || (f.right ?? 0) > 0;
  const enabled = f.enabled ?? anyEdge;
  const set = (p: Partial<ImageBoxFade>) => onChange({ ...f, ...p });
  return (
    <div className="flex flex-col gap-2">
      <ToggleSwitch label="Edge fade" checked={enabled} onChange={v => set({ enabled: v })} />
      {enabled && (
        <>
          <SegmentedControl<'transparent' | 'colour'>
            label="Fade to"
            value={hasColor ? 'colour' : 'transparent'}
            options={[
              { value: 'transparent', label: 'Transparent' },
              { value: 'colour', label: 'Colour' },
            ]}
            onChange={v => set({ color: v === 'colour' ? (f.color || '#000000') : undefined })}
          />
          {hasColor && (
            <ColourSwatch label="Fade colour" value={f.color || '#000000'} onChange={c => set({ color: c })} />
          )}
          <Slider label="Top"    value={f.top ?? 0}    onChange={v => set({ top: v })} />
          <Slider label="Bottom" value={f.bottom ?? 0} onChange={v => set({ bottom: v })} />
          <Slider label="Left"   value={f.left ?? 0}   onChange={v => set({ left: v })} />
          <Slider label="Right"  value={f.right ?? 0}  onChange={v => set({ right: v })} />
          <FadeGradientEditor fade={f} onChange={onChange} />
        </>
      )}
    </div>
  );
}

const ALIGN_ICONS: { value: CarouselTextAlign; icon: ReactNode }[] = [
  { value: 'left',    icon: <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="2" width="14" height="1.5" rx="0.75"/><rect x="1" y="5.5" width="10" height="1.5" rx="0.75"/><rect x="1" y="9" width="14" height="1.5" rx="0.75"/><rect x="1" y="12.5" width="8" height="1.5" rx="0.75"/></svg> },
  { value: 'center',  icon: <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="2" width="14" height="1.5" rx="0.75"/><rect x="3" y="5.5" width="10" height="1.5" rx="0.75"/><rect x="1" y="9" width="14" height="1.5" rx="0.75"/><rect x="4" y="12.5" width="8" height="1.5" rx="0.75"/></svg> },
  { value: 'right',   icon: <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="2" width="14" height="1.5" rx="0.75"/><rect x="5" y="5.5" width="10" height="1.5" rx="0.75"/><rect x="1" y="9" width="14" height="1.5" rx="0.75"/><rect x="7" y="12.5" width="8" height="1.5" rx="0.75"/></svg> },
  { value: 'justify', icon: <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="2" width="14" height="1.5" rx="0.75"/><rect x="1" y="5.5" width="14" height="1.5" rx="0.75"/><rect x="1" y="9" width="14" height="1.5" rx="0.75"/><rect x="1" y="12.5" width="14" height="1.5" rx="0.75"/></svg> },
];

function FontDropdown({ value, onChange }: { value: CarouselFontLabel; onChange: (v: CarouselFontLabel) => void }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
  const btnRef  = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const customFonts = useCustomFonts();
  const fonts = [...customFonts, ...CAROUSEL_FONTS];   // uploaded fonts first
  const q = query.trim().toLowerCase();
  const filtered = q ? fonts.filter(f => f.label.toLowerCase().includes(q)) : fonts;

  useEffect(() => {
    if (!open) return;
    CAROUSEL_FONTS.forEach(f => {
      if (!f.google) return;
      const id = `gfont-${f.label.replace(/\s+/g, '-')}`;
      if (!document.getElementById(id)) {
        const link = document.createElement('link');
        link.id = id; link.rel = 'stylesheet';
        link.href = `https://fonts.googleapis.com/css2?family=${f.google}&display=swap`;
        document.head.appendChild(link);
      }
    });
    searchRef.current?.focus();
    activeRef.current?.scrollIntoView({ block: 'nearest' });
    function handle(e: MouseEvent) {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || listRef.current?.contains(t)) return;
      setOpen(false);
    }
    window.addEventListener('mousedown', handle);
    return () => window.removeEventListener('mousedown', handle);
  }, [open]);

  function openDropdown() {
    if (!btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    setPos({ top: r.bottom + window.scrollY + 2, left: r.left + window.scrollX, width: r.width });
    setQuery('');
    setOpen(true);
  }

  // Close and return focus to the trigger (AHIG: menus restore focus to their opener).
  function closeDropdown() { setOpen(false); btnRef.current?.focus(); }

  const selectedFont = resolveCarouselFont(value);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => open ? closeDropdown() : openDropdown()}
        className="w-full h-9 bg-surface border border-separator hover:border-label-quaternary rounded-md px-3 outline-none flex items-center justify-between transition-colors"
      >
        <span style={{ fontFamily: selectedFont.css, fontSize: 12, color: 'var(--c-label-2)' }}>{value}</span>
        <svg width="9" height="6" viewBox="0 0 9 6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--c-label-3)', flexShrink: 0, marginLeft: 6 }}>
          <path d="M1 1l3.5 3.5L8 1"/>
        </svg>
      </button>

      {open && typeof document !== 'undefined' && createPortal(
        <div
          ref={listRef}
          role="listbox"
          aria-label="Font"
          style={{
            position: 'absolute',
            top: pos.top, left: pos.left, width: pos.width,
            zIndex: 'var(--z-popover)' as React.CSSProperties['zIndex'],
            background: 'var(--c-bg-1)',
            border: '1px solid var(--c-sep)',
            borderRadius: 8,
            maxHeight: 280,
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
            boxShadow: 'var(--sh-lg)',
          }}
        >
          <div style={{ padding: 6, borderBottom: '1px solid var(--c-sep-subtle)' }}>
            <input
              ref={searchRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              aria-label="Search fonts"
              onKeyDown={e => {
                if (e.key === 'Escape') closeDropdown();
                else if (e.key === 'Enter' && filtered.length) { onChange(filtered[0].label); closeDropdown(); }
              }}
              placeholder="Search fonts…"
              style={{ width: '100%', boxSizing: 'border-box', background: 'var(--c-bg-base)', border: '1px solid var(--c-sep)', borderRadius: 6, padding: '6px 8px', fontSize: 12, color: 'var(--c-label-2)', outline: 'none' }}
            />
          </div>
          <div style={{ overflowY: 'auto' }}>
            {filtered.length === 0 ? (
              <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--c-label-3)' }}>No matching fonts</div>
            ) : filtered.map(f => {
              const isActive = f.label === value;
              return (
                <button
                  key={f.label}
                  ref={isActive ? activeRef : undefined}
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => { onChange(f.label); closeDropdown(); }}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left',
                    padding: '7px 12px', fontSize: 13,
                    fontFamily: f.css,
                    color: isActive ? 'var(--c-label-1)' : 'var(--c-label-3)',
                    background: isActive ? 'var(--c-bg-2)' : 'transparent',
                    cursor: 'pointer', border: 'none', outline: 'none',
                  }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLButtonElement).style.background = 'var(--c-bg-2)';
                    (e.currentTarget as HTMLButtonElement).style.color = 'var(--c-label-1)';
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLButtonElement).style.background = isActive ? 'var(--c-bg-2)' : 'transparent';
                    (e.currentTarget as HTMLButtonElement).style.color = isActive ? 'var(--c-label-1)' : 'var(--c-label-3)';
                  }}
                >
                  {f.label}
                </button>
              );
            })}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

const WEIGHT_LABEL: Record<number, string> = {
  100: 'Thin', 200: 'XLight', 300: 'Light', 400: 'Regular',
  500: 'Medium', 600: 'Semi', 700: 'Bold', 800: 'XBold', 900: 'Black',
};

// Weight buttons that adapt to the selected font: a custom family shows the weights it actually
// ships; built-in fonts show the standard six. Highlights the nearest weight if there's no exact match.
function WeightPicker({ fontLabel, value, onChange, className = 'flex gap-1 flex-wrap' }: {
  fontLabel: CarouselFontLabel;
  value: CarouselFontWeight;
  onChange: (w: CarouselFontWeight) => void;
  className?: string;
}) {
  const custom = useCustomFonts();
  const fam = custom.find(f => f.label === fontLabel);
  const opts: { value: CarouselFontWeight; label: string }[] =
    fam && fam.weights.length
      ? fam.weights.map(w => ({ value: w as CarouselFontWeight, label: fam.weightLabels[w] ?? WEIGHT_LABEL[w] ?? String(w) }))
      : CAROUSEL_WEIGHTS;
  const activeVal = opts.some(o => o.value === value)
    ? value
    : opts.reduce((best, o) => (Math.abs(o.value - value) < Math.abs(best - value) ? o.value : best), opts[0].value);
  return (
    <div className={className}>
      {opts.map(w => (
        <PillBtn key={w.value} active={activeVal === w.value} onClick={() => onChange(w.value)}>
          <span style={{ fontWeight: w.value }}>{w.label}</span>
        </PillBtn>
      ))}
    </div>
  );
}

// The two blend modes that matter for these light/texture overlays.
const BLEND_MODES: { label: string; value: string }[] = [
  { label: 'Screen',  value: 'screen' },
  { label: 'Lighten', value: 'lighten' },
];

function BlendModePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <SegmentedControl
      label="Blend mode"
      value={value}
      options={BLEND_MODES.map(m => ({ value: m.value, label: m.label }))}
      onChange={onChange}
    />
  );
}

// A compact icon button that toggles a binary style (italic, all-caps). Reads
// its state via aria-pressed and the filled accent; sits beside the alignment
// segmented control without changing the dense editor rhythm.
function ToggleButton({ active, onClick, label, title, children }: {
  active: boolean; onClick: () => void; label: string; title?: string; children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      title={title ?? label}
      className={`h-9 px-2.5 flex items-center justify-center rounded-md text-micro transition-colors ${
        active ? 'bg-accent text-on-accent' : 'bg-surface border border-separator text-label-tertiary hover:text-label-secondary hover:border-label-quaternary'
      }`}
    >{children}</button>
  );
}

// ── Template lock affordances (posts mode) ───────────────────────────────────
// When the template locked a control's property the control is HIDDEN outright — posts only
// show what they can actually change. `locked` is only ever true in posts mode (every caller
// gates it on `enforceLocks`), so template mode always renders children as-is.
function LockWrap({ locked, children }: { locked: boolean; children: ReactNode }) {
  if (!locked) return <>{children}</>;
  return null;
}

function StyleRow({ italic, onItalic, allCaps, onAllCaps, align, onAlign }: {
  italic: boolean; onItalic: () => void; allCaps: boolean; onAllCaps: () => void;
  align: CarouselTextAlign; onAlign: (v: CarouselTextAlign) => void;
}) {
  return (
    <div className="flex items-end gap-1.5">
      <div className="flex-1">
        <SegmentedControl<CarouselTextAlign>
          label="Alignment"
          value={align}
          options={ALIGN_ICONS.map(({ value, icon }) => ({ value, icon, title: value }))}
          onChange={onAlign}
        />
      </div>
      <ToggleButton active={italic} onClick={onItalic} label="Italic"><span className="italic">I</span></ToggleButton>
      <ToggleButton active={allCaps} onClick={onAllCaps} label="All caps"><span className="font-bold">AA</span></ToggleButton>
    </div>
  );
}

function TextSettingsBox({
  title, maxFontSize,
  fontSize, letterSpacing, lineSpacing, fontLabel, fontWeight, italic, allCaps, align,
  onChange,
}: {
  title: string; maxFontSize: number;
  fontSize: number; letterSpacing: number; lineSpacing: number;
  fontLabel: CarouselFontLabel; fontWeight: CarouselFontWeight;
  italic: boolean; allCaps: boolean; align: CarouselTextAlign;
  onChange: (p: Partial<CarouselSettings>) => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg bg-surface border border-separator p-3">
      <span className="text-body-sm font-semibold text-label">{title}</span>
      <Slider label="Size"           value={fontSize}       min={1}  max={maxFontSize} unit="px" onChange={v => onChange({ [title === 'Headline' ? 'fontSize' : 'subFontSize']: v })} />
      <Slider label="Letter spacing" value={letterSpacing}  onChange={v => onChange({ [title === 'Headline' ? 'lSpacing' : 'subLSpacing']: v })} />
      <Slider label="Line spacing"   value={lineSpacing}    onChange={v => onChange({ [title === 'Headline' ? 'lHeight'  : 'subLHeight']: v })} />
      <div className="flex flex-col gap-1.5">
        <ControlLabel>Font</ControlLabel>
        <FontDropdown value={fontLabel} onChange={v => onChange({ [title === 'Headline' ? 'fontLabel' : 'subFontLabel']: v })} />
      </div>
      <div className="flex flex-col gap-1.5">
        <ControlLabel>Weight</ControlLabel>
        <WeightPicker
          fontLabel={fontLabel}
          value={fontWeight}
          onChange={w => onChange({ [title === 'Headline' ? 'fontWeight' : 'subFontWeight']: w })}
          className="flex gap-1 flex-wrap"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <StyleRow
          italic={italic}   onItalic={() => onChange({ [title === 'Headline' ? 'italic' : 'subItalic']: !italic })}
          allCaps={allCaps} onAllCaps={() => onChange({ [title === 'Headline' ? 'allCaps' : 'subAllCaps']: !allCaps })}
          align={align}     onAlign={v => onChange({ [title === 'Headline' ? 'textAlign' : 'subTextAlign']: v })}
        />
      </div>
    </div>
  );
}

// ── Tag UI helpers ────────────────────────────────────────────────────────────

const SLOT_LABELS = ['Top Left', 'Top Center', 'Top Right', 'Bottom Left', 'Bottom Center', 'Bottom Right'] as const;
const ZONE_LABELS = ['Top Left', 'Top Center', 'Top Right', 'Mid Left', 'Mid Center', 'Mid Right', 'Bottom Left', 'Bottom Center', 'Bottom Right'] as const;

function TagPillPreview({ ts, text }: { ts: TagStyle; text: string }) {
  const tc = ts.textCase ?? 'none';
  const displayText = tc === 'upper' ? text.toUpperCase() : text;
  return (
    <span style={{
      display: 'inline-block',
      backgroundColor: ts.bgOpacity > 0 ? `${ts.bgColor}${Math.round(ts.bgOpacity * 2.55).toString(16).padStart(2, '0')}` : 'transparent',
      border: ts.borderWidth > 0 ? `${ts.borderWidth}px solid ${ts.borderColor}${Math.round(ts.borderOpacity * 2.55).toString(16).padStart(2, '0')}` : 'none',
      borderRadius: ts.cornerRadius,
      padding: `${ts.paddingY}px ${ts.paddingX}px`,
      color: ts.textColor,
      fontSize: ts.fontSize,
      fontWeight: ts.fontWeight,
      fontStyle: ts.italic ? 'italic' : 'normal',
      fontVariant: tc === 'smallcaps' ? 'small-caps' : 'normal',
      letterSpacing: ts.letterSpacing ? `${ts.letterSpacing}px` : undefined,
      lineHeight: 1.2,
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      maxWidth: '100%',
    }}>{displayText}</span>
  );
}

function TagStyleControls({ ts, onChange }: { ts: TagStyle; onChange: (ts: TagStyle) => void }) {
  const textCase = ts.textCase ?? 'none';
  return (
    <div className="flex flex-col gap-2 pt-1">
      <ColourSwatch label="Background colour" value={ts.bgColor} onChange={c => onChange({ ...ts, bgColor: c })} />
      <Slider label="BG Opacity"     value={ts.bgOpacity}     onChange={v => onChange({ ...ts, bgOpacity: v })} />
      <ColourSwatch label="Border colour" value={ts.borderColor} onChange={c => onChange({ ...ts, borderColor: c })} />
      <Slider label="Border Width"   value={ts.borderWidth}   min={0} max={8}  unit="px" onChange={v => onChange({ ...ts, borderWidth: v })} />
      <Slider label="Border Opacity" value={ts.borderOpacity}                  onChange={v => onChange({ ...ts, borderOpacity: v })} />
      <Slider label="Corner Radius"  value={ts.cornerRadius}  min={0} max={40} unit="px" onChange={v => onChange({ ...ts, cornerRadius: v })} />
      <ColourSwatch label="Text colour" value={ts.textColor} onChange={c => onChange({ ...ts, textColor: c })} />
      <Slider label="Font Size"      value={ts.fontSize}      min={8}  max={36} unit="px" onChange={v => onChange({ ...ts, fontSize: v })} />
      <Slider label="Letter Spacing" value={ts.letterSpacing ?? 0} min={0} max={20} unit="px" onChange={v => onChange({ ...ts, letterSpacing: v })} />
      <div className="flex flex-col gap-1.5">
        <ControlLabel>Weight</ControlLabel>
        <WeightPicker fontLabel={ts.fontLabel} value={ts.fontWeight} onChange={w => onChange({ ...ts, fontWeight: w })} className="flex flex-wrap gap-1" />
      </div>
      <div className="flex items-end gap-1.5">
        <div className="flex-1">
          <SegmentedControl<'none' | 'upper' | 'smallcaps'>
            label="Case"
            value={textCase}
            options={[
              { value: 'none', label: <span style={{ textTransform: 'none' }}>Aa</span>, title: 'Normal case' },
              { value: 'upper', label: <span className="font-bold">AA</span>, title: 'Uppercase' },
              { value: 'smallcaps', label: <span style={{ fontVariant: 'small-caps' }}>Aa</span>, title: 'Small caps' },
            ]}
            onChange={v => onChange({ ...ts, textCase: v })}
          />
        </div>
        <ToggleButton active={ts.italic} onClick={() => onChange({ ...ts, italic: !ts.italic })} label="Italic"><span className="italic">I</span></ToggleButton>
      </div>
      <div className="flex flex-col gap-1.5">
        <ControlLabel>Font</ControlLabel>
        <FontDropdown value={ts.fontLabel} onChange={v => onChange({ ...ts, fontLabel: v })} />
      </div>
      <Slider label="Pad X" value={ts.paddingX} min={0} max={32} unit="px" onChange={v => onChange({ ...ts, paddingX: v })} />
      <Slider label="Pad Y" value={ts.paddingY} min={0} max={20} unit="px" onChange={v => onChange({ ...ts, paddingY: v })} />
      <ShadowEditor value={ts.shadow} onChange={v => onChange({ ...ts, shadow: v })} />
    </div>
  );
}

function ShadowEditor({ value, onChange, showLift = true }: { value?: ShadowStyle; onChange: (s: ShadowStyle) => void; showLift?: boolean }) {
  const s = { ...defaultShadowStyle(), ...value };
  return (
    <div className="flex flex-col gap-2 pt-1">
      <ToggleSwitch label="Shadow" checked={s.enabled} onChange={v => onChange({ ...s, enabled: v })} />
      {s.enabled && (
        <>
          <ColourSwatch label="Shadow colour" value={s.color} onChange={c => onChange({ ...s, color: c })} />
          <Slider label="Blur"     value={s.blur}    min={0}   max={80}  unit="px" onChange={v => onChange({ ...s, blur: v })} />
          <Slider label="Offset X" value={s.offsetX} min={-60} max={60}  unit="px" onChange={v => onChange({ ...s, offsetX: v })} />
          <Slider label="Offset Y" value={s.offsetY} min={-60} max={60}  unit="px" onChange={v => onChange({ ...s, offsetY: v })} />
          <Slider label="Opacity"  value={s.opacity} min={0}   max={100}            onChange={v => onChange({ ...s, opacity: v })} />
        </>
      )}
      {showLift && <Slider label="Lift" value={s.lift} min={-200} max={400} unit="px" onChange={v => onChange({ ...s, lift: v })} />}
    </div>
  );
}

function TagSlotEditor({
  idx, tagSlot, onChange, onRemove, label,
}: {
  idx: number;
  tagSlot: { text: string; style: TagStyle };
  onChange: (slot: { text: string; style: TagStyle }) => void;
  onRemove: () => void;
  label?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="flex flex-col gap-1.5 rounded-lg bg-surface border border-separator p-2">
      {/* Header row: label + preview + expand + remove */}
      <div className="flex items-center gap-1.5">
        <span className="text-micro text-label-tertiary shrink-0 w-16">{label ?? SLOT_LABELS[idx]}</span>
        <div className="flex-1 overflow-hidden min-w-0">
          <TagPillPreview ts={tagSlot.style} text={tagSlot.text} />
        </div>
        <button
          onClick={() => setExpanded(e => !e)}
          className="shrink-0 w-5 h-5 flex items-center justify-center rounded text-label-tertiary hover:text-label-secondary hover:bg-surface-2 transition-colors"
          title={expanded ? 'Collapse' : 'Edit style'}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            {expanded
              ? <polyline points="18 15 12 9 6 15"/>
              : <polyline points="6 9 12 15 18 9"/>}
          </svg>
        </button>
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove"
          className="shrink-0 w-6 h-6 flex items-center justify-center rounded text-label-quaternary hover:text-danger hover:bg-surface-2 transition-colors"
          title="Remove tag"
        >
          <svg width="8" height="8" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M1 1l10 10M11 1L1 11"/>
          </svg>
        </button>
      </div>
      {expanded && (
        <>
          {/* Editable text */}
          <input
            type="text"
            value={tagSlot.text}
            onChange={e => onChange({ ...tagSlot, text: e.target.value })}
            placeholder="Tag text…"
            className="w-full bg-surface border border-separator focus:border-label-quaternary rounded px-2 py-1 text-xs text-label outline-none"
          />
          <TagStyleControls
            ts={tagSlot.style}
            onChange={newStyle => onChange({ ...tagSlot, style: newStyle })}
          />
        </>
      )}
    </div>
  );
}

// ── Divider settings ──────────────────────────────────────────────────────────

const DIVIDER_TYPE_LABEL: Record<string, string> = {
  solid: 'Solid', thick: 'Thick', dashed: 'Dashed', dotted: 'Dotted',
  double: 'Double', 'double-fade': 'Double Fade', triple: 'Triple',
  'dot-center': 'Dot Center', 'dots-row': 'Dots Row', 'diamond-center': 'Diamond',
  'dashed-fade': 'Dashed Fade', 'taper-dashed': 'Taper Dash',
  fade: 'Fade', 'fade-left': 'Fade Left',
  taper: 'Taper', 'thick-taper': 'Thick Taper', 'short-center': 'Short Center',
  wave: 'Wave', brackets: 'Brackets',
  'tag-center': 'Tag Center', 'tag-center-fade': 'Tag Center Fade',
  'tag-double': 'Tag Double', 'tag-short': 'Tag Short',
  'tag-left': 'Tag Left', 'tag-left-fade': 'Tag Left Fade', 'tag-right': 'Tag Right',
  'tag-logo': 'Tag + Logo',
  'logo-center': 'Logo Center', 'logo-center-fade': 'Logo Center Fade',
  'logo-left': 'Logo Left', 'logo-left-fade': 'Logo Left Fade', 'logo-right': 'Logo Right',
};

type DivField = 'lineColor' | 'lineOpacity' | 'lineWeight' | 'dashLen' | 'dashGap' |
  'dotSize' | 'dotSpacing' | 'doubleSpacing' | 'tripleSpacing' | 'centerWeight' |
  'dotRadius' | 'dotGap' | 'taperHeight' | 'shortLength' | 'waveAmplitude' |
  'bracketWidth' | 'bracketMargin' | 'contentGap' | 'fadeSpread';

const DIVIDER_FIELDS: Record<string, DivField[]> = {
  solid:             ['lineColor', 'lineOpacity', 'lineWeight'],
  thick:             ['lineColor', 'lineOpacity', 'lineWeight'],
  dashed:            ['lineColor', 'lineOpacity', 'lineWeight', 'dashLen', 'dashGap'],
  dotted:            ['lineColor', 'lineOpacity', 'dotSize', 'dotSpacing'],
  double:            ['lineColor', 'lineOpacity', 'lineWeight', 'doubleSpacing'],
  'double-fade':     ['lineColor', 'lineOpacity', 'lineWeight', 'doubleSpacing', 'fadeSpread'],
  triple:            ['lineColor', 'lineOpacity', 'lineWeight', 'centerWeight', 'tripleSpacing'],
  'dot-center':      ['lineColor', 'lineOpacity', 'lineWeight', 'dotRadius', 'dotGap'],
  'dashed-fade':     ['lineColor', 'lineOpacity', 'lineWeight', 'dashLen', 'dashGap', 'fadeSpread'],
  'taper-dashed':    ['lineColor', 'lineOpacity', 'lineWeight', 'dashLen', 'dashGap', 'fadeSpread'],
  'dots-row':        ['lineColor', 'lineOpacity', 'dotRadius', 'dotSpacing'],
  'diamond-center':  ['lineColor', 'lineOpacity', 'lineWeight', 'dotRadius', 'dotGap'],
  fade:              ['lineColor', 'lineOpacity', 'lineWeight', 'fadeSpread'],
  'fade-left':       ['lineColor', 'lineOpacity', 'lineWeight', 'fadeSpread'],
  taper:             ['lineColor', 'lineOpacity', 'taperHeight'],
  'thick-taper':     ['lineColor', 'lineOpacity', 'taperHeight'],
  'short-center':    ['lineColor', 'lineOpacity', 'lineWeight', 'shortLength'],
  wave:              ['lineColor', 'lineOpacity', 'lineWeight', 'waveAmplitude'],
  brackets:          ['lineColor', 'lineOpacity', 'lineWeight', 'bracketWidth', 'bracketMargin'],
  'tag-center':      ['lineColor', 'lineOpacity', 'lineWeight', 'contentGap'],
  'tag-center-fade': ['lineColor', 'lineOpacity', 'lineWeight', 'contentGap', 'fadeSpread'],
  'tag-double':      ['lineColor', 'lineOpacity', 'lineWeight', 'doubleSpacing', 'contentGap'],
  'tag-short':       ['lineColor', 'lineOpacity', 'lineWeight', 'contentGap'],
  'tag-left':        ['lineColor', 'lineOpacity', 'lineWeight', 'contentGap'],
  'tag-left-fade':   ['lineColor', 'lineOpacity', 'lineWeight', 'contentGap', 'fadeSpread'],
  'tag-right':       ['lineColor', 'lineOpacity', 'lineWeight', 'contentGap'],
  'tag-logo':        ['lineColor', 'lineOpacity', 'lineWeight', 'contentGap'],
  'logo-center':     ['lineColor', 'lineOpacity', 'lineWeight', 'contentGap'],
  'logo-center-fade':['lineColor', 'lineOpacity', 'lineWeight', 'contentGap', 'fadeSpread'],
  'logo-left':       ['lineColor', 'lineOpacity', 'lineWeight', 'contentGap'],
  'logo-left-fade':  ['lineColor', 'lineOpacity', 'lineWeight', 'contentGap', 'fadeSpread'],
  'logo-right':      ['lineColor', 'lineOpacity', 'lineWeight', 'contentGap'],
};

const SLOT_NAMES_3 = ['Top', 'Center', 'Bottom'] as const;

function DividerSlotEditor({
  idx, divId, ds, onChange, onRemove, subSlot, onSubChange,
}: {
  idx: number;
  divId: string;
  ds: Partial<DividerStyleSettings> | null;
  onChange: (ds: Partial<DividerStyleSettings>) => void;
  onRemove: () => void;
  subSlot?: DividerSubSlotContent | null;
  onSubChange?: (c: DividerSubSlotContent | null) => void;
}) {
  const [expanded, setExpanded] = useState(!!subSlot);
  // Auto-expand whenever a sub-slot arrives/changes (e.g. added from the canvas).
  // Adjusting state during render (React's "adjust state when a prop changes" pattern)
  // instead of in an effect — same end state, without the extra post-paint render pass.
  const [prevSubSlot, setPrevSubSlot] = useState(subSlot);
  if (subSlot !== prevSubSlot) {
    setPrevSubSlot(subSlot);
    if (subSlot) setExpanded(true);
  }
  const resolved: DividerStyleSettings = { ...defaultDividerSettings(divId), ...(ds ?? {}) };
  const fields = DIVIDER_FIELDS[divId] ?? ['lineColor', 'lineOpacity', 'lineWeight'];

  function upd(patch: Partial<DividerStyleSettings>) {
    onChange({ ...(ds ?? {}), ...patch });
  }

  const has = (f: DivField) => fields.includes(f);

  return (
    <div className="flex flex-col gap-1.5 rounded-lg bg-surface border border-separator p-2">
      <div className="flex items-center gap-1.5">
        <span className="text-micro text-label-tertiary shrink-0 w-12">{SLOT_NAMES_3[idx] ?? `#${idx + 1}`}</span>
        <span className="flex-1 text-micro text-label-secondary font-medium truncate">{DIVIDER_TYPE_LABEL[divId] ?? divId}</span>
        <button
          onClick={() => setExpanded(e => !e)}
          className="shrink-0 w-5 h-5 flex items-center justify-center rounded text-label-tertiary hover:text-label-secondary hover:bg-surface-2 transition-colors"
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            {expanded ? <polyline points="18 15 12 9 6 15"/> : <polyline points="6 9 12 15 18 9"/>}
          </svg>
        </button>
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove"
          className="shrink-0 w-6 h-6 flex items-center justify-center rounded text-label-quaternary hover:text-danger hover:bg-surface-2 transition-colors"
        >
          <svg width="8" height="8" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M1 1l10 10M11 1L1 11"/>
          </svg>
        </button>
      </div>
      {expanded && (
        <div className="flex flex-col gap-2 pt-1">
          {has('lineColor') && (
            <ColourSwatch label="Colour" value={resolved.lineColor} onChange={c => upd({ lineColor: c })} />
          )}
          {has('lineOpacity') && (
            <Slider label="Opacity" value={resolved.lineOpacity} onChange={v => upd({ lineOpacity: v })} />
          )}
          {has('lineWeight') && (
            <Slider label="Line Weight" value={resolved.lineWeight} min={1} max={20} unit="px" onChange={v => upd({ lineWeight: v })} />
          )}
          {has('dashLen') && (
            <Slider label="Dash Length" value={resolved.dashLen} min={4} max={120} unit="px" onChange={v => upd({ dashLen: v })} />
          )}
          {has('dashGap') && (
            <Slider label="Dash Gap" value={resolved.dashGap} min={4} max={120} unit="px" onChange={v => upd({ dashGap: v })} />
          )}
          {has('dotSize') && (
            <Slider label="Dot Size" value={resolved.dotSize} min={1} max={20} unit="px" onChange={v => upd({ dotSize: v })} />
          )}
          {has('dotSpacing') && (
            <Slider label="Dot Spacing" value={resolved.dotSpacing} min={4} max={80} unit="px" onChange={v => upd({ dotSpacing: v })} />
          )}
          {has('doubleSpacing') && (
            <Slider label="Line Offset" value={resolved.doubleSpacing} min={2} max={40} unit="px" onChange={v => upd({ doubleSpacing: v })} />
          )}
          {has('tripleSpacing') && (
            <Slider label="Outer Offset" value={resolved.tripleSpacing} min={2} max={40} unit="px" onChange={v => upd({ tripleSpacing: v })} />
          )}
          {has('centerWeight') && (
            <Slider label="Center Weight" value={resolved.centerWeight} min={1} max={20} unit="px" onChange={v => upd({ centerWeight: v })} />
          )}
          {has('dotRadius') && (
            <Slider label="Dot Radius" value={resolved.dotRadius} min={2} max={30} unit="px" onChange={v => upd({ dotRadius: v })} />
          )}
          {has('dotGap') && (
            <Slider label="Dot Gap" value={resolved.dotGap} min={0} max={80} unit="px" onChange={v => upd({ dotGap: v })} />
          )}
          {has('taperHeight') && (
            <Slider label="Taper Height" value={resolved.taperHeight} min={5} max={60} unit="%" onChange={v => upd({ taperHeight: v })} />
          )}
          {has('shortLength') && (
            <Slider label="Line Length" value={resolved.shortLength} min={10} max={90} unit="%" onChange={v => upd({ shortLength: v })} />
          )}
          {has('waveAmplitude') && (
            <Slider label="Amplitude" value={resolved.waveAmplitude} min={2} max={50} unit="%" onChange={v => upd({ waveAmplitude: v })} />
          )}
          {has('bracketWidth') && (
            <Slider label="Bracket Width" value={resolved.bracketWidth} min={5} max={80} unit="px" onChange={v => upd({ bracketWidth: v })} />
          )}
          {has('bracketMargin') && (
            <Slider label="Side Margin" value={resolved.bracketMargin} min={0} max={120} unit="px" onChange={v => upd({ bracketMargin: v })} />
          )}
          {has('contentGap') && (
            <Slider label="Content Gap" value={resolved.contentGap} min={0} max={80} unit="px" onChange={v => upd({ contentGap: v })} />
          )}
          {has('fadeSpread') && (
            <Slider
              label="Fade Spread"
              value={resolved.fadeSpread}
              min={0}
              max={['fade-left', 'logo-left-fade', 'tag-left-fade'].includes(divId) ? 100 : 50}
              unit="%"
              onChange={v => upd({ fadeSpread: v })}
            />
          )}
          <ShadowEditor
            value={(ds as Partial<DividerStyleSettings> & { shadow?: ShadowStyle } | null)?.shadow}
            onChange={v => onChange({ ...(ds ?? {}), shadow: v })}
          />
          {subSlot?.type === 'tag' && onSubChange && (
            <div className="flex flex-col gap-2 pt-2 border-t border-separator">
              <div className="flex items-center justify-between">
                <span className="text-micro font-semibold text-label-tertiary  ">Box Tag</span>
                <button onClick={() => onSubChange(null)} className="text-micro text-label-quaternary hover:text-danger transition-colors">Remove</button>
              </div>
              <TagPillPreview ts={subSlot.style} text={subSlot.text} />
              <input
                type="text"
                value={subSlot.text}
                onChange={e => onSubChange({ ...subSlot, text: e.target.value })}
                placeholder="Tag text…"
                className="w-full bg-surface border border-separator focus:border-label-quaternary rounded px-2 py-1 text-xs text-label outline-none"
              />
              <TagStyleControls ts={subSlot.style} onChange={ts => onSubChange({ ...subSlot, style: ts })} />
            </div>
          )}
          {subSlot?.type === 'swipe' && onSubChange && (
            <div className="flex flex-col gap-2 pt-2 border-t border-separator">
              <div className="flex items-center justify-between">
                <span className="text-micro font-semibold text-label-tertiary  ">Box Swipe</span>
                <button onClick={() => onSubChange(null)} className="text-micro text-label-quaternary hover:text-danger transition-colors">Remove</button>
              </div>
              <TemplateEditorSwipePreviewMini style={subSlot.style} />
              <SwipeStyleControls style={subSlot.style} onChange={s => onSubChange({ ...subSlot, style: s })} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── LayersPanel ──────────────────────────────────────────────────────────────

const LAYER_META: Record<LayerId, { label: string; icon: ReactNode }> = {
  background: {
    label: 'BG Blur',
    icon: (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2"/>
        <circle cx="8.5" cy="8.5" r="1.5"/>
        <path d="M21 15l-5-5L5 21"/>
      </svg>
    ),
  },
  circle: {
    label: 'Circle 1',
    icon: (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <circle cx="12" cy="12" r="9"/>
        <text x="12" y="16" textAnchor="middle" fontSize="8" fontWeight="700" fill="currentColor" stroke="none">1</text>
      </svg>
    ),
  },
  circle2: {
    label: 'Circle 2',
    icon: (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <circle cx="12" cy="12" r="9"/>
        <text x="12" y="16" textAnchor="middle" fontSize="8" fontWeight="700" fill="currentColor" stroke="none">2</text>
      </svg>
    ),
  },
  subject: {
    label: 'Subject',
    icon: (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
        <circle cx="12" cy="7" r="4"/>
      </svg>
    ),
  },
};

const LAYER_COLORS: Record<LayerId, string> = {
  background: '#3b82f6',
  circle:     '#a855f7',
  circle2:    '#c084fc',
  subject:    '#22c55e',
};

export function LayersPanel({ layers, onChange }: {
  layers: LayerId[];
  onChange: (layers: LayerId[]) => void;
}) {
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);

  // Display reversed: top of list = visually on top (last drawn)
  const displayOrder = [...layers].reverse();

  return (
    <div
      onMouseDown={e => e.stopPropagation()}
      style={{
        position: 'absolute',
        right: '100%',
        top: 0,
        marginRight: 24,
        width: 'max-content',
        background: 'var(--c-bg-1)',
        border: '1px solid var(--c-sep)',
        borderRadius: 8,
        padding: '8px 6px',
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
        zIndex: 20,
        backdropFilter: 'blur(8px)',
      }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--c-label-3)', textAlign: 'center', paddingBottom: 5, borderBottom: '1px solid var(--c-sep-subtle)', marginBottom: 2 }}>
        Layers
      </div>
      {displayOrder.map((layer) => {
        const realIdx  = layers.indexOf(layer);
        const isDragging = dragIdx === realIdx;
        const isOver   = overIdx === realIdx;
        return (
          <div
            key={layer}
            draggable
            onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; setDragIdx(realIdx); }}
            onDragOver={e => { e.preventDefault(); setOverIdx(realIdx); }}
            onDrop={e => {
              e.preventDefault();
              if (dragIdx === null || dragIdx === realIdx) { setDragIdx(null); setOverIdx(null); return; }
              const next = [...layers];
              const [removed] = next.splice(dragIdx, 1);
              next.splice(realIdx, 0, removed);
              onChange(next);
              setDragIdx(null); setOverIdx(null);
            }}
            onDragEnd={() => { setDragIdx(null); setOverIdx(null); }}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              height: 36,
              padding: '0 8px',
              borderRadius: 6,
              border: `1px solid ${isOver ? 'var(--c-sep)' : 'var(--c-sep-subtle)'}`,
              background: isOver ? 'var(--c-bg-2)' : isDragging ? 'var(--c-bg-2)' : 'transparent',
              cursor: 'grab',
              userSelect: 'none',
              opacity: isDragging ? 0.4 : 1,
              transition: 'background 0.1s, border-color 0.1s, opacity 0.1s',
            }}
          >
            {/* Grip dots */}
            <svg width="7" height="11" viewBox="0 0 7 11" fill="var(--c-label-4)" style={{ flexShrink: 0 }}>
              <circle cx="1.5" cy="1.5" r="1.2"/><circle cx="5.5" cy="1.5" r="1.2"/>
              <circle cx="1.5" cy="5.5" r="1.2"/><circle cx="5.5" cy="5.5" r="1.2"/>
              <circle cx="1.5" cy="9.5" r="1.2"/><circle cx="5.5" cy="9.5" r="1.2"/>
            </svg>
            {/* Icon + label inline */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flex: 1 }}>
              <div style={{ color: 'var(--c-label-2)', flexShrink: 0 }}>
                {LAYER_META[layer].icon}
              </div>
              <span style={{ fontSize: 11, color: 'var(--c-label-2)', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {LAYER_META[layer].label}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── SwipeZoneEditor ──────────────────────────────────────────────────────────

const SWIPE_ARROW_TYPES: { value: SwipeArrowType; label: string }[] = [
  { value: 'line',          label: 'Line' },
  { value: 'triangle',      label: 'Triangle' },
  { value: 'chevron',       label: 'Chevron' },
  { value: 'double-chevron',label: '>>' },
  { value: 'curved',        label: 'Curved' },
];

const SWIPE_LAYOUTS: { value: SwipeLayout; label: string }[] = [
  { value: 'text-arrow', label: 'Text → Arrow' },
  { value: 'arrow-text', label: 'Arrow ← Text' },
  { value: 'stacked',    label: 'Stacked' },
  { value: 'arrow-only', label: 'Arrow only' },
  { value: 'text-only',  label: 'Text only' },
];

const ZONE_LABELS_9 = [
  'Top-L','Top-C','Top-R',
  'Mid-L','Mid-C','Mid-R',
  'Bot-L','Bot-C','Bot-R',
];

function SwipeStyleControls({ style, onChange }: { style: SwipeStyle; onChange: (s: SwipeStyle) => void }) {
  function upd(patch: Partial<SwipeStyle>) { onChange({ ...style, ...patch }); }
  return (
    <div className="flex flex-col gap-2 pt-1">
      <div className="flex flex-col gap-1">
        <ControlLabel>Text</ControlLabel>
        <input type="text" value={style.text} onChange={e => upd({ text: e.target.value })}
          className="w-full bg-surface border border-separator text-label text-xs rounded px-2 py-1 outline-none focus:border-label-quaternary" />
      </div>
      <ToggleSwitch label="All caps" checked={style.allCaps} onChange={v => upd({ allCaps: v })} />
      <div className="flex flex-col gap-1.5">
        <ControlLabel>Font</ControlLabel>
        <FontDropdown value={style.fontLabel} onChange={v => upd({ fontLabel: v })} />
      </div>
      <div className="flex flex-col gap-1.5">
        <ControlLabel>Weight</ControlLabel>
        <WeightPicker fontLabel={style.fontLabel} value={style.fontWeight} onChange={w => upd({ fontWeight: w })} className="flex gap-1 flex-wrap" />
      </div>
      <Slider label="Font Size" value={style.fontSize} min={8} max={80} unit="px" onChange={v => upd({ fontSize: v })} />
      <Slider label="Letter Spacing" value={style.letterSpacing} min={0} max={20} unit="px" onChange={v => upd({ letterSpacing: v })} />
      <ColourSwatch label="Text colour" value={style.textColor} onChange={c => upd({ textColor: c })} />
      <SegmentedControl<SwipeArrowType>
        label="Arrow type"
        value={style.arrowType}
        columns={3}
        options={SWIPE_ARROW_TYPES.map(at => ({ value: at.value, label: at.label }))}
        onChange={v => upd({ arrowType: v })}
      />
      {style.arrowType !== 'chevron' && style.arrowType !== 'double-chevron' && (
        <Slider label="Arrow Length" value={style.arrowLength} min={0} max={200} unit="px" onChange={v => upd({ arrowLength: v })} />
      )}
      <ColourSwatch label="Arrow colour" value={style.arrowColor} onChange={c => upd({ arrowColor: c })} />
      <Slider label="Arrow Weight" value={style.arrowWeight} min={0.5} max={10} unit="px" onChange={v => upd({ arrowWeight: v })} />
      <Slider label="Head Size" value={style.arrowHeadSize} min={2} max={40} unit="px" onChange={v => upd({ arrowHeadSize: v })} />
      <SegmentedControl<SwipeDirection>
        label="Direction"
        value={style.direction}
        options={[
          { value: 'left', label: '← Left' },
          { value: 'right', label: 'Right →' },
        ]}
        onChange={v => upd({ direction: v })}
      />
      <SegmentedControl<SwipeLayout>
        label="Layout"
        value={style.layout}
        columns={2}
        options={SWIPE_LAYOUTS.map(l => ({ value: l.value, label: l.label }))}
        onChange={v => upd({ layout: v })}
      />
      <Slider label="Gap" value={style.gap} min={0} max={60} unit="px" onChange={v => upd({ gap: v })} />
      <Slider label="Opacity" value={style.opacity} min={0} max={100} onChange={v => upd({ opacity: v })} />
      <ShadowEditor value={style.shadow} onChange={v => upd({ shadow: v })} />
    </div>
  );
}

function SwipeZoneEditor({
  fi, style, onChange, onRemove,
}: {
  fi: number;
  style: SwipeStyle;
  onChange: (s: SwipeStyle) => void;
  onRemove: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="flex flex-col gap-1.5 rounded-lg bg-surface border border-separator p-2">
      <div className="flex items-center gap-1.5">
        <span className="text-micro text-label-tertiary shrink-0 w-12">{ZONE_LABELS_9[fi] ?? `#${fi}`}</span>
        <div className="flex-1 min-w-0" style={{ overflow: 'visible' }}>
          <TemplateEditorSwipePreviewMini style={style} />
        </div>
        <button
          onClick={() => setExpanded(e => !e)}
          className="shrink-0 w-5 h-5 flex items-center justify-center rounded text-label-tertiary hover:text-label-secondary hover:bg-surface-2 transition-colors"
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            {expanded ? <polyline points="18 15 12 9 6 15"/> : <polyline points="6 9 12 15 18 9"/>}
          </svg>
        </button>
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove"
          className="shrink-0 w-6 h-6 flex items-center justify-center rounded text-label-quaternary hover:text-danger hover:bg-surface-2 transition-colors"
        >
          <svg width="8" height="8" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M1 1l10 10M11 1L1 11"/>
          </svg>
        </button>
      </div>
      {expanded && <SwipeStyleControls style={style} onChange={onChange} />}
    </div>
  );
}

// ── TemplateEditorSettingsPanel (right column) ─────────────────────────────────────

// Body-only editor — the section header/expansion is provided by the wrapping CollapsibleSection
// (selection-driven), so this matches the image element sections exactly.
function TextBoxEditor({ tb, onChange, onRemove, rich, enforceLocks = false }: {
  tb: TextBoxStyle;
  onChange: (next: TextBoxStyle) => void;
  onRemove: () => void;
  rich?: TextBoxRichTextControls;
  enforceLocks?: boolean;   // posts mode: grey out controls whose property is in tb.lockedProps
}) {
  const upd = (patch: Partial<TextBoxStyle>) => onChange({ ...tb, ...patch });

  // Posts mode: is this property frozen by the template? (Template editor: never.)
  const lockedHere = (p: keyof TextBoxStyle) => enforceLocks && isPropLocked(tb, p);
  const geomLocked = enforceLocks && hasGeometryLock(tb);
  // Posts + FULL lock: the card keeps only the text-editing surface (textarea / placeholder words /
  // rich spans) — every style/geometry control and Remove are dropped. Template mode: never.
  const fullLocked = enforceLocks && elementLockState(tb.lockedProps, TEXT_LOCK_PRESET) === 'full';
  // Region visibility under a PARTIAL posts lock (template mode: all true). Locked controls hide
  // outright, so rows/dividers whose every control vanished must be dropped too — no empty shells.
  const styleVis = !lockedHere('color') || (!tb.fitToWidth && !lockedHere('fontSize')) || !lockedHere('letterSpacing') || !lockedHere('lineHeight') || (!tb.fitToWidth && !lockedHere('singleLine')) || !lockedHere('opacity');
  const alignSegVis = !(lockedHere('align') || lockedHere('fitToWidth'));
  const alignRowVis = alignSegVis || !lockedHere('italic') || !lockedHere('allCaps');
  const fontVis = !lockedHere('fontLabel');
  const weightsVis = !lockedHere('fontWeight') || !lockedHere('secondaryWeight') || alignRowVis || !lockedHere('vAlign');
  const advancedVis = fontVis || weightsVis;
  const geomRegionVis = !lockedHere('x') || !lockedHere('y') || !lockedHere('width') || !lockedHere('height') || !geomLocked;

  // Weights the box's font actually ships (a static custom family only renders its uploaded weights;
  // built-ins use the standard set). A variable font exposes the whole range.
  const customFams = useCustomFonts();
  const famWeights: number[] = (() => {
    const fam = customFams.find(f => f.label === tb.fontLabel);
    return fam && fam.weights.length ? fam.weights : CAROUSEL_WEIGHTS.map(w => w.value);
  })();
  // Default secondary (highlight) weight: a REAL available weight that contrasts with the primary, so the
  // canvas can actually render it differently (a hardcoded 400/700 may not exist in a static family).
  const pickSecondaryWeight = (): number => {
    const diff = (w: number) => Math.abs(w - tb.fontWeight);
    const prefer = tb.fontWeight >= 600 ? [400, 300, 500, 600] : [700, 800, 900, 600];
    for (const w of prefer) if (famWeights.includes(w) && w !== tb.fontWeight) return w;
    const others = famWeights.filter(w => w !== tb.fontWeight);
    return others.length ? others.reduce((b, w) => (diff(w) > diff(b) ? w : b), others[0]) : tb.fontWeight;
  };
  return (
    <>
          {/* Placeholder: insert a chosen number of lorem words; turns off the moment you type your own text */}
          <ToggleSwitch
            label="Fill with placeholder"
            checked={!!tb.fillPlaceholder}
            // Turning it off clears the placeholder text so the box is empty for your own content
            // (the filler lives in `text`/`spans`, so we must wipe it, not just stop regenerating).
            onChange={() => upd(tb.fillPlaceholder ? { fillPlaceholder: false, text: '', spans: undefined } : { fillPlaceholder: true })}
            title="Insert lorem-ipsum placeholder words"
          />
          {tb.fillPlaceholder ? (
            <div className="flex items-center justify-between">
              <ControlLabel>Words</ControlLabel>
              <Stepper
                value={tb.placeholderWords ?? 8}
                min={1} max={200} step={1}
                onCommit={n => upd({ placeholderWords: Math.max(1, Math.min(200, Math.round(n) || 1)) })}
              />
            </div>
          ) : (
            <>
              <textarea
                value={tb.text}
                // A box with per-run styling (e.g. secondary-weight highlight) renders from `spans`, which
                // would otherwise override edits made here. Re-map the spans onto the new text so editing
                // keeps the highlights on the words you didn't touch (only the edited part goes plain).
                // Single-line boxes: newlines flatten to spaces and edits that would overflow the box
                // width at the fixed font size are refused (same hard limit as the canvas editor).
                onChange={e => {
                  let text = e.target.value;
                  if (tb.singleLine && !tb.fitToWidth) {
                    text = text.replace(/\n/g, ' ');
                    const spans = tb.spans && tb.spans.length ? remapSpans(tb.spans, text) : undefined;
                    if (!singleLineTextFits(tb, text, spans)) return;   // refuse the edit
                    // Always write the spans key: when the remap yields undefined (e.g. the
                    // text was cleared) stale spans must be removed, or they keep rendering.
                    upd({ text, spans });
                    return;
                  }
                  upd(tb.spans && tb.spans.length ? { text, spans: remapSpans(tb.spans, text) } : { text });
                }}
                placeholder={tb.singleLine ? 'Text… (single line)' : 'Text… (Enter for a new line)'}
                rows={tb.singleLine ? 1 : 2}
                className="w-full bg-surface border border-separator focus:border-label-quaternary rounded px-2 py-1 text-xs text-label outline-none resize-none leading-relaxed"
              />
              {/* Per-run styling — shown while this box is being inline-edited; applies to the selected text */}
              {rich && (
                // mousedown-preventDefault keeps the canvas editor's selection alive when clicking in here
                <div onMouseDown={e => e.preventDefault()}
                  className="flex flex-col gap-1.5 rounded-md bg-surface-1 border border-separator p-2">
                  <div className="flex items-center justify-between">
                    <span className="text-micro font-semibold text-tint  ">Selected text</span>
                    {!rich.hasSelection && <span className="text-micro text-label-tertiary">select part of the text first</span>}
                  </div>
                  <div className="flex items-center gap-1 flex-wrap transition-opacity"
                    style={{ opacity: rich.hasSelection ? 1 : 0.4, pointerEvents: rich.hasSelection ? 'auto' : 'none' }}>
                    {([['Reg', 400], ['Med', 500], ['Semi', 600], ['Bold', 700]] as const).map(([label, w]) => (
                      <button key={w} onClick={() => rich.setWeight(w)} title={`Weight ${w}`}
                        className="h-8 px-2 rounded-md text-micro bg-surface border border-separator text-label-secondary hover:text-label hover:border-label-quaternary transition-colors"
                        style={{ fontWeight: w }}>{label}</button>
                    ))}
                    <button onClick={() => rich.toggleItalic()} title="Italic"
                      className="h-8 px-2.5 rounded-md text-micro italic bg-surface border border-separator text-label-secondary hover:text-label hover:border-label-quaternary transition-colors">I</button>
                    <button onClick={() => rich.toggleSecondary()} title="Toggle secondary style on the selected words (uses the box's secondary weight)"
                      className="h-8 px-2.5 rounded-md text-micro font-semibold bg-surface border border-separator text-label-secondary hover:text-label hover:border-label-quaternary transition-colors">2nd</button>
                  </div>
                  <div className="flex items-center gap-1 flex-wrap transition-opacity"
                    style={{ opacity: rich.hasSelection ? 1 : 0.4, pointerEvents: rich.hasSelection ? 'auto' : 'none' }}>
                    {RICH_COLORS.map(c => (
                      <button key={c} onClick={() => rich.setColor(c)} title={c}
                        className="w-5 h-5 rounded-full border border-white/20 hover:scale-110 transition-transform"
                        style={{ background: c }} />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
          {!fullLocked && <>
          {/* Position / Size — a locked axis hides its stepper; a row with no steppers left disappears */}
          {(() => {
            const fields: { tag: string; node: ReactNode }[] = [];
            if (!lockedHere('x')) fields.push({ tag: 'X', node: <Stepper value={Math.round(tb.x)} min={0} max={CAROUSEL_W} ariaLabel="X position" onCommit={n => upd({ x: Math.max(0, Math.min(CAROUSEL_W, Math.round(n) || 0)) })} /> });
            if (!lockedHere('y')) fields.push({ tag: 'Y', node: <Stepper value={Math.round(tb.y)} min={0} max={CAROUSEL_H} unit="px" ariaLabel="Y position" onCommit={n => upd({ y: Math.max(0, Math.min(CAROUSEL_H, Math.round(n) || 0)) })} /> });
            return fields.length ? <DimRow label="Position" fields={fields} /> : null;
          })()}
          {(() => {
            const fields: { tag: string; node: ReactNode }[] = [];
            if (!lockedHere('width')) fields.push({ tag: 'W', node: <Stepper value={Math.round(tb.width ?? 540)} min={20} max={CAROUSEL_W} ariaLabel="Width" onCommit={n => upd({ width: Math.max(20, Math.min(CAROUSEL_W, Math.round(n) || 0)) })} /> });
            if (!lockedHere('height')) fields.push({
              tag: 'H',
              node: tb.fitToWidth
                ? <Stepper value={Math.round(tb.height ?? 200)} disabled unit="auto" ariaLabel="Height" title="Auto — in fit-to-width the height hugs the text (set the width instead)" onCommit={() => {}} />
                : <Stepper value={Math.round(tb.height ?? 200)} min={20} max={CAROUSEL_H} unit="px" ariaLabel="Height" onCommit={n => upd({ height: Math.max(20, Math.min(CAROUSEL_H, Math.round(n) || 0)) })} />,
            });
            return fields.length ? <DimRow label="Size" fields={fields} /> : null;
          })()}
          {/* Snap grid · nudge pad · centre — all rewrite x/y, so a geometry lock hides the cluster */}
          {(() => {
            if (geomLocked) return null;
            const bw   = tb.width  ?? 540;
            const bh   = tb.height ?? 200;
            const EDGE = 60;
            const snapTo = (col: number, row: number) => {
              const align:  'left' | 'center' | 'right'  = col === 0 ? 'left' : col === 1 ? 'center' : 'right';
              const vAlign: 'top'  | 'middle' | 'bottom' = row === 0 ? 'top'  : row === 1 ? 'middle' : 'bottom';
              const x = col === 0 ? EDGE : col === 1 ? Math.round((CAROUSEL_W - bw) / 2) : CAROUSEL_W - EDGE - bw;
              const y = row === 0 ? EDGE : row === 1 ? Math.round((CAROUSEL_H - bh) / 2) : CAROUSEL_H - EDGE - bh;
              upd({ align, vAlign, x: Math.max(0, x), y: Math.max(0, y) });
            };
            const nudge = (dx: number, dy: number) => upd({
              x: Math.max(0, Math.min(CAROUSEL_W, tb.x + dx)),
              y: Math.max(0, Math.min(CAROUSEL_H, tb.y + dy)),
            });
            const nudgeBtn = "flex items-center justify-center w-6 h-6 rounded bg-surface-1 border border-separator text-label-tertiary hover:text-label hover:border-label-quaternary transition-colors text-micro leading-none";
            const ctrBtn   = "px-2 h-6 rounded bg-surface-1 border border-separator text-micro text-label-tertiary hover:text-label hover:border-label-quaternary transition-colors";
            return (
              <div className="flex items-start gap-3 pt-0.5">
                <div className="flex flex-col gap-1">
                  <span className="text-micro text-label-tertiary">Snap</span>
                  <div className="grid grid-cols-3 gap-0.5" style={{ width: 54 }}>
                    {[0, 1, 2].map(row => [0, 1, 2].map(col => (
                      <button key={`${row}-${col}`} title="Snap to this region" onClick={() => snapTo(col, row)}
                        className="h-4 w-full rounded-sm bg-surface-2 hover:bg-tint transition-colors" />
                    )))}
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-micro text-label-tertiary">Nudge</span>
                  <div className="flex flex-col items-center gap-0.5">
                    <button className={nudgeBtn} title="Up (1px)" onClick={() => nudge(0, -1)}>↑</button>
                    <div className="flex gap-0.5">
                      <button className={nudgeBtn} title="Left (1px)"  onClick={() => nudge(-1, 0)}>←</button>
                      <button className={nudgeBtn} title="Down (1px)"  onClick={() => nudge(0, 1)}>↓</button>
                      <button className={nudgeBtn} title="Right (1px)" onClick={() => nudge(1, 0)}>→</button>
                    </div>
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-micro text-label-tertiary">Centre</span>
                  <div className="flex flex-col gap-0.5">
                    <button className={ctrBtn} title="Centre horizontally" onClick={() => upd({ align: 'center', x: Math.max(0, Math.round((CAROUSEL_W - bw) / 2)) })}>H</button>
                    <button className={ctrBtn} title="Centre vertically"   onClick={() => upd({ vAlign: 'middle', y: Math.max(0, Math.round((CAROUSEL_H - bh) / 2)) })}>V</button>
                  </div>
                </div>
              </div>
            );
          })()}
          {geomRegionVis && <div className="h-px bg-separator-subtle" aria-hidden="true" />}
          <LockWrap locked={lockedHere('color')}><ColourSwatch label="Colour" value={tb.color} onChange={c => upd({ color: c })} /></LockWrap>
          {/* Font size is automatic in fit-to-width mode (each line is scaled to fill the box) */}
          {!tb.fitToWidth && <LockWrap locked={lockedHere('fontSize')}><Slider label="Font size" value={tb.fontSize} min={8} max={200} unit="px" onChange={v => upd({ fontSize: v })} /></LockWrap>}
          <LockWrap locked={lockedHere('letterSpacing')}><Slider label="Letter spacing" value={tb.letterSpacing} min={0} max={20}  unit="px" onChange={v => upd({ letterSpacing: v })} /></LockWrap>
          <LockWrap locked={lockedHere('lineHeight')}><Slider label="Line spacing"   value={tb.lineHeight}    min={-50} max={100}          onChange={v => upd({ lineHeight: v })} /></LockWrap>
          {/* Hard one-line mode: never wraps, Enter is ignored, and typing that would overflow the box
              width is refused (font size stays fixed). Hidden in fit-to-width, which wins over it. */}
          {!tb.fitToWidth && (
            <LockWrap locked={lockedHere('singleLine')}>
              <ToggleSwitch
                label="Single line"
                checked={!!tb.singleLine}
                onChange={v => upd({ singleLine: v })}
                title="Hard limit: the text stays on one line — typing that would overflow the box width is refused"
              />
            </LockWrap>
          )}
          <LockWrap locked={lockedHere('opacity')}><Slider label="Opacity"        value={tb.opacity}       min={0} max={100}           onChange={v => upd({ opacity: v })} /></LockWrap>
          {/* Font, weights, alignment & vertical align tucked under a disclosure (like the image
              editor's Advanced) so the common controls above lead. Hidden entirely in posts once
              every control inside it is locked. */}
          {advancedVis && (
          <Disclosure title="Advanced">
          <LockWrap locked={lockedHere('fontLabel')}>
          <div className="flex flex-col gap-1.5">
            <ControlLabel>Font</ControlLabel>
            <FontDropdown value={tb.fontLabel} onChange={v => upd({ fontLabel: v })} />
          </div>
          </LockWrap>
          {fontVis && weightsVis && <div className="h-px bg-separator-subtle" aria-hidden="true" />}
          {/* Primary + optional secondary weight (same family). Secondary is used to highlight — the
              placeholder filler alternates primary/secondary weight word-by-word to preview it. */}
          <LockWrap locked={lockedHere('fontWeight')}>
          <div className="flex flex-col gap-1">
            <ControlLabel>Primary style</ControlLabel>
            <WeightPicker fontLabel={tb.fontLabel} value={tb.fontWeight} onChange={w => upd({ fontWeight: w })} className="flex gap-1 flex-wrap" />
          </div>
          </LockWrap>
          <LockWrap locked={lockedHere('secondaryWeight')}>
          <div className="flex flex-col gap-1">
            <ToggleSwitch
              label={<>Secondary style <span className="text-label-quaternary">· highlight</span></>}
              checked={tb.secondaryWeight != null}
              onChange={() => upd({ secondaryWeight: tb.secondaryWeight == null ? (pickSecondaryWeight() as CarouselFontWeight) : undefined })}
              title="A second weight for highlighting; the placeholder alternates primary/secondary per word"
            />
            {tb.secondaryWeight != null && (
              <WeightPicker fontLabel={tb.fontLabel} value={tb.secondaryWeight} onChange={w => upd({ secondaryWeight: w })} className="flex gap-1 flex-wrap" />
            )}
          </div>
          </LockWrap>
          {/* Alignment + fit-to-width are an exclusive mode group; italic / all-caps are binary.
              One segmented control drives BOTH `align` and `fitToWidth`, so a lock on either hides it.
              The row itself disappears once all three controls are locked. */}
          {alignRowVis && (
          <div className="flex items-end gap-1.5">
            {alignSegVis && (
            <div className="flex-1">
              <SegmentedControl<string>
                label="Alignment"
                value={tb.fitToWidth ? '__fit' : tb.align}
                options={[
                  ...ALIGN_ICONS.map(({ value, icon }) => ({ value, icon, title: value })),
                  {
                    value: '__fit',
                    title: 'Fit each line to the box width',
                    icon: (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="3" y1="4" x2="3" y2="20"/><line x1="21" y1="4" x2="21" y2="20"/>
                        <line x1="7" y1="12" x2="17" y2="12"/><polyline points="9 9 6 12 9 15"/><polyline points="15 9 18 12 15 15"/>
                      </svg>
                    ),
                  },
                ]}
                onChange={v => v === '__fit' ? upd({ fitToWidth: true }) : upd({ align: v as CarouselTextAlign, fitToWidth: false })}
              />
            </div>
            )}
            <LockWrap locked={lockedHere('italic')}><ToggleButton active={!!tb.italic} onClick={() => upd({ italic: !tb.italic })} label="Italic"><span className="italic">I</span></ToggleButton></LockWrap>
            <LockWrap locked={lockedHere('allCaps')}><ToggleButton active={!!tb.allCaps} onClick={() => upd({ allCaps: !tb.allCaps })} label="All caps"><span className="font-bold">AA</span></ToggleButton></LockWrap>
          </div>
          )}
          <LockWrap locked={lockedHere('vAlign')}>
          <SegmentedControl<'top' | 'middle' | 'bottom'>
            label="Vertical align"
            value={tb.vAlign ?? 'top'}
            options={[
              { value: 'top', label: 'Top' },
              { value: 'middle', label: 'Middle' },
              { value: 'bottom', label: 'Bottom' },
            ]}
            onChange={v => upd({ vAlign: v })}
          />
          </LockWrap>
          </Disclosure>
          )}
          {(styleVis || advancedVis) && <div className="h-px bg-separator-subtle" aria-hidden="true" />}
          <LockWrap locked={lockedHere('shadow')}><ShadowEditor value={tb.shadow} onChange={v => upd({ shadow: v })} showLift={false} /></LockWrap>
          <button
            type="button"
            onClick={onRemove}
            className="mt-1 w-full h-8 rounded-md text-micro text-danger bg-surface border border-separator hover:border-danger hover:text-danger transition-colors"
          >Remove text</button>
          </>}
    </>
  );
}

interface SectionDrag {
  onGripPointerDown: (e: React.PointerEvent) => void;   // pointer-based drag; the grip is the handle
  isDragging?: boolean;
}

// A rounded settings card with an expand/collapse chevron and a CSS-grid 1fr/0fr height animation.
// Shared with the companion app so the fused layer list and the structural sections share ONE look:
// optional grip + uppercase title + optional eye/lock icons + chevron. Controlled via open+onToggle
// (selection-driven layer rows), or uncontrolled via defaultOpen + internal state (global sections).
function CollapsibleSection({
  title, children, defaultOpen, open: openProp, onToggle, grip, leftIcons, drag, rowRef, dimmed, noToggle, onRename,
}: {
  title: string; children?: ReactNode; defaultOpen?: boolean; open?: boolean;
  onToggle?: (next: boolean) => void;   // controlled open: header click reports the desired state
  grip?: boolean;                        // show a 6-dot drag handle in the header (draggable layer row)
  leftIcons?: ReactNode;                 // header controls (show/hide, lock) left of the chevron
  drag?: SectionDrag;                    // drag-to-reorder wiring; the grip is the handle, the card the drop target
  rowRef?: (el: HTMLDivElement | null) => void;   // the whole row — measured for FLIP reflow
  dimmed?: boolean;                      // layer is hidden → fade the card to match its eye state
  noToggle?: boolean;                    // static row: no chevron, no content (e.g. the Fade band)
  onRename?: (value: string) => void;    // double-click the title → inline rename; receives the trimmed value ('' = clear)
}) {
  const [openState, setOpenState] = useState(defaultOpen ?? false);
  const isControlled = openProp !== undefined;
  const open = isControlled ? openProp : openState;
  // A consumer driving the section via onToggle (canvas-selection binding) gets the desired state on
  // header click; otherwise flip the internal state.
  const handleToggle = onToggle ? () => onToggle(!open) : () => setOpenState(o => !o);
  // ── Inline rename (double-click the title) — same commit semantics as the template/slide rename
  // pattern: Enter/blur commit, Escape cancels, unchanged value writes nothing. On renamable cards
  // the single-click accordion toggle is deferred just long enough to spot a double-click, so
  // entering rename never toggles the card (the chevron still toggles instantly).
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);
  const clickTimer = useRef<number | null>(null);
  useEffect(() => () => { if (clickTimer.current !== null) window.clearTimeout(clickTimer.current); }, []);
  useEffect(() => {
    if (renaming) { renameInputRef.current?.focus(); renameInputRef.current?.select(); }
  }, [renaming]);
  const commitRename = () => {
    setRenaming(false);
    const v = draft.trim();
    if (v !== title) onRename?.(v);   // unchanged → no write; '' clears the custom name (falls back to the derived title)
  };
  const handleTitleClick = () => {
    if (!onRename) { handleToggle(); return; }
    if (clickTimer.current !== null) {
      // Second click of a double-click: cancel the pending toggle and swap the title for the input.
      window.clearTimeout(clickTimer.current);
      clickTimer.current = null;
      setDraft(title);
      setRenaming(true);
    } else {
      clickTimer.current = window.setTimeout(() => { clickTimer.current = null; handleToggle(); }, 250);
    }
  };
  return (
    <div ref={rowRef} className="relative">
      {drag?.isDragging ? (
        /* Placeholder underneath the lifted card — an empty card spanning the full row. */
        <div className="w-full h-8 rounded-lg border border-separator bg-surface" />
      ) : (
        <div className={`min-w-0 rounded-lg bg-surface border border-separator transition-opacity duration-150 ${dimmed ? 'opacity-45' : ''}`}>
          <div className="w-full flex items-center gap-1 pl-2 pr-2 py-2">
            {grip && (
              <span
                onPointerDown={drag?.onGripPointerDown}
                title="Drag to reorder"
                style={{ touchAction: 'none' }}
                className="shrink-0 flex items-center cursor-grab active:cursor-grabbing text-label-quaternary hover:text-label-tertiary transition-colors"
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <circle cx="9" cy="5" r="1" fill="currentColor" /><circle cx="15" cy="5" r="1" fill="currentColor" />
                  <circle cx="9" cy="12" r="1" fill="currentColor" /><circle cx="15" cy="12" r="1" fill="currentColor" />
                  <circle cx="9" cy="19" r="1" fill="currentColor" /><circle cx="15" cy="19" r="1" fill="currentColor" />
                </svg>
              </span>
            )}
            {noToggle ? (
              // Static row (e.g. the Fade band): a plain, non-clickable title — no chevron, no content.
              <span className="flex-1 min-w-0 flex items-center text-[11px] font-semibold text-label-tertiary uppercase tracking-wider truncate">{title}</span>
            ) : renaming ? (
              // Inline rename input — same footprint as the title (negative block margin absorbs the
              // input chrome so the card doesn't grow). Enter commits, Escape cancels, blur commits.
              <input
                ref={renameInputRef}
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onBlur={commitRename}
                onClick={e => e.stopPropagation()}
                onPointerDown={e => e.stopPropagation()}
                onKeyDown={e => {
                  if (e.key === 'Enter')  { e.preventDefault(); commitRename(); }
                  if (e.key === 'Escape') { e.preventDefault(); setRenaming(false); }
                }}
                aria-label="Layer name"
                className="flex-1 min-w-0 h-5 -my-0.5 px-1 rounded bg-surface border border-tint text-[11px] font-semibold tracking-wider text-label outline-none"
              />
            ) : (
              <button
                type="button"
                onClick={handleTitleClick}
                aria-expanded={open}
                title={onRename ? 'Double-click to rename' : undefined}
                className="flex-1 min-w-0 flex items-center text-left rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              >
                <span className="text-[11px] font-semibold text-label-tertiary uppercase tracking-wider truncate">{title}</span>
              </button>
            )}
            {/* Show/hide + lock — left of the chevron, inside the section header */}
            {leftIcons}
            {!noToggle && (
              <button
                type="button"
                onClick={handleToggle}
                tabIndex={-1}
                aria-hidden="true"
                className="shrink-0 flex items-center justify-center size-4 rounded text-label-tertiary hover:text-label transition-colors"
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform duration-150 ${open ? 'rotate-180' : ''}`} aria-hidden="true">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
            )}
          </div>
          {!noToggle && (
            <div style={{ display: 'grid', gridTemplateRows: open ? '1fr' : '0fr', transition: 'grid-template-rows 220ms ease' }}>
              <div style={{ overflow: 'hidden' }}>
                <div className="px-3 pb-3 flex flex-col gap-2.5">{children}</div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Show/hide (eye) toggle — a plain icon button living inside the section header, left of the chevron.
function LayerEye({ hidden, onToggle }: { hidden: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      title={hidden ? 'Show layer' : 'Hide layer'}
      aria-label={hidden ? 'Show layer' : 'Hide layer'}
      aria-pressed={!hidden}
      className="shrink-0 flex items-center justify-center size-4 rounded text-label-tertiary hover:text-label transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {hidden ? (
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
    </button>
  );
}

// ── Per-layer lock toggles (template mode writes, posts mode indicates) ──────
// FULL-lock presets: the exact property set the header padlock writes. Anything else
// (a hand-picked subset via the CLI `lock`) shows as PARTIAL.
// Slide-level lock groups (names in CarouselSettings.lockedSettings). Each header padlock
// owns ONLY its group's names — other names in the array are preserved on toggle.
// fadeRemoved is in the group deliberately: deleting the layer is a stronger
// 'off' than showFade:false, so a locked fade must be undeletable too.
const FADE_LOCK_GROUP: readonly string[] = ['showFade', 'fadeIntensity', 'fadeFloor', 'fadeReach', 'showTopFade', 'topFadeIntensity', 'topFadeFloor', 'topFadeReach', 'fadeRemoved'];
const CANVAS_LOCK_GROUP: readonly string[] = ['canvasColor', 'canvasTransparent'];

type LockState = 'none' | 'partial' | 'full';

// Element cards: ANY lockedProps entry means the box is locked; FULL once the whole preset is covered.
function elementLockState(lockedProps: readonly string[] | undefined, preset: readonly string[]): LockState {
  if (!lockedProps?.length) return 'none';
  return preset.every(p => lockedProps.includes(p)) ? 'full' : 'partial';
}

// Slide-level cards: judge only this group's names inside the shared lockedSettings array.
function groupLockState(lockedSettings: readonly string[] | undefined, group: readonly string[]): LockState {
  const n = group.filter(name => lockedSettings?.includes(name)).length;
  return n === 0 ? 'none' : n === group.length ? 'full' : 'partial';
}

// Padlock icon-button in a layer-card header, right of the eye. Template mode: cycles
// unlocked → FULL preset → cleared (partial upgrades to FULL). Posts mode (readOnly):
// pure indicator — no pointer events, hidden entirely while unlocked so posts can
// never unlock what the template locked.
function LayerLock({ state, readOnly, unlockedTitle, onClick }: {
  state: LockState;
  readOnly: boolean;          // posts mode: indicator only
  unlockedTitle: string;      // tooltip while unlocked (what locking will do)
  onClick: () => void;
}) {
  if (readOnly && state === 'none') return null;
  const title = readOnly
    ? (state === 'partial' ? 'Partially locked by the template' : 'Locked by the template')
    : state === 'full' ? 'Unlock'
    : state === 'partial' ? 'Partially locked (via CLI)'
    : unlockedTitle;
  // Glyph: open lock (unlocked) vs closed lock (locked); FULL fills the body in accent,
  // PARTIAL is the same closed lock at half opacity.
  const glyph = (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="11" width="18" height="11" rx="2" fill={state === 'none' ? 'none' : 'currentColor'} />
      {state === 'none'
        ? <path d="M7 11V7a5 5 0 0 1 9.9-1" />   /* open shackle */
        : <path d="M7 11V7a5 5 0 0 1 10 0v4" />}
    </svg>
  );
  const tone = state === 'full' ? 'text-accent'
    : state === 'partial' ? 'text-accent opacity-50'
    : 'text-label-quaternary hover:text-label-tertiary';
  if (readOnly) {
    return (
      <span
        title={title}
        aria-label={title}
        className={`shrink-0 flex items-center justify-center size-4 rounded pointer-events-none ${state === 'full' ? 'text-accent' : 'text-accent opacity-50'}`}
      >{glyph}</span>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={state !== 'none'}
      className={`shrink-0 flex items-center justify-center size-4 rounded transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${tone}`}
    >{glyph}</button>
  );
}

interface LayerItem { key: string; title: string; open?: boolean; onToggle?: (next: boolean) => void; hidden?: boolean; layerId?: string; leftIcons?: ReactNode; content?: ReactNode; noToggle?: boolean; dragDisabled?: boolean; onRename?: (value: string) => void; }

// Draggable list of layer sections with lift-on-pickup (a shadowed clone of the row follows the
// cursor) and live FLIP shifting (the other cards slide to make room as you drag, and settle on
// drop). Pointer-based drag; the grip is the handle. Panel top→bottom = front→back z-order.
function LayerSectionList({ items, order, zoneIds, dragZone, onOrderChange }: { items: LayerItem[]; order: string[]; zoneIds?: ReadonlySet<string>; dragZone?: ReadonlySet<string>; onOrderChange?: (frontToBackLayerIds: string[]) => void }) {
  // `order` is front→back layer ids, derived from the saved layerOrderIds (single source of truth) —
  // so the panel always reflects the saved z-order and a reorder can't clobber it.
  const [dragKey, setDragKey] = useState<string | null>(null);
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const firstTops = useRef<Map<string, number>>(new Map());   // FLIP "First": row tops captured before a reorder

  // Pointer-based drag (no native HTML5 drag, whose setDragImage snapshots blank on some setups).
  // A real floating clone follows the cursor (lift); window pointermove reorders live (FLIP).
  const dragState = useRef<{ key: string; offX: number; offY: number; overlay: HTMLElement } | null>(null);
  // Stable listener identities; their bodies live in refs (assigned in an effect below) so they always
  // see the latest state without re-binding — and we never read/assign a ref during render.
  const handleMoveImpl = useRef<(e: PointerEvent) => void>(() => {});
  const handleUpImpl = useRef<() => void>(() => {});
  const handleMove = useCallback((e: PointerEvent) => handleMoveImpl.current(e), []);
  const handleUp = useCallback(() => handleUpImpl.current(), []);
  useEffect(() => () => {   // cleanup on unmount
    window.removeEventListener('pointermove', handleMove);
    window.removeEventListener('pointerup', handleUp);
    dragState.current?.overlay.remove();
  }, [handleMove, handleUp]);

  const ordered = (() => {
    // Sort items by their layer id's position in `order` (front→back). Items whose layer isn't in
    // the order keep their natural position at the end.
    const pos = new Map(order.map((id, i) => [id, i] as const));
    return [...items].sort((a, b) =>
      (pos.get(a.layerId ?? ' ') ?? Number.MAX_SAFE_INTEGER) - (pos.get(b.layerId ?? ' ') ?? Number.MAX_SAFE_INTEGER));
  })();

  // ── Image-layer-zone divider ── index of the first rendered card that belongs to the image
  // zone (`zoneIds` — template: just the marker card's id; posts: every layer id below the
  // IMAGES_LAYER_ID sentinel). Recomputed from the CURRENT sorted list on every render, so it
  // stays glued to the marker's slot through drag/FLIP reorders — including while the marker
  // card itself is being dragged. No match (no marker on the slide, or every zone card was
  // dropped by the posts lock rules) → -1 → no divider.
  const zoneStartIdx = zoneIds && zoneIds.size > 0
    ? ordered.findIndex(it => !!it.layerId && zoneIds.has(it.layerId))
    : -1;

  // FLIP "Last + Invert + Play": after a reorder, slide each row from its old top to its new one.
  useLayoutEffect(() => {
    if (firstTops.current.size === 0) return;
    const rows = rowRefs.current;
    // Clear any in-flight transforms first so we measure pure layout (handles rapid re-targets).
    rows.forEach(el => { el.style.transition = 'none'; el.style.transform = ''; });
    const deltas: { el: HTMLElement; dy: number }[] = [];
    rows.forEach((el, key) => {
      const prev = firstTops.current.get(key);
      if (prev == null) return;
      const dy = prev - el.getBoundingClientRect().top;
      if (Math.abs(dy) > 0.5) deltas.push({ el, dy });
    });
    for (const { el, dy } of deltas) el.style.transform = `translateY(${dy}px)`;
    void document.body.offsetHeight;   // force reflow so the inverted start is committed before animating
    for (const { el } of deltas) {
      el.style.transition = 'transform 190ms cubic-bezier(0.2,0,0,1)';
      el.style.transform = '';
    }
    firstTops.current.clear();
  }, [order]);

  const captureFirst = () => {
    const m = new Map<string, number>();
    rowRefs.current.forEach((el, key) => m.set(key, el.getBoundingClientRect().top));
    firstTops.current = m;
  };

  const moveRelative = (from: string, overKey: string, after: boolean) => {
    const keys = ordered.map(it => it.key);
    const next = keys.filter(k => k !== from);
    let idx = next.indexOf(overKey);
    if (idx < 0) return;
    if (after) idx += 1;
    next.splice(idx, 0, from);
    if (next.join('|') === keys.join('|')) return;   // no positional change → skip (avoids thrash)
    captureFirst();
    // Report the new z-order (panel top→bottom = front→back). The parent writes it to layerOrderIds,
    // which flows back as the `order` prop → re-render → FLIP plays. No local order state.
    const byKey = new Map(items.map(it => [it.key, it] as const));
    const ftb = next.map(k => byKey.get(k)?.layerId).filter((x): x is string => !!x);
    onOrderChange?.([...new Set(ftb)]);
  };
  // Keep the pointer-handler bodies current (assigned in an effect, never during render) so the stable
  // handleMove/handleUp listeners always run against the latest moveRelative/state.
  useEffect(() => {
    handleMoveImpl.current = (e: PointerEvent) => {
      const d = dragState.current;
      if (!d) return;
      d.overlay.style.transform = `translate(${e.clientX - d.offX}px, ${e.clientY - d.offY}px)`;
      let target: string | null = null, after = false;
      rowRefs.current.forEach((el, k) => {
        if (target || k === d.key) return;
        // Zone-restricted drag (posts under a template z-order lock): a zone row may only
        // land on other zone rows — the template's cards above the divider are not targets.
        if (dragZone && dragZone.has(d.key) && !dragZone.has(k)) return;
        const rect = el.getBoundingClientRect();
        if (e.clientY >= rect.top && e.clientY <= rect.bottom) { target = k; after = e.clientY > rect.top + rect.height / 2; }
      });
      if (target) moveRelative(d.key, target, after);
    };
    handleUpImpl.current = () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      document.body.style.removeProperty('user-select');
      dragState.current?.overlay.remove();
      dragState.current = null;
      setDragKey(null);
    };
  });

  const startDrag = (key: string, e: React.PointerEvent) => {
    if (e.button !== 0) return;          // left button / primary touch only
    e.preventDefault();
    const row = rowRefs.current.get(key);
    if (!row) return;
    const r = row.getBoundingClientRect();
    // A real floating clone of the row follows the cursor — the "lifted" card.
    const el = row.cloneNode(true) as HTMLElement;
    Object.assign(el.style, {
      position: 'fixed', top: '0px', left: '0px', boxSizing: 'border-box',
      width: `${r.width}px`, height: `${r.height}px`, margin: '0',
      pointerEvents: 'none', opacity: '0.97', zIndex: '99999',
      borderRadius: '8px', boxShadow: '0 16px 34px rgba(0,0,0,0.6)',
      transform: `translate(${r.left}px, ${r.top}px)`, transition: 'none', willChange: 'transform',
    });
    document.body.appendChild(el);
    dragState.current = { key, offX: e.clientX - r.left, offY: e.clientY - r.top, overlay: el };
    document.body.style.setProperty('user-select', 'none');
    setDragKey(key);
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  };

  return (
    <>
      {ordered.map((it, i) => (
        <Fragment key={it.key}>
          {i === zoneStartIdx && (
            /* Image-layer-zone divider — purely visual (never draggable, not a drop target, not
               in rowRefs so the drag hit-testing and FLIP measurements never see it): every card
               below this line sits under the template's image layer in z. Same hairline style as
               the panel's other separators. */
            <div className="h-px bg-separator" aria-hidden="true" />
          )}
          <CollapsibleSection
            rowRef={el => { if (el) rowRefs.current.set(it.key, el); else rowRefs.current.delete(it.key); }}
            title={it.title}
            open={it.open}
            onToggle={it.onToggle}
            dimmed={it.hidden}
            noToggle={it.noToggle}
            grip={!it.dragDisabled}
            leftIcons={it.leftIcons}
            onRename={it.onRename}
            drag={it.dragDisabled ? undefined : {
              onGripPointerDown: e => startDrag(it.key, e),
              isDragging: dragKey === it.key,
            }}
          >
            {it.content}
          </CollapsibleSection>
        </Fragment>
      ))}
    </>
  );
}

// Per-image-box controls (the body only — the accordion header/row is provided by the wrapping CollapsibleSection).
// Four branches: overlay, glow/light-leak, video, and the default image. Returns a fragment so it can be
// dropped straight into a fused layer row.
function ImageBoxEditor({
  b, i, s, onChange,
  lockImageAspect = true, onLockImageAspectChange,
  imageBoxExpandState, expandPreviewBoxId, onExpandPreview, onExpandImageBox,
  perspectiveBoxId, onPerspectiveBox, perspectiveMode = 'distort', onPerspectiveMode,
  imageBoxBgState, onUploadImage,
  enforceLocks = false,
}: {
  b: ImageBox; i: number; s: CarouselSettings;
  onChange: (partial: Partial<CarouselSettings>) => void;
  lockImageAspect?: boolean;
  onLockImageAspectChange?: (v: boolean) => void;
  imageBoxExpandState?: Record<string, 'processing' | 'error'>;
  expandPreviewBoxId?: string | null;
  onExpandPreview?: (boxId: string | null) => void;
  onExpandImageBox?: (boxId: string) => void;
  perspectiveBoxId?: string | null;
  onPerspectiveBox?: (boxId: string | null) => void;
  perspectiveMode?: PerspectiveMode;
  onPerspectiveMode?: (mode: PerspectiveMode) => void;
  imageBoxBgState?: Record<string, 'processing' | 'error'>;
  onUploadImage?: (file: File) => Promise<string | null>;
  enforceLocks?: boolean;   // posts mode: grey out controls whose property is in b.lockedProps
}) {
  // Posts mode: is this property frozen by the template? (Template editor: never.)
  // Locked controls are hidden outright (LockWrap → null); a FULLY locked box never gets a card
  // at all — the parent skips its island before this editor is even mounted.
  const lockedHere = (p: keyof ImageBox) => enforceLocks && isPropLocked(b, p);
  const geomLocked = enforceLocks && hasGeometryLock(b);
  const patchBox = (p: Partial<ImageBox>) => {
    const boxes = [...(s.imageBoxes ?? [])];
    if (!boxes[i]) return;
    boxes[i] = { ...boxes[i], ...p };
    onChange({ imageBoxes: boxes });
  };
  const removeBox = () => {
    const boxes = [...(s.imageBoxes ?? [])];
    boxes.splice(i, 1);
    onChange({ imageBoxes: boxes });
  };
  const maxRadius = Math.max(1, Math.round(Math.min(b.width, b.height) / 2));
  // Fill an image placeholder (slot): pick a file, upload it via the Grid's uploadPostImage, then set
  // THIS box's url. placeholder stays true so the box is still an identifiable / re-fillable slot.
  const [slotUploading, setSlotUploading] = useState(false);
  const slotFileRef = useRef<HTMLInputElement>(null);
  const placeholderUpload = (b.placeholder && onUploadImage) ? (
    <div className="pt-0.5">
      <input
        ref={slotFileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={async e => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          setSlotUploading(true);
          try {
            const url = await onUploadImage(file);
            if (url) patchBox({ url });   // keep placeholder: true
          } finally {
            setSlotUploading(false);
          }
        }}
      />
      <button
        type="button"
        disabled={slotUploading}
        onClick={() => slotFileRef.current?.click()}
        className="w-full h-8 rounded-md text-micro text-label bg-surface border border-separator hover:border-accent hover:text-accent transition-colors disabled:opacity-50"
      >{slotUploading ? 'Uploading…' : b.url ? 'Replace image' : 'Upload image'}</button>
    </div>
  ) : null;
  if (b.isOverlay) {
    return (
      <>
        <LockWrap locked={lockedHere('blend')}><BlendModePicker value={b.blend ?? 'screen'} onChange={v => patchBox({ blend: v })} /></LockWrap>
        <LockWrap locked={lockedHere('opacity')}><Slider label="Opacity" value={b.opacity ?? 100} min={0} max={100} unit="%" onChange={v => patchBox({ opacity: v })} /></LockWrap>
        <button
          onClick={removeBox}
          className="mt-1 w-full h-8 rounded-md text-micro text-danger bg-surface border border-separator hover:border-danger hover:text-danger transition-colors"
        >Remove overlay</button>
      </>
    );
  }
  if (b.glow) {
    return (
      <>
        <ColourSwatch label="Colour" value={b.glow.color} onChange={c => patchBox({ glow: { ...b.glow!, color: c } })} />
        <Slider label="Softness"  value={b.glow.softness ?? 70} min={0} max={100} unit="%" onChange={v => patchBox({ glow: { ...b.glow!, softness: v } })} />
        <LockWrap locked={lockedHere('opacity')}><Slider label="Intensity" value={b.opacity ?? 100}      min={0} max={100} unit="%" onChange={v => patchBox({ opacity: v })} /></LockWrap>
        <LockWrap locked={lockedHere('blend')}><BlendModePicker value={b.blend ?? 'screen'} onChange={v => patchBox({ blend: v })} /></LockWrap>
        <p className="text-micro text-label-tertiary leading-snug">Drag/resize it on the canvas to aim the glow — push it off a corner for an edge leak.</p>
        <button
          onClick={removeBox}
          className="mt-1 w-full h-8 rounded-md text-micro text-danger bg-surface border border-separator hover:border-danger hover:text-danger transition-colors"
        >Remove light leak</button>
      </>
    );
  }
  if (b.videoUrl) {
    // Video box: only the controls that actually apply to a playing video (size/position/opacity/
    // corner-radius). Image-only tools (expand, perspective, effects, detect-background, edge fade)
    // are omitted — they don't affect video.
    const aspect = b.aspect || (b.width / b.height) || 1;
    const commitW = (n: number) => lockImageAspect
      ? (w => patchBox({ width: w, height: w / aspect }))(Math.max(1, Math.min(CAROUSEL_W, CAROUSEL_H * aspect, n)))
      : patchBox({ width: Math.max(1, Math.min(CAROUSEL_W, n)) });
    const commitH = (n: number) => lockImageAspect
      ? (h => patchBox({ height: h, width: h * aspect }))(Math.max(1, Math.min(CAROUSEL_H, CAROUSEL_W / aspect, n)))
      : patchBox({ height: Math.max(1, Math.min(CAROUSEL_H, n)) });
    return (
      <>
        {/* Size/position steppers + aspect toggle all rewrite the box rect → whole cluster hides under a geometry lock */}
        <LockWrap locked={geomLocked}>
        <div className="flex items-center gap-2">
          <ControlLabel>Size</ControlLabel>
          <div className="flex items-center gap-2 ml-auto">
            <label className="flex items-center gap-1 text-micro text-label-tertiary">W
              <Stepper key={`vw-${b.id}`} value={b.width} min={1} max={CAROUSEL_W} ariaLabel="Width" onCommit={commitW} width="w-10" /></label>
            <label className="flex items-center gap-1 text-micro text-label-tertiary">H
              <Stepper key={`vh-${b.id}`} value={b.height} min={1} max={CAROUSEL_H} unit="px" ariaLabel="Height" onCommit={commitH} width="w-10" /></label>
            <ToggleButton active={lockImageAspect} onClick={() => onLockImageAspectChange?.(!lockImageAspect)} label={lockImageAspect ? 'Aspect ratio locked' : 'Aspect ratio unlocked'} title={lockImageAspect ? 'Aspect ratio locked — click to unlock' : 'Aspect ratio unlocked — click to lock'}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 17H7A5 5 0 0 1 7 7h2" /><path d="M15 7h2a5 5 0 0 1 0 10h-2" /><line x1="8" y1="12" x2="16" y2="12" /></svg>
            </ToggleButton>
          </div>
        </div>
        </LockWrap>
        <LockWrap locked={geomLocked}>
        <div className="flex items-center gap-2">
          <ControlLabel>Position</ControlLabel>
          <div className="flex items-center gap-2 ml-auto">
            <label className="flex items-center gap-1 text-micro text-label-tertiary">X
              <Stepper key={`vx-${b.id}`} value={b.x} min={0} max={CAROUSEL_W} ariaLabel="X position" onCommit={n => patchBox({ x: Math.max(0, Math.min(CAROUSEL_W, n)) })} width="w-10" /></label>
            <label className="flex items-center gap-1 text-micro text-label-tertiary">Y
              <Stepper key={`vy-${b.id}`} value={b.y} min={0} max={CAROUSEL_H} unit="px" ariaLabel="Y position" onCommit={n => patchBox({ y: Math.max(0, Math.min(CAROUSEL_H, n)) })} width="w-10" /></label>
          </div>
        </div>
        </LockWrap>
        <LockWrap locked={lockedHere('opacity')}><Slider label="Opacity"       value={b.opacity ?? 100} min={0} max={100} unit="%" onChange={v => patchBox({ opacity: v })} /></LockWrap>
        <LockWrap locked={lockedHere('cornerRadius')}><Slider label="Corner Radius" value={Math.min(b.cornerRadius ?? 0, maxRadius)} min={0} max={maxRadius} unit="px" onChange={v => patchBox({ cornerRadius: v })} /></LockWrap>
        <p className="text-micro text-label-tertiary leading-snug">Plays muted on loop while editing. Drag/resize it on the canvas like any element.</p>
        <button
          onClick={removeBox}
          className="mt-1 w-full h-8 rounded-md text-micro text-danger bg-surface border border-separator hover:border-danger hover:text-danger transition-colors"
        >Remove video</button>
      </>
    );
  }
  return (
    <>
      {/* Placeholder filling is NEVER gated — setting `url` isn't a lockable prop, so the slot
          stays fillable/replaceable even when the template locked this box's geometry/styles.
          (Posts never reach here for a placeholder box — its island is skipped by the parent.) */}
      {placeholderUpload}
      {(() => {
        const aspect = (b.crop ? (b.width / b.height) : b.aspect) || (b.width / b.height) || 1;
        // Locked: clamp the typed dimension to the joint canvas bounds, then derive
        // the other at FULL precision (no rounding, no min-floor) so the ratio holds exactly.
        const commitW = (n: number) => lockImageAspect
          ? (w => patchBox({ width: w, height: w / aspect }))(Math.max(1, Math.min(CAROUSEL_W, CAROUSEL_H * aspect, n)))
          : patchBox({ width: Math.max(1, Math.min(CAROUSEL_W, n)) });
        const commitH = (n: number) => lockImageAspect
          ? (h => patchBox({ height: h, width: h * aspect }))(Math.max(1, Math.min(CAROUSEL_H, CAROUSEL_W / aspect, n)))
          : patchBox({ height: Math.max(1, Math.min(CAROUSEL_H, n)) });
        return (
          <>
            {/* Size/position steppers + aspect toggle all rewrite the box rect → whole cluster greys under a geometry lock */}
            <LockWrap locked={geomLocked}>
            <div className="flex items-center gap-2">
              <ControlLabel>Size</ControlLabel>
              <div className="flex items-center gap-2 ml-auto">
                <label className="flex items-center gap-1 text-micro text-label-tertiary">
                  W
                  <Stepper key={`w-${b.id}`} value={b.width} min={1} max={CAROUSEL_W} ariaLabel="Width" onCommit={commitW} width="w-10" />
                </label>
                <label className="flex items-center gap-1 text-micro text-label-tertiary">
                  H
                  <Stepper key={`h-${b.id}`} value={b.height} min={1} max={CAROUSEL_H} unit="px" ariaLabel="Height" onCommit={commitH} width="w-10" />
                </label>
                <ToggleButton
                  active={lockImageAspect}
                  onClick={() => onLockImageAspectChange?.(!lockImageAspect)}
                  label={lockImageAspect ? 'Aspect ratio locked' : 'Aspect ratio unlocked'}
                  title={lockImageAspect ? 'Aspect ratio locked — click to unlock' : 'Aspect ratio unlocked — click to lock'}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 17H7A5 5 0 0 1 7 7h2" />
                    <path d="M15 7h2a5 5 0 0 1 0 10h-2" />
                    <line x1="8" y1="12" x2="16" y2="12" />
                  </svg>
                </ToggleButton>
              </div>
            </div>
            </LockWrap>
            <LockWrap locked={geomLocked}>
            <div className="flex items-center gap-2">
              <ControlLabel>Position</ControlLabel>
              <div className="flex items-center gap-2 ml-auto">
                <label className="flex items-center gap-1 text-micro text-label-tertiary">
                  X
                  <Stepper key={`x-${b.id}`} value={b.x} min={0} max={CAROUSEL_W} ariaLabel="X position" onCommit={n => patchBox({ x: Math.max(0, Math.min(CAROUSEL_W, n)) })} width="w-10" />
                </label>
                <label className="flex items-center gap-1 text-micro text-label-tertiary">
                  Y
                  <Stepper key={`y-${b.id}`} value={b.y} min={0} max={CAROUSEL_H} unit="px" ariaLabel="Y position" onCommit={n => patchBox({ y: Math.max(0, Math.min(CAROUSEL_H, n)) })} width="w-10" />
                </label>
              </div>
            </div>
            </LockWrap>
          </>
        );
      })()}
      <LockWrap locked={lockedHere('opacity')}><Slider label="Opacity"       value={b.opacity ?? 100} min={0} max={100} unit="%" onChange={v => patchBox({ opacity: v })} /></LockWrap>
      <LockWrap locked={lockedHere('cornerRadius')}><Slider label="Corner Radius" value={Math.min(b.cornerRadius ?? 0, maxRadius)} min={0} max={maxRadius} unit="px" onChange={v => patchBox({ cornerRadius: v })} /></LockWrap>
      {/* Advanced: AI expand, perspective, effects, and background separation are rare
          edits — kept under a disclosure so the common size/position/opacity controls lead
          (progressive-disclosure.md). Shadow and the destructive Remove stay visible below.
          Opens by default when an advanced edit is already in progress or set, so the user
          never loses sight of an active control. */}
      <Disclosure
        title="Advanced"
        defaultOpen={
          perspectiveBoxId === b.id ||
          expandPreviewBoxId === b.id ||
          !!b.splitEnabled ||
          !!b.perspective ||
          (b.fgEffects != null && Object.keys(b.fgEffects).length > 0)
        }
      >
      {/* Expand image — BRIA outpaints the image to fill the whole slide from its current
          placement, then replaces this box (full-slide) with the result. */}
      {onExpandImageBox && (() => {
        const status = imageBoxExpandState?.[b.id];
        const busy = status === 'processing';
        const previewing = expandPreviewBoxId === b.id;
        return (
          // Expand replaces the box with a full-slide rect → gated under a template geometry lock.
          <LockWrap locked={geomLocked}>
          <div className="flex flex-col gap-2 pt-1">
            <div className="flex items-center justify-between">
              <ControlLabel>Expand to fill slide</ControlLabel>
              {!previewing ? (
                <button
                  onClick={() => onExpandPreview?.(b.id)}
                  disabled={busy}
                  title="Preview & adjust the area BRIA will fill, then generate"
                  className="px-2 h-6 rounded text-micro bg-surface-1 border border-separator text-label-secondary hover:text-label hover:border-label-quaternary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Expand…
                </button>
              ) : (
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => onExpandPreview?.(null)}
                    disabled={busy}
                    className="px-2 h-6 rounded text-micro bg-surface-1 border border-separator text-label-tertiary hover:text-label-secondary disabled:opacity-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => onExpandImageBox(b.id)}
                    disabled={busy}
                    className="px-2 h-6 rounded text-micro bg-accent text-on-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {busy ? 'Generating…' : 'Generate'}
                  </button>
                </div>
              )}
            </div>
            {status === 'error' && (
              <span className="text-micro text-danger">Couldn’t expand the image — try again.</span>
            )}
            {previewing && status !== 'error' && (
              <span className="text-micro text-label-quaternary leading-relaxed">
                Drag/resize the image on the canvas — the shaded area is what AI (BRIA) will generate. Then Generate.
              </span>
            )}
            {!previewing && status !== 'error' && (
              <span className="text-micro text-label-quaternary leading-relaxed">Fills the canvas around the image using AI (BRIA), based on where you place it.</span>
            )}
          </div>
          </LockWrap>
        );
      })()}

      {/* Perspective / distort — drag the 4 corner handles on the canvas. Distort = free
          corners; Perspective = symmetric trapezoid; Skew = parallelogram. */}
      {onPerspectiveBox && (() => {
        const editing = perspectiveBoxId === b.id;
        const p = b.perspective;
        const hasPersp = !!p && [p.tl, p.tr, p.br, p.bl].some(c => (c.x || 0) !== 0 || (c.y || 0) !== 0);
        const MODES: { id: PerspectiveMode; label: string; hint: string }[] = [
          { id: 'distort',     label: 'Distort',     hint: 'Each corner moves freely.' },
          { id: 'perspective', label: 'Perspective', hint: 'The same-edge corner mirrors — symmetric trapezoid.' },
          { id: 'skew',        label: 'Skew',        hint: 'The edge slides — parallelogram.' },
        ];
        return (
          // Perspective warps the box's corners (mutates its rect) → gated under a template geometry lock.
          <LockWrap locked={geomLocked}>
          <div className="flex flex-col gap-2 pt-1">
            <div className="flex items-center justify-between">
              <ControlLabel>Perspective</ControlLabel>
              <button
                onClick={() => onPerspectiveBox(editing ? null : b.id)}
                title="Drag the four corners on the canvas to warp the image"
                className={`px-2 h-6 rounded text-micro transition-colors ${editing ? 'bg-accent text-on-accent' : 'bg-surface-1 border border-separator text-label-secondary hover:text-label hover:border-label-quaternary'}`}
              >
                {editing ? 'Done' : 'Edit corners…'}
              </button>
            </div>
            {/* Rotation is stored as a pure-rotation corner quad (same as the CLI `rotate`),
                so it composes with split/stroke/effects for free. Dragging it replaces any
                hand-made corner warp — the slider reads the top edge's current tilt. */}
            <Slider label="Rotate" value={rotationFromPerspective(b.width, b.perspective)} min={-180} max={180} unit="°"
              onChange={v => patchBox({ perspective: perspectiveForRotation(b.width, b.height, v) })} />
            {editing && (
              <>
                <SegmentedControl<PerspectiveMode>
                  value={perspectiveMode}
                  options={MODES.map(m => ({ value: m.id, label: m.label }))}
                  onChange={m => onPerspectiveMode?.(m)}
                />
                <span className="text-micro text-label-quaternary leading-relaxed">
                  Drag the four corner dots on the canvas. {MODES.find(m => m.id === perspectiveMode)?.hint}
                </span>
              </>
            )}
            {hasPersp && (
              <button
                onClick={() => patchBox({ perspective: undefined })}
                className="self-start px-2 h-6 rounded text-micro bg-surface-1 border border-separator text-label-tertiary hover:text-label-secondary transition-colors"
              >
                Reset perspective
              </button>
            )}
          </div>
          </LockWrap>
        );
      })()}

      {/* Brightness / blur / noise. By default they adjust the whole image. Turn on
          "Detect background" to separate the subject (AI cut-out) — then these controls
          adjust the foreground (subject) and a Background group appears for the rest. */}
      {(() => {
        const fg = b.fgEffects ?? {};
        const bg = b.bgEffects ?? {};
        const setFg = (p: Partial<ImageEffects>) => patchBox({ fgEffects: { ...fg, ...p } });
        const setBg = (p: Partial<ImageEffects>) => patchBox({ bgEffects: { ...bg, ...p } });
        const status  = imageBoxBgState?.[b.id];
        const enabled = !!b.splitEnabled;
        return (
          <div className="flex flex-col gap-2 pt-1">
            <span className="text-micro font-semibold text-label-secondary">{enabled ? 'Foreground' : 'Adjust'}</span>
            <Slider label="Brightness" value={fg.brightness ?? 0} min={-100} max={100} unit="%"  onChange={v => setFg({ brightness: v })} />
            <Slider label="Blur"       value={fg.blur ?? 0}       min={0}    max={40}  unit="px" onChange={v => setFg({ blur: v })} />
            <ToggleSwitch
              label="Fade blurred edges"
              checked={!!fg.blurEdgeFade}
              onChange={v => setFg({ blurEdgeFade: v })}
              title="On: the blurred image fades to transparent at the edges (soft vignette). Off: solid edge-to-edge blur."
            />
            <Slider label="Noise"      value={fg.noise ?? 0}      min={0}    max={100} unit="%"  onChange={v => setFg({ noise: v })} />
            <LockWrap locked={lockedHere('fade')}><ImageFadeControls fade={b.fade} onChange={next => patchBox({ fade: next })} /></LockWrap>

            <div className="pt-1">
              <ToggleSwitch
                label="Detect background"
                checked={enabled}
                onChange={v => patchBox({ splitEnabled: v })}
                title="Separate the subject from the background so each can be adjusted independently"
              />
            </div>
            {(() => {
              // Send this image into the gap between another detect-background image's background and subject.
              const hosts = (s.imageBoxes ?? []).filter(x => x.splitEnabled && x.id !== b.id);
              if (hosts.length === 0) return null;
              return (
                <div className="flex items-center justify-between">
                  <ControlLabel>Behind subject of</ControlLabel>
                  <select
                    value={b.behindSubjectOf ?? ''}
                    onChange={e => patchBox({ behindSubjectOf: e.target.value || undefined })}
                    aria-label="Behind subject of"
                    title="Render this image between the chosen detect-background image's background and its subject"
                    className="bg-surface border border-separator focus:border-label-quaternary rounded px-1.5 py-1 text-micro text-label outline-none max-w-[55%]"
                  >
                    <option value="">None</option>
                    {hosts.map(hst => (
                      <option key={hst.id} value={hst.id}>Image {(s.imageBoxes ?? []).indexOf(hst) + 1}</option>
                    ))}
                  </select>
                </div>
              );
            })()}
            {enabled && status === 'processing' && (
              <span className="text-micro text-label-tertiary">Separating subject…</span>
            )}
            {enabled && status === 'error' && (
              <span className="text-micro text-danger">Couldn’t separate the subject — try a different image.</span>
            )}
            {enabled && status !== 'processing' && status !== 'error' && (
              <>
                <span className="text-micro font-semibold text-label-secondary pt-1">Background</span>
                <ToggleSwitch
                  label="Remove background"
                  checked={!!b.bgHidden}
                  onChange={v => patchBox({ bgHidden: v })}
                  title="Drop the background entirely — keep only the subject, transparent behind it (reveals whatever is below this image on the slide). Use instead of darkening the background to black."
                />
                {!b.bgHidden && <>
                <Slider label="Brightness" value={bg.brightness ?? 0} min={-100} max={100} unit="%"  onChange={v => setBg({ brightness: v })} />
                <Slider label="Blur"       value={bg.blur ?? 0}       min={0}    max={40}  unit="px" onChange={v => setBg({ blur: v })} />
                <ToggleSwitch
                  label="Fade blurred edges"
                  checked={!!bg.blurEdgeFade}
                  onChange={v => setBg({ blurEdgeFade: v })}
                  title="On: the blurred background fades to transparent at the edges (soft vignette). Off: solid edge-to-edge blur."
                />
                <Slider label="Noise"      value={bg.noise ?? 0}      min={0}    max={100} unit="%"  onChange={v => setBg({ noise: v })} />
                <ImageFadeControls fade={b.bgFade} onChange={next => patchBox({ bgFade: next })} />
                </>}
                {/* Subject outline: a coloured stroke around the detected subject's silhouette,
                    drawn between the background and the subject. Needs the cut-out (fgUrl) —
                    it also applies with "Remove background" on, ringing the bare subject. */}
                {!!b.fgUrl && (
                  <LockWrap locked={lockedHere('fgStroke')}>
                    <div className="flex flex-col gap-2 pt-1">
                      <ToggleSwitch
                        label="Subject outline"
                        checked={!!b.fgStroke}
                        onChange={v => patchBox({ fgStroke: v ? { color: '#ffffff', width: 12 } : undefined })}
                        title="Draw a coloured outline around the subject's silhouette, between the background and the subject"
                      />
                      {b.fgStroke && <>
                        <ColourSwatch label="Outline colour" value={b.fgStroke.color} onChange={c => patchBox({ fgStroke: { ...b.fgStroke!, color: c } })} />
                        <Slider label="Outline width" value={b.fgStroke.width} min={1} max={60} unit="px" onChange={v => patchBox({ fgStroke: { ...b.fgStroke!, width: v } })} />
                      </>}
                    </div>
                  </LockWrap>
                )}
              </>
            )}
          </div>
        );
      })()}
      </Disclosure>
      <LockWrap locked={lockedHere('shadow')}><ShadowEditor value={b.shadow} onChange={v => patchBox({ shadow: v })} showLift={false} /></LockWrap>
      <button
        onClick={removeBox}
        className="mt-1 w-full h-8 rounded-md text-micro text-danger bg-surface border border-separator hover:border-danger hover:text-danger transition-colors"
      >Remove image</button>
    </>
  );
}

// Per-chart-box controls (body only — the accordion header/row is provided by the wrapping CollapsibleSection).
function ChartBoxEditor({ cb, i, s, onChange }: {
  cb: ChartBox; i: number; s: CarouselSettings;
  onChange: (partial: Partial<CarouselSettings>) => void;
}) {
  const patchChart = (p: Partial<ChartBox>) => {
    const boxes = [...(s.chartBoxes ?? [])];
    if (!boxes[i]) return;
    boxes[i] = { ...boxes[i], ...p };
    onChange({ chartBoxes: boxes });
  };
  const removeChart = () => {
    const boxes = [...(s.chartBoxes ?? [])];
    boxes.splice(i, 1);
    onChange({ chartBoxes: boxes });
  };
  const PERIODS: ChartPeriod[] = ['1D', '1W', '1M', '3M', '6M', '1Y', 'ALL'];
  return (
    <>
      {/* Timeframe — same windows as the trading site. A release anchor (below) overrides it. */}
      <div className="flex flex-col gap-1">
        <ControlLabel>Timeframe</ControlLabel>
        <div className="flex gap-1 flex-wrap">
          {PERIODS.map(p => (
            <button
              key={p}
              onClick={() => patchChart({ period: p, sinceRelease: undefined })}
              aria-pressed={!cb.sinceRelease && cb.period === p}
              className={`h-6 px-1.5 rounded text-micro font-medium transition-colors ${
                !cb.sinceRelease && cb.period === p ? 'bg-accent text-on-accent' : 'bg-surface border border-separator text-label-tertiary hover:text-label-secondary'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>
      {/* Since-release window: 1 week of run-up before the chosen release → end of data */}
      {(cb.releases ?? []).some(r => r.date) && (
        <div className="flex items-center justify-between">
          <ControlLabel>Since release</ControlLabel>
          <select
            value={cb.sinceRelease ?? ''}
            onChange={e => patchChart({ sinceRelease: e.target.value || undefined })}
            aria-label="Window the chart from a release"
            title="Show the chart from 1 week before this release to now"
            className="bg-surface border border-separator focus:border-label-quaternary rounded px-1.5 py-1 text-micro text-label outline-none max-w-[55%]"
          >
            <option value="">None</option>
            {[...(cb.releases ?? [])]
              .filter(r => r.date)
              .sort((a, b) => (b.date! < a.date! ? -1 : 1))
              .map((r, ri) => (
                <option key={`${r.date}-${ri}`} value={r.date}>
                  {(r.name || 'Release').slice(0, 28)} · {r.date}
                </option>
              ))}
          </select>
        </div>
      )}
      {/* Window end: end of data (default), a custom date, or the extremum after the start */}
      <div className="flex items-center justify-between">
        <ControlLabel>End point</ControlLabel>
        <select
          value={cb.endMode ?? ''}
          onChange={e => {
            const v = e.target.value as '' | 'custom' | 'lowest' | 'highest';
            patchChart({ endMode: v || undefined });
          }}
          aria-label="Where the chart window ends"
          title="End the chart at the data end, a custom date, or the lowest/highest point after the start"
          className="bg-surface border border-separator focus:border-label-quaternary rounded px-1.5 py-1 text-micro text-label outline-none max-w-[55%]"
        >
          <option value="">End of data</option>
          <option value="custom">Custom date</option>
          <option value="lowest">Lowest after start</option>
          <option value="highest">Highest after start</option>
        </select>
      </div>
      {cb.endMode === 'custom' && (
        <div className="flex items-center justify-between">
          <ControlLabel>End date</ControlLabel>
          <input
            type="date"
            value={(cb.endDate ?? '').slice(0, 10)}
            onChange={e => patchChart({ endDate: e.target.value || undefined })}
            aria-label="Custom end date for the chart window"
            className="bg-surface border border-separator focus:border-label-quaternary rounded px-1.5 py-1 text-micro text-label outline-none max-w-[55%]"
          />
        </div>
      )}
      {/* Line / candle mode */}
      <div className="flex items-center justify-between">
        <ControlLabel>Style</ControlLabel>
        <div className="flex gap-1">
          {(['line', 'candle'] as const).map(m => (
            <button
              key={m}
              onClick={() => patchChart({ mode: m })}
              aria-pressed={cb.mode === m}
              className={`h-6 px-2 rounded text-micro font-medium capitalize transition-colors ${
                cb.mode === m ? 'bg-accent text-on-accent' : 'bg-surface border border-separator text-label-tertiary hover:text-label-secondary'
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      </div>
      {(() => {
        // The header, release-name row, and x-axis date row each extend the locked design
        // height (mobile layout), so their toggles (and the markers toggle, which gates names)
        // re-fit the box. The web layout's aspect is a constant — refit only cares about layout.
        const isWeb = cb.layout === 'web';
        const namesOn = cb.showReleases !== false && cb.showReleaseNames === true;
        const xOn = cb.showXDates !== false;
        const refit = (h: boolean, n: boolean, x: boolean, layout = cb.layout) => Math.round(cb.width / chartAspect(h, n, x, layout));
        return (
          <>
            {/* Mobile = the app's artist screen (390 design, Aug-4 styling). Desktop = the
                pre-Aug-4 panoramic chart (500 design: wider box, bigger header text, time-scaled
                x axis). Switching re-fits the height to the layout's aspect. */}
            <SegmentedControl<'mobile' | 'web'>
              value={isWeb ? 'web' : 'mobile'}
              options={[{ value: 'mobile', label: 'Mobile' }, { value: 'web', label: 'Desktop' }]}
              onChange={v => patchChart({ layout: v, height: refit(cb.showHeader !== false, namesOn, xOn, v) })}
            />
            <ToggleSwitch
              label="Header (name + price)"
              checked={cb.showHeader !== false}
              onChange={v => patchChart({ showHeader: v, height: refit(v, namesOn, xOn) })}
            />
            {/* Platform icons arrived with the Aug-4 restyle — mobile layout only. */}
            {!isWeb && cb.showHeader !== false && (
              <ToggleSwitch
                label="Platform icons"
                checked={cb.showPlatformIcons !== false}
                onChange={v => patchChart({ showPlatformIcons: v })}
              />
            )}
            <ToggleSwitch label="Gridlines + prices" checked={cb.showGrid !== false} onChange={v => patchChart({ showGrid: v })} />
            <ToggleSwitch
              label="X-axis dates"
              checked={xOn}
              onChange={v => patchChart({ showXDates: v, height: refit(cb.showHeader !== false, namesOn, v) })}
            />
            <ToggleSwitch
              label="Watermark"
              checked={cb.showWatermark !== false}
              onChange={v => patchChart({ showWatermark: v })}
              title="The Sonotrade wordmark, top right"
            />
            <ToggleSwitch
              label="Release markers"
              checked={cb.showReleases !== false}
              onChange={v => patchChart({ showReleases: v, height: refit(cb.showHeader !== false, v && cb.showReleaseNames === true, xOn) })}
            />
            {cb.showReleases !== false && (
              <>
                <ToggleSwitch
                  label="Release names"
                  checked={cb.showReleaseNames === true}
                  onChange={v => patchChart({ showReleaseNames: v, height: refit(cb.showHeader !== false, v, xOn) })}
                />
                <ToggleSwitch
                  label="Release dates"
                  checked={cb.showReleaseDates === true}
                  onChange={v => patchChart({ showReleaseDates: v })}
                  title="The site's hover indicator, made static: date label + bright guide line"
                />
              </>
            )}
          </>
        );
      })()}
      {cb.mode === 'line' && (
        <>
          <ToggleSwitch label="Last-point dot"  checked={cb.showLastDot !== false}  onChange={v => patchChart({ showLastDot: v })} />
          <ToggleSwitch label="Area fill"       checked={cb.fillArea === true}      onChange={v => patchChart({ fillArea: v })} />
          <ToggleSwitch
            label="Animate (20s video)"
            checked={cb.animate === true}
            onChange={v => patchChart({ animate: v })}
            title="Play the site's chart animations (draw-on, dot pulse, spark). The editor previews a 20s loop; the slide downloads/publishes as a 20s video."
          />
        </>
      )}
      <ColourSwatch label="Up colour"   value={cb.positiveColor ?? '#04df9d'} onChange={c => patchChart({ positiveColor: c })} />
      <ColourSwatch label="Down colour" value={cb.negativeColor ?? '#FF4B4B'} onChange={c => patchChart({ negativeColor: c })} />
      <Slider label="Opacity" value={cb.opacity ?? 100} min={0} max={100} unit="%" onChange={v => patchChart({ opacity: v })} />
      <button
        onClick={removeChart}
        className="mt-1 w-full h-8 rounded-md text-micro text-danger bg-surface border border-separator hover:border-danger hover:text-danger transition-colors"
      >Remove chart</button>
    </>
  );
}

export function TemplateEditorSettingsPanel({ settings, onChange, videoMode, selectedElement, onSelectElement, lockImageAspect = true, onLockImageAspectChange, richText, imageBoxBgState, imageBoxExpandState, onExpandImageBox, expandPreviewBoxId, onExpandPreview, perspectiveBoxId, onPerspectiveBox, perspectiveMode = 'distort', onPerspectiveMode, onUploadImage, enforceLocks = false, postCaption, onRemoveFade }: TemplateEditorSettingsPanelProps & { onUploadImage?: (file: File) => Promise<string | null>; enforceLocks?: boolean }) {
  const s = settings;
  const canvasColorInputRef = useRef<HTMLInputElement>(null);   // hidden native picker for the canvas colour swatch
  // Posts: slide-wide settings the template froze (element-level lockedProps are enforced separately).
  const settingLocked = (name: string) => enforceLocks && !!s.lockedSettings?.includes(name);
  // ── Posts-mode island visibility (template mode: every one of these is true) ──
  // Locked controls hide outright, so an island whose every control vanished is dropped whole —
  // no empty cards, gaps or dividers. A fade edge group has content while its on/off toggle is
  // unlocked, or the edge is on and at least one of its sliders is unlocked.
  const bottomFadeVis = !settingLocked('showFade') || (s.showFade && (!settingLocked('fadeFloor') || !settingLocked('fadeReach') || !settingLocked('fadeIntensity')));
  const topFadeVis = !settingLocked('showTopFade') || (s.showTopFade && (!settingLocked('topFadeFloor') || !settingLocked('topFadeReach') || !settingLocked('topFadeIntensity')));
  // A DELETED fade layer has no card at all — that's what makes it a layer
  // rather than permanent furniture. (Posts still hide it when locks leave
  // nothing editable, via bottomFadeVis/topFadeVis.)
  const fadeIslandVis = !s.fadeRemoved && (bottomFadeVis || topFadeVis);
  // Canvas Colour: shown while the fill mode control or the colour swatch survives its locks
  // (canvasColor locked → both gone; transparency locked ON → the colour is moot too).
  const canvasFillVis = !(settingLocked('canvasTransparent') || settingLocked('canvasColor'));
  const canvasSwatchVis = !(settingLocked('canvasColor') || (!!s.canvasTransparent && settingLocked('canvasTransparent')));
  const canvasIslandVis = canvasFillVis || canvasSwatchVis;
  // Image cards in posts: a placeholder slot NEVER gets a card (filling happens on the canvas), and
  // a box whose full lock preset (or a superset) is locked has nothing left to show. Text/chart
  // cards always render (the text field stays editable under any lock).
  const postImageCardVis = (b: ImageBox) => !enforceLocks || (!b.placeholder && elementLockState(b.lockedProps, IMAGE_LOCK_PRESET) !== 'full');
  // POSTS: an overlay is template furniture. Its card still shows so it can be
  // reordered and hidden, but it carries NO settings — no blend, no opacity, no
  // remove. Rendered as a static row (noToggle), like the fade band.
  const postOverlayInert = (b: ImageBox) => enforceLocks && !!b.isOverlay;
  const anyLayerCardVis = !enforceLocks || fadeIslandVis || (s.textBoxes ?? []).length > 0 || (s.chartBoxes ?? []).length > 0 || (s.imageBoxes ?? []).some(postImageCardVis);
  const hasDividerCards = (s.dividerSlots ?? []).some(d => d !== null);
  const hasQuoteCards = (s.quoteSlots ?? []).some(q => q !== null) || (s.quoteZoneSlots ?? []).some(q => q !== null);
  const hasSwipeCards = (s.swipeZoneSlots ?? []).some(sw => sw !== null);
  // Base sections (Logo / Layout / Fade / Background / Headline / Sub-headline) are
  // hidden for now — flip to true to bring them all back.
  const SHOW_BASE_SECTIONS: boolean = false;
  // Tags section hidden for now — flip to true to bring it back.
  const SHOW_TAGS_SECTION: boolean = false;

  // Flip a per-element boolean flag (hidden/locked) on the box at [index] of its array — mirrors the
  // canvas/grid toggle logic: clone the array, flip the flag, write it back through onChange.
  const flipFlag = (kind: LayerKind, index: number, flag: 'hidden' | 'locked') => {
    if (kind === 'image') {
      const arr = [...(s.imageBoxes ?? [])];
      if (arr[index]) { arr[index] = { ...arr[index], [flag]: !arr[index][flag] }; onChange({ imageBoxes: arr }); }
    } else if (kind === 'chart') {
      const arr = [...(s.chartBoxes ?? [])];
      if (arr[index]) { arr[index] = { ...arr[index], [flag]: !arr[index][flag] }; onChange({ chartBoxes: arr }); }
    } else if (kind === 'text') {
      const arr = [...(s.textBoxes ?? [])];
      if (arr[index]) { arr[index] = { ...arr[index], [flag]: !arr[index][flag] }; onChange({ textBoxes: arr }); }
    }
  };

  // Custom layer display name — same array-clone + onChange path as every other per-element edit,
  // so autosave/undo/live-sync see a normal box change. An empty name removes the field (the card
  // falls back to its derived title). Allowed in BOTH template and posts mode: names are labels,
  // not design locks. No-op commits (same name, or clearing an already-absent name) write nothing.
  const renameElement = (kind: 'text' | 'image' | 'chart', index: number, raw: string) => {
    const name = raw.trim();
    if (kind === 'image') {
      const arr = [...(s.imageBoxes ?? [])];
      const b = arr[index]; if (!b || (name ? b.name === name : !b.name)) return;
      if (name) arr[index] = { ...b, name };
      else { const { name: _drop, ...rest } = b; arr[index] = rest; }
      onChange({ imageBoxes: arr });
    } else if (kind === 'chart') {
      const arr = [...(s.chartBoxes ?? [])];
      const cb = arr[index]; if (!cb || (name ? cb.name === name : !cb.name)) return;
      if (name) arr[index] = { ...cb, name };
      else { const { name: _drop, ...rest } = cb; arr[index] = rest; }
      onChange({ chartBoxes: arr });
    } else {
      const arr = [...(s.textBoxes ?? [])];
      const tb = arr[index]; if (!tb || (name ? tb.name === name : !tb.name)) return;
      if (name) arr[index] = { ...tb, name };
      else { const { name: _drop, ...rest } = tb; arr[index] = rest; }
      onChange({ textBoxes: arr });
    }
  };

  // Header-padlock writer (template mode): unlocked/partial → write the FULL preset;
  // full → clear the field. Goes through the same array-clone + onChange path as every
  // other per-element edit so autosave and undo see a normal box change.
  const toggleElementLock = (kind: 'text' | 'image', index: number) => {
    if (kind === 'text') {
      const arr = [...(s.textBoxes ?? [])];
      const tb = arr[index]; if (!tb) return;
      if (elementLockState(tb.lockedProps, TEXT_LOCK_PRESET) === 'full') {
        const { lockedProps: _drop, ...rest } = tb;
        arr[index] = rest;
      } else {
        arr[index] = { ...tb, lockedProps: [...TEXT_LOCK_PRESET] };
      }
      onChange({ textBoxes: arr });
    } else {
      const arr = [...(s.imageBoxes ?? [])];
      const b = arr[index]; if (!b) return;
      if (elementLockState(b.lockedProps, IMAGE_LOCK_PRESET) === 'full') {
        const { lockedProps: _drop, ...rest } = b;
        arr[index] = rest;
      } else {
        arr[index] = { ...b, lockedProps: [...IMAGE_LOCK_PRESET] };
      }
      onChange({ imageBoxes: arr });
    }
  };

  // Slide-level group padlock (Fade / Canvas Colour): merge or strip ONLY this group's
  // names in lockedSettings, keeping other groups' names; drop the field once empty.
  // Written via the same onChange as canvasColor/fade edits → normal autosave path.
  const toggleGroupLock = (group: readonly string[]) => {
    const cur = s.lockedSettings ?? [];
    if (groupLockState(cur, group) === 'full') {
      const next = cur.filter(name => !group.includes(name));
      onChange({ lockedSettings: next.length ? next : undefined });
    } else {
      onChange({ lockedSettings: [...cur.filter(name => !group.includes(name)), ...group] });
    }
  };

  // The fused-accordion body for a selected layer row: the element's own controls, mounted inline.
  // 'fade' has no body (its controls live in the structural Fade section); guarded elsewhere.
  const renderElementBody = (kind: LayerKind, index: number): ReactNode => {
    if (kind === 'image') {
      const b = (s.imageBoxes ?? [])[index];
      if (!b) return null;
      return (
        <ImageBoxEditor
          b={b} i={index} s={s} onChange={onChange}
          lockImageAspect={lockImageAspect}
          onLockImageAspectChange={onLockImageAspectChange}
          imageBoxExpandState={imageBoxExpandState}
          expandPreviewBoxId={expandPreviewBoxId}
          onExpandPreview={onExpandPreview}
          onExpandImageBox={onExpandImageBox}
          perspectiveBoxId={perspectiveBoxId}
          onPerspectiveBox={onPerspectiveBox}
          perspectiveMode={perspectiveMode}
          onPerspectiveMode={onPerspectiveMode}
          imageBoxBgState={imageBoxBgState}
          onUploadImage={onUploadImage}
          enforceLocks={enforceLocks}
        />
      );
    }
    if (kind === 'chart') {
      const cb = (s.chartBoxes ?? [])[index];
      if (!cb) return null;
      return <ChartBoxEditor cb={cb} i={index} s={s} onChange={onChange} />;
    }
    if (kind === 'text') {
      const tb = (s.textBoxes ?? [])[index];
      if (!tb) return null;
      return (
        <TextBoxEditor
          tb={tb}
          enforceLocks={enforceLocks}
          rich={richText && richText.activeBox === index ? richText : undefined}
          onChange={next => {
            const arr = [...(s.textBoxes ?? [])];
            arr[index] = next;
            onChange({ textBoxes: arr });
          }}
          onRemove={() => {
            const arr = [...(s.textBoxes ?? [])];
            arr.splice(index, 1);
            onChange({ textBoxes: arr });
          }}
        />
      );
    }
    return null;
  };

  return (
    <div className="flex flex-col h-full bg-transparent">

      {/* Scrollable sections — vertically CENTRED (my-auto) when they don't fill the
          panel, like digitalestate2; when taller than the panel the auto margins
          collapse to 0 so it scrolls normally from the top. */}
      <div className="flex-1 overflow-y-auto min-h-0 flex flex-col">
      <div className="my-auto flex flex-col gap-3 px-3 pt-3 pb-3">

      {/* Fused layer list — leads the inspector. Each free-element row (image/text/chart) is a full
          settings CARD (grip + uppercase title + eye + chevron), identical to the structural sections
          below: one uniform accordion. A selected row expands to that element's controls. The Fade row
          is here too (always present) and expands to the fade controls — fade appears exactly once. */}
      {(() => {
        const imgBoxes = s.imageBoxes ?? [];
        const textBoxes = s.textBoxes ?? [];
        const chartBoxes = s.chartBoxes ?? [];
        const fadeEnabled = !!(s.showFade || s.showTopFade);
        // orderedLayerIds returns bottom→top; the panel shows front (top) first.
        const layers = orderedLayerIds(imgBoxes, textBoxes, s.layerOrderIds, fadeEnabled, chartBoxes);
        const frontToBack = [...layers].reverse();
        const order = frontToBack.map(l => l.id);   // front→back z-order ids (LayerSectionList sorts by this)

        // ── Image layer zone ── which layer ids sit AT or BELOW the slide's image-layer boundary.
        // LayerSectionList draws a hairline divider just above the first rendered card in this set.
        // TEMPLATE: the marker (first image box that's `placeholder` with no url) is itself a card,
        //   and the zone is the marker + everything below it in z — so the marker's id alone anchors
        //   the divider; the cards after it fall below positionally.
        // POSTS: the marker box never exists — the IMAGES_LAYER_ID sentinel in layerOrderIds
        //   (bottom→top) marks the spot and renders nothing, so the zone is every id BEFORE it in
        //   that array. Zone cards dropped by the lock rules (placeholder slots, fully locked
        //   images) never reach the list, so an all-hidden zone shows no divider.
        // No marker / no sentinel → undefined → no divider, list unchanged.
        let zoneIds: Set<string> | undefined;
        if (!enforceLocks) {
          const marker = imgBoxes.find(b => b.placeholder && !b.url);
          if (marker) zoneIds = new Set([marker.id]);
        } else {
          const bottomToTop = s.layerOrderIds ?? [];
          const sentinelAt = bottomToTop.indexOf(IMAGES_LAYER_ID);
          if (sentinelAt > 0) zoneIds = new Set(bottomToTop.slice(0, sentinelAt));
        }

        // Per-type image labels (numbered when >1 of a type), matching the canvas layer panel.
        const imgTypeOf = (b: ImageBox) => b.videoUrl ? 'Video' : b.isOverlay ? 'Overlay' : b.glow ? 'Light leak' : 'Image';
        const imgTypeCounts: Record<string, number> = {};
        imgBoxes.forEach(b => { const t = imgTypeOf(b); imgTypeCounts[t] = (imgTypeCounts[t] ?? 0) + 1; });
        const imgSeen: Record<string, number> = {};
        const imgLabelByIndex = imgBoxes.map(b => {
          const t = imgTypeOf(b); imgSeen[t] = (imgSeen[t] ?? 0) + 1;
          return imgTypeCounts[t] > 1 ? `${t} ${imgSeen[t]}` : t;
        });

        const items: LayerItem[] = [];
        for (const layer of frontToBack) {
          if (layer.kind === 'fade') continue;   // fade is added once, unconditionally, below
          const kind = layer.kind;   // narrowed to 'image' | 'text' | 'chart'
          const arr: Array<{ id: string; name?: string; hidden?: boolean; locked?: boolean }> =
            kind === 'image' ? imgBoxes : kind === 'chart' ? chartBoxes : textBoxes;
          const index = arr.findIndex(e => e.id === layer.id);
          if (index < 0) continue;
          // POSTS: an image slot (placeholder) or a fully locked image box has nothing a post can
          // change in the panel — no card at all. The canvas still renders it (and handles slot
          // fill via drag/paste); selecting it there simply expands nothing here.
          if (kind === 'image' && !postImageCardVis(imgBoxes[index])) continue;
          const el = arr[index];
          const derivedTitle = kind === 'image' ? (imgLabelByIndex[index] ?? 'Image')
            : kind === 'chart' ? `Chart · ${chartBoxes[index].artistName || 'Artist'}`
            : ((textBoxes[index].text || 'Text').split('\n')[0] || 'Text');
          // Custom layer name wins; otherwise the derived title (text preview / "Image N" / chart artist).
          const title = el.name?.trim() || derivedTitle;
          items.push({
            key: layer.id,
            layerId: layer.id,
            title,
            onRename: v => renameElement(kind, index, v),
            open: selectedElement?.kind === kind && selectedElement.index === index,
            onToggle: next => onSelectElement?.(next ? { kind, index } : null),
            hidden: !!el.hidden,
            leftIcons: (
              <>
                <LayerEye hidden={!!el.hidden} onToggle={() => flipFlag(kind, index, 'hidden')} />
                {/* Template-lock padlock — text/image boxes only (charts have no lockedProps) */}
                {kind !== 'chart' && (
                  <LayerLock
                    state={elementLockState(
                      (kind === 'text' ? textBoxes[index] : imgBoxes[index])?.lockedProps,
                      kind === 'text' ? TEXT_LOCK_PRESET : IMAGE_LOCK_PRESET,
                    )}
                    readOnly={enforceLocks}
                    unlockedTitle={kind === 'text'
                      ? "Lock this layer's style for posts (text stays editable)"
                      : "Lock this layer's style for posts (placeholder stays fillable)"}
                    onClick={() => toggleElementLock(kind, index)}
                  />
                )}
              </>
            ),
            // Overlays in posts are drag + hide only: no disclosure, no body.
            ...(kind === 'image' && postOverlayInert(imgBoxes[index])
              ? { noToggle: true }
              : { content: renderElementBody(kind, index) }),
          });
        }

        // Fade — always a single expandable card (grip + eye + chevron), whether or not it's currently
        // enabled; its body holds the on/off toggles + Floor/Reach/Intensity for both edges. When enabled,
        // FADE_LAYER_ID sits in `order` at its z-position; when off its id isn't in `order` so it sorts last.
        // POSTS: locked knobs hide; an edge group with nothing left to show is dropped whole, and the
        // card itself only renders while at least one fade control survives its locks.
        if (fadeIslandVis) items.push({
          key: FADE_LAYER_ID,
          layerId: FADE_LAYER_ID,
          title: 'Fade',
          hidden: !!s.fadeHidden,
          leftIcons: (
            <>
              <LayerEye hidden={!!s.fadeHidden} onToggle={() => onChange({ fadeHidden: !s.fadeHidden })} />
              {/* Slide-level padlock: the whole FADE settings group in lockedSettings */}
              <LayerLock
                state={groupLockState(s.lockedSettings, FADE_LOCK_GROUP)}
                readOnly={enforceLocks}
                unlockedTitle="Lock this layer's style for posts"
                onClick={() => toggleGroupLock(FADE_LOCK_GROUP)}
              />
            </>
          ),
          content: (
            <>
              {/* Bottom fade — a locked knob is hidden (posts mode); an all-locked group drops whole */}
              {bottomFadeVis && (
              <div className="flex flex-col gap-2">
                <LockWrap locked={settingLocked('showFade')}><ToggleSwitch label="Bottom fade" checked={s.showFade} onChange={v => onChange({ showFade: v })} /></LockWrap>
                {s.showFade && (
                  <>
                    {/* Floor is moot when the fade is anchored to a text box's top edge — hidden then. */}
                    {!s.fadeFloorAnchor && (
                      <LockWrap locked={settingLocked('fadeFloor')}><Slider label="Floor"     value={s.fadeFloor}     onChange={v => onChange({ fadeFloor: v })} /></LockWrap>
                    )}
                    <LockWrap locked={settingLocked('fadeReach')}><Slider label="Reach"     value={s.fadeReach}     onChange={v => onChange({ fadeReach: v })} /></LockWrap>
                    <LockWrap locked={settingLocked('fadeIntensity')}><Slider label="Intensity" value={s.fadeIntensity} onChange={v => onChange({ fadeIntensity: v })} /></LockWrap>
                  </>
                )}
              </div>
              )}

              {bottomFadeVis && topFadeVis && <div className="h-px bg-surface-2 my-1" />}

              {/* Top fade */}
              {topFadeVis && (
              <div className="flex flex-col gap-2">
                <LockWrap locked={settingLocked('showTopFade')}><ToggleSwitch label="Top fade" checked={s.showTopFade} onChange={v => onChange({ showTopFade: v })} /></LockWrap>
                {s.showTopFade && (
                  <>
                    <LockWrap locked={settingLocked('topFadeFloor')}><Slider label="Floor"     value={s.topFadeFloor     ?? 20} onChange={v => onChange({ topFadeFloor: v })} /></LockWrap>
                    <LockWrap locked={settingLocked('topFadeReach')}><Slider label="Reach"     value={s.topFadeReach     ?? 40} onChange={v => onChange({ topFadeReach: v })} /></LockWrap>
                    <LockWrap locked={settingLocked('topFadeIntensity')}><Slider label="Intensity" value={s.topFadeIntensity ?? 85} onChange={v => onChange({ topFadeIntensity: v })} /></LockWrap>
                  </>
                )}
              </div>
              )}
              {/* Delete the fade LAYER (posts: only when the template didn't lock the
                  fade group). Clears both edges and drops the sentinel from the
                  z-order so nothing reserves a slot; re-add it from the rail. */}
              {!enforceLocks && (
                <button
                  type="button"
                  onClick={() => onRemoveFade?.()}
                  className="mt-1 w-full h-8 rounded-md text-micro text-danger bg-surface border border-separator hover:border-danger hover:text-danger transition-colors"
                >Remove fade</button>
              )}
            </>
          ),
        });

        // Template-locked z-order: posts follow the template's layer layout — the template's
        // cards can't reorder (grips hidden). The post's OWN images (the Image Layer zone)
        // still drag freely among themselves: the lock fixes the template's layout and the
        // zone's slot in it, not the post's stacking inside the zone.
        const orderLocked = settingLocked('layerOrderIds');
        const zoneRowCount = zoneIds ? items.reduce((n, it) => n + (it.layerId && zoneIds.has(it.layerId) ? 1 : 0), 0) : 0;
        const zoneDrag = orderLocked && enforceLocks && zoneRowCount > 1 ? zoneIds : undefined;
        // Merge a reorder into the SAVED array: only ids the panel displays (optionally further
        // restricted to the zone) change slots; sentinels (__images__), ghost ids and lock-hidden
        // cards keep their exact positions — a panel reorder can never disturb or drop them.
        const applyReorder = (ftb: string[], restrict?: ReadonlySet<string>) => {
          const inPanel = new Set(ftb);
          const managed = (id: string) => inPanel.has(id) && (!restrict || restrict.has(id));
          const saved = s.layerOrderIds ?? [];
          const wanted = [...ftb].reverse().filter(managed);   // bottom→top
          let wi = 0;
          const merged = saved.map(id => managed(id) ? (wanted[wi++] ?? id) : id);
          for (; wi < wanted.length; wi++) merged.push(wanted[wi]);   // panel rows not saved yet → append on top
          onChange({ layerOrderIds: merged });
        };
        return (
          <LayerSectionList
            items={orderLocked ? items.map(it => ({ ...it, dragDisabled: !(zoneDrag && it.layerId && zoneDrag.has(it.layerId)) })) : items}
            order={order}
            zoneIds={zoneIds}
            dragZone={zoneDrag}
            onOrderChange={orderLocked
              ? (zoneDrag ? ftb => applyReorder(ftb, zoneDrag) : undefined)
              : enforceLocks ? ftb => applyReorder(ftb) : ftb => onChange({ layerOrderIds: [...ftb].reverse() })}
          />
        );
      })()}

      {/* Divider — separates the fused layer list from the global settings below
          (Canvas Colour, etc.), matching digitalestate2. Skipped in posts when either side
          of it has nothing to show. */}
      {anyLayerCardVis && (canvasIslandVis || hasDividerCards || hasQuoteCards || hasSwipeCards) && (
        <div className="h-px bg-separator" aria-hidden="true" />
      )}

      {/* Canvas Colour — global page setting, pinned to the top above all element/section controls, with
          a divider separating it from the rest. Collapsed by default. POSTS: dropped whole once the
          template's locks leave neither the fill mode nor the colour swatch editable. */}
      {canvasIslandVis && (
      <CollapsibleSection
        title="Canvas Colour"
        leftIcons={
          /* Slide-level padlock: the CANVAS COLOUR settings group in lockedSettings */
          <LayerLock
            state={groupLockState(s.lockedSettings, CANVAS_LOCK_GROUP)}
            readOnly={enforceLocks}
            unlockedTitle="Lock the canvas colour for posts"
            onClick={() => toggleGroupLock(CANVAS_LOCK_GROUP)}
          />
        }
      >
        {/* Fill mode: colour vs transparent. Switching to transparent keeps the chosen
            colour so the user can flick back on/off losslessly. Flipping transparency also
            changes the background, so a canvasColor lock freezes the fill mode too. */}
        <LockWrap locked={settingLocked('canvasTransparent') || settingLocked('canvasColor')}>
        <SegmentedControl<'colour' | 'transparent'>
          label="Fill"
          value={s.canvasTransparent ? 'transparent' : 'colour'}
          options={[
            { value: 'colour', label: 'Colour' },
            {
              value: 'transparent',
              title: 'Transparent background',
              label: (
                <span className="flex items-center gap-1.5">
                  <span
                    className="w-3.5 h-3.5 rounded-sm border border-separator"
                    style={{
                      backgroundColor: '#ffffff',
                      backgroundImage: 'linear-gradient(45deg,#ccc 25%,transparent 25%,transparent 75%,#ccc 75%),linear-gradient(45deg,#ccc 25%,transparent 25%,transparent 75%,#ccc 75%)',
                      backgroundSize: '6px 6px', backgroundPosition: '0 0,3px 3px',
                    }}
                  />
                  Transparent
                </span>
              ),
            },
          ]}
          onChange={v => v === 'transparent' ? onChange({ canvasTransparent: true }) : onChange({ canvasTransparent: false })}
        />
        </LockWrap>
        {/* Colour swatch — opens the native picker (hidden input anchored by the ref). While transparent,
            clicking it flips transparency off, so a canvasTransparent lock freezes it in that state too. */}
        <LockWrap locked={settingLocked('canvasColor') || (!!s.canvasTransparent && settingLocked('canvasTransparent'))}>
        <div className="relative flex items-center justify-between gap-2">
          <ControlLabel>Colour</ControlLabel>
          <div className="relative flex items-center gap-2 shrink-0">
            <span className="text-micro text-label-quaternary tabular-nums uppercase">{s.canvasColor ?? '#000000'}</span>
            <button
              onClick={() => { if (s.canvasTransparent) onChange({ canvasTransparent: false }); else canvasColorInputRef.current?.click(); }}
              title={s.canvasTransparent ? 'Use the solid colour' : 'Change colour'}
              aria-label={`Canvas colour: ${s.canvasColor ?? '#000000'}`}
              className="w-7 h-7 rounded-md border border-separator hover:border-label-quaternary transition-colors"
              style={{ backgroundColor: s.canvasColor ?? '#000000' }}
            />
            {/* Hidden native picker, anchored under the colour swatch; only opens via the button above */}
            <input
              ref={canvasColorInputRef}
              type="color"
              value={s.canvasColor ?? '#000000'}
              onChange={e => onChange({ canvasColor: e.target.value, canvasTransparent: false })}
              tabIndex={-1}
              aria-hidden
              className="absolute right-0 top-0 w-7 h-7 opacity-0 pointer-events-none"
            />
          </div>
        </div>
        </LockWrap>
      </CollapsibleSection>
      )}

      {/* Caption — PER SLIDE: each slide carries its own (SlideRow.caption), and
          a carousel publish uses slide 1's. Bound to the active slide via
          editor.updateSlide, so it rides the editor's autosave/undo like the
          headline. Same value the CLI's set-caption --slide writes. */}
      {postCaption && (<>
      {/* Divider — the caption belongs to the SLIDE in both modes (templates carry
          the default that posts inherit), so it gets its own group, same separator
          as the layers/globals split. */}
      <div className="h-px bg-separator" aria-hidden="true" />
      <CollapsibleSection title="Caption" defaultOpen={false}>
        {/* Template mode explains the consequence of typing here, because it is not
            obvious that filling this field takes the caption away from every post. */}
        {postCaption.isTemplate && (
          <p className="text-micro text-label-tertiary leading-relaxed">
            Fill this in and every post from this template gets it, locked. Leave it blank and posts write their own.
          </p>
        )}
        {postCaption.locked && (
          <p className="text-micro text-label-tertiary leading-relaxed flex items-center gap-1">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
            Set by the template — edit it there to change it.
          </p>
        )}
        <textarea
          value={postCaption.value}
          onChange={e => postCaption.onChange(e.target.value.slice(0, postCaption.max))}
          disabled={postCaption.loading || postCaption.locked}
          readOnly={postCaption.locked}
          rows={7}
          maxLength={postCaption.max}
          placeholder={postCaption.loading ? 'Loading…' : postCaption.isTemplate
            ? 'Caption every post inherits… (leave blank to let posts write their own)'
            : 'Caption for this slide… (slide 1\u2019s publishes with the carousel)'}
          aria-label={postCaption.isTemplate ? 'Template caption' : 'Post caption'}
          className="w-full rounded-md bg-surface-1 border border-separator px-2.5 py-2 text-footnote text-label placeholder:text-label-quaternary leading-relaxed resize-y focus:outline-none focus:ring-2 focus:ring-focus disabled:opacity-50"
        />
        <div className="flex items-center justify-between">
          {/* Live count against the 2199 cap (one under Instagram's 2200) */}
          <span className={`text-micro tabular-nums ${postCaption.value.length > postCaption.max - 100 ? 'text-warning' : 'text-label-quaternary'}`}>
            {postCaption.value.length.toLocaleString()} / {postCaption.max.toLocaleString()}
          </span>
          {/* clipboard.writeText has no CSV semantics — unlike copying a Sheets
              cell, this can never wrap the text in quotes. */}
          <button
            type="button"
            onClick={() => { void navigator.clipboard.writeText(postCaption.value); }}
            disabled={postCaption.loading || postCaption.value.length === 0}
            title="Copy the caption to the clipboard"
            className="h-6 px-2 inline-flex items-center gap-1 rounded-md text-caption-sm font-medium text-label-tertiary hover:text-label hover:bg-surface-2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
            Copy
          </button>
        </div>
      </CollapsibleSection>
      </>)}

      {SHOW_BASE_SECTIONS && <>
      {/* Logo */}
      <CollapsibleSection title="Logo" defaultOpen>
        <Slider label="Opacity"        value={s.logoOpacity ?? 100}      onChange={v => onChange({ logoOpacity: v })} />
        <Slider label="Scale"          value={s.logoScale ?? 100}  min={10} max={200} unit="%" onChange={v => onChange({ logoScale: v })} />
        <Slider label="Corner Radius"  value={s.logoCornerRadius ?? 0} min={0} max={200} unit="px" onChange={v => onChange({ logoCornerRadius: v })} />
        <ShadowEditor value={s.logoShadow} onChange={v => onChange({ logoShadow: v })} />
      </CollapsibleSection>

      {/* Layout */}
      <CollapsibleSection title="Layout" defaultOpen={false}>
        <Slider label="Head / Sub Gap" value={s.headSubGap}     min={0} max={100} onChange={v => onChange({ headSubGap: v })} />
        <Slider label="Heading top padding" value={s.aboveLogoGap} min={0} max={50} unit="px" onChange={v => onChange({ aboveLogoGap: v })} />
        <Slider label="Content padding" value={s.contentPadding} min={0} max={100} onChange={v => onChange({ contentPadding: v })} />
      </CollapsibleSection>
      </>}

      {/* Background — hidden in video mode */}
      {SHOW_BASE_SECTIONS && !videoMode && (
        <CollapsibleSection title="Background" defaultOpen={false}>
          <Slider label="Darken" value={s.bgDarkenAmount} min={0} max={100} onChange={v => onChange({ bgDarkenAmount: v })} />
          {s.bgBlurEnabled && (
            <Slider label="Blur Amount" value={s.bgBlurAmount} min={1} max={30} unit="px" onChange={v => onChange({ bgBlurAmount: v })} />
          )}
        </CollapsibleSection>
      )}

      {SHOW_BASE_SECTIONS && <>
      {/* Headline */}
      <CollapsibleSection title="Headline" defaultOpen={false}>
        <ColourSwatch label="Colour" value={s.headlineColor ?? '#ffffff'} onChange={c => onChange({ headlineColor: c })} />
        <Slider label="Size"   value={s.fontSize}  min={1} max={MAX_FONT} unit="px" onChange={v => onChange({ fontSize: v })} />
        <Slider label="Letter spacing" value={s.lSpacing}  onChange={v => onChange({ lSpacing: v })} />
        <Slider label="Line spacing"   value={s.lHeight}   onChange={v => onChange({ lHeight: v })} />
        <FontDropdown value={s.fontLabel} onChange={v => onChange({ fontLabel: v })} />
        <WeightPicker fontLabel={s.fontLabel} value={s.fontWeight} onChange={w => onChange({ fontWeight: w })} className="flex gap-1 flex-wrap" />
        <StyleRow
          italic={s.italic}   onItalic={() => onChange({ italic: !s.italic })}
          allCaps={s.allCaps} onAllCaps={() => onChange({ allCaps: !s.allCaps })}
          align={s.textAlign} onAlign={v => onChange({ textAlign: v })}
        />
        {s.headlineSpans && s.headlineSpans.length > 0 && (
          <button
            onClick={() => onChange({ headlineSpans: null })}
            className="w-full text-left text-micro text-label-tertiary hover:text-label-secondary transition-colors py-0.5"
          >
            ✕ Clear custom text styles
          </button>
        )}
        <ShadowEditor value={s.headlineShadow} onChange={v => onChange({ headlineShadow: v })} />
      </CollapsibleSection>

      {/* Sub-headline */}
      <CollapsibleSection title="Sub-headline" defaultOpen={false}>
        <ColourSwatch label="Colour" value={s.subheadlineColor ?? '#ffffff'} onChange={c => onChange({ subheadlineColor: c })} />
        <Slider label="Size"   value={s.subFontSize}  min={1} max={SUB_MAX} unit="px" onChange={v => onChange({ subFontSize: v })} />
        <Slider label="Letter spacing" value={s.subLSpacing}  onChange={v => onChange({ subLSpacing: v })} />
        <Slider label="Line spacing"   value={s.subLHeight}   onChange={v => onChange({ subLHeight: v })} />
        <FontDropdown value={s.subFontLabel} onChange={v => onChange({ subFontLabel: v })} />
        <WeightPicker fontLabel={s.subFontLabel} value={s.subFontWeight} onChange={w => onChange({ subFontWeight: w })} className="flex gap-1 flex-wrap" />
        <StyleRow
          italic={s.subItalic}   onItalic={() => onChange({ subItalic: !s.subItalic })}
          allCaps={s.subAllCaps} onAllCaps={() => onChange({ subAllCaps: !s.subAllCaps })}
          align={s.subTextAlign} onAlign={v => onChange({ subTextAlign: v })}
        />
        {s.subSpans && s.subSpans.length > 0 && (
          <button
            onClick={() => onChange({ subSpans: null })}
            className="w-full text-left text-micro text-label-tertiary hover:text-label-secondary transition-colors py-0.5"
          >
            ✕ Clear custom text styles
          </button>
        )}
        <ShadowEditor value={s.subShadow} onChange={v => onChange({ subShadow: v })} />
      </CollapsibleSection>
      </>}

      {/* Tags */}
      {SHOW_TAGS_SECTION && (
      <CollapsibleSection title="Tags" defaultOpen>
        {(s.tagSlots ?? []).some(t => t !== null) || (s.tagZoneSlots ?? []).some(t => t !== null) ? (
          <div className="flex flex-col gap-1.5">
            {(s.tagSlots ?? []).map((tagSlot, idx) => {
              if (!tagSlot) return null;
              return (
                <TagSlotEditor
                  key={`slot-${idx}`}
                  idx={idx}
                  tagSlot={tagSlot}
                  onChange={newSlot => {
                    const next = [...(s.tagSlots ?? Array(6).fill(null))];
                    next[idx] = newSlot;
                    onChange({ tagSlots: next });
                  }}
                  onRemove={() => {
                    const next = [...(s.tagSlots ?? Array(6).fill(null))];
                    next[idx] = null;
                    onChange({ tagSlots: next });
                  }}
                />
              );
            })}
            {(s.tagZoneSlots ?? []).map((tagSlot, idx) => {
              if (!tagSlot) return null;
              return (
                <TagSlotEditor
                  key={`zone-${idx}`}
                  idx={idx}
                  label={ZONE_LABELS[idx]}
                  tagSlot={tagSlot}
                  onChange={newSlot => {
                    const next = [...(s.tagZoneSlots ?? Array(9).fill(null))];
                    next[idx] = newSlot;
                    onChange({ tagZoneSlots: next });
                  }}
                  onRemove={() => {
                    const next = [...(s.tagZoneSlots ?? Array(9).fill(null))];
                    next[idx] = null;
                    onChange({ tagZoneSlots: next });
                  }}
                />
              );
            })}
          </div>
        ) : (
          <p className="text-micro text-label-quaternary italic">No tags placed yet — add one from the + button on the canvas</p>
        )}
      </CollapsibleSection>
      )}

      {/* Dividers */}
      {(s.dividerSlots ?? []).some(d => d !== null) && (
        <CollapsibleSection title="Dividers" defaultOpen>
          <div className="flex flex-col gap-1.5">
            {(s.dividerSlots ?? []).map((divId, idx) => {
              if (!divId) return null;
              const ds = s.dividerSettings?.[idx] ?? null;
              return (
                <DividerSlotEditor
                  key={idx}
                  idx={idx}
                  divId={divId}
                  ds={ds}
                  subSlot={s.dividerSubSlots?.[idx] ?? null}
                  onSubChange={c => {
                    const next = [...(s.dividerSubSlots ?? Array(3).fill(null))];
                    next[idx] = c;
                    onChange({ dividerSubSlots: next });
                  }}
                  onChange={newDs => {
                    const next = [...(s.dividerSettings ?? Array(3).fill(null))];
                    next[idx] = newDs;
                    onChange({ dividerSettings: next });
                  }}
                  onRemove={() => {
                    const nextSlots = [...(s.dividerSlots ?? Array(3).fill(null))];
                    const nextSubs  = [...(s.dividerSubSlots ?? Array(3).fill(null))];
                    const nextSets  = [...(s.dividerSettings ?? Array(3).fill(null))];
                    nextSlots[idx] = null;
                    nextSubs[idx]  = null;
                    nextSets[idx]  = null;
                    onChange({ dividerSlots: nextSlots, dividerSubSlots: nextSubs, dividerSettings: nextSets });
                  }}
                />
              );
            })}
          </div>
        </CollapsibleSection>
      )}

      {/* Quotation Marks */}
      {((s.quoteSlots ?? []).some(q => q !== null) || (s.quoteZoneSlots ?? []).some(q => q !== null)) && (
        <CollapsibleSection title="Quotation Marks">
          <div className="flex flex-col gap-3">
            {/* Style grid — shows active slots with swap button */}
            <div className="flex flex-col gap-1.5">
              {(s.quoteSlots ?? []).map((styleId, idx) => {
                if (!styleId) return null;
                const qs = QUOTE_STYLES.find(q => q.id === styleId);
                return (
                  <div key={`slot-${idx}`} className="flex items-center gap-2 rounded-lg bg-surface border border-separator px-2.5 py-2">
                    <span className="text-micro text-label-tertiary w-16 shrink-0">{['Top Left','Top Ctr','Top Right','Bot Left','Bot Ctr','Bot Right'][idx]}</span>
                    {qs && (
                      <svg viewBox={qs.viewBox.join(' ')} style={{ width: 18, height: 18, fill: s.quoteColor ?? '#ffffff', flexShrink: 0 }}>
                        {qs.paths.map((d, pi) => <path key={pi} d={d} />)}
                      </svg>
                    )}
                    <span className="text-micro text-label-tertiary flex-1">{qs?.label ?? styleId}</span>
                    <button
                      onClick={() => {
                        const next = [...(s.quoteSlots ?? Array(6).fill(null))];
                        next[idx] = null;
                        onChange({ quoteSlots: next });
                      }}
                      className="text-label-quaternary hover:text-danger transition-colors text-xs"
                    >×</button>
                  </div>
                );
              })}
              {(s.quoteZoneSlots ?? []).map((styleId, idx) => {
                if (!styleId) return null;
                const qs = QUOTE_STYLES.find(q => q.id === styleId);
                return (
                  <div key={`zone-${idx}`} className="flex items-center gap-2 rounded-lg bg-surface border border-separator px-2.5 py-2">
                    <span className="text-micro text-label-tertiary w-16 shrink-0">{ZONE_LABELS[idx]}</span>
                    {qs && (
                      <svg viewBox={qs.viewBox.join(' ')} style={{ width: 18, height: 18, fill: s.quoteColor ?? '#ffffff', flexShrink: 0 }}>
                        {qs.paths.map((d, pi) => <path key={pi} d={d} />)}
                      </svg>
                    )}
                    <span className="text-micro text-label-tertiary flex-1">{qs?.label ?? styleId}</span>
                    <button
                      onClick={() => {
                        const next = [...(s.quoteZoneSlots ?? Array(9).fill(null))];
                        next[idx] = null;
                        onChange({ quoteZoneSlots: next });
                      }}
                      className="text-label-quaternary hover:text-danger transition-colors text-xs"
                    >×</button>
                  </div>
                );
              })}
            </div>
            {/* Shared color / size / opacity */}
            <ColourSwatch label="Colour" value={s.quoteColor ?? '#ffffff'} onChange={c => onChange({ quoteColor: c })} />
            <Slider label="Size" value={s.quoteSize ?? 120} min={20} max={400} unit="px"
              onChange={v => onChange({ quoteSize: v })} />
            <Slider label="Opacity" value={s.quoteOpacity ?? 100}
              onChange={v => onChange({ quoteOpacity: v })} />
            {((s.quoteSlots ?? []).some(id => id?.endsWith('-pair')) || (s.quoteZoneSlots ?? []).some(id => id?.endsWith('-pair'))) && (
              <Slider label="Pair Gap" value={s.quoteGap ?? 8} min={0} max={80} unit="px"
                onChange={v => onChange({ quoteGap: v })} />
            )}
            <ShadowEditor value={s.quoteShadow} onChange={v => onChange({ quoteShadow: v })} />
          </div>
        </CollapsibleSection>
      )}

      {/* Swipe elements */}
      {(s.swipeZoneSlots ?? []).some(sw => sw !== null) && (
        <CollapsibleSection title="Swipe">
          <div className="flex flex-col gap-1.5">
            {(s.swipeZoneSlots ?? []).map((sw, fi) => {
              if (!sw) return null;
              return (
                <SwipeZoneEditor
                  key={fi}
                  fi={fi}
                  style={sw}
                  onChange={newStyle => {
                    const next = [...(s.swipeZoneSlots ?? Array(9).fill(null))];
                    next[fi] = newStyle;
                    onChange({ swipeZoneSlots: next });
                  }}
                  onRemove={() => {
                    const next = [...(s.swipeZoneSlots ?? Array(9).fill(null))];
                    next[fi] = null;
                    onChange({ swipeZoneSlots: next });
                  }}
                />
              );
            })}
          </div>
        </CollapsibleSection>
      )}

      </div>
      </div>
    </div>
  );
}
