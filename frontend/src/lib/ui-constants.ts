/** Icon-only square button (36px) — semantic-token dark toolbar style. */
export const BTN_ICON =
  'flex items-center justify-center w-9 h-9 rounded-md bg-surface border border-separator text-label-tertiary hover:text-label-secondary hover:border-label-quaternary transition-colors ease-out disabled:opacity-40 disabled:cursor-not-allowed';

/** Text/label toolbar button with horizontal padding — semantic-token dark style. */
export const BTN_TEXT =
  'flex items-center gap-1 h-9 px-2.5 rounded-md text-caption-sm font-medium border transition-colors ease-out disabled:opacity-40 disabled:cursor-not-allowed';

/** Inline style object for the dot-grid page background */
export const GRID_BG_STYLE: React.CSSProperties = {
  backgroundImage:
    'linear-gradient(rgba(255,255,255,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.07) 1px, transparent 1px)',
  backgroundSize: '96px 96px',
};
