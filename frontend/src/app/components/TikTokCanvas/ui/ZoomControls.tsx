interface ZoomControlsProps {
  scale: number;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onResetZoom: () => void;
  label?: string;
  minScale?: number;
  maxScale?: number;
}

export function ZoomControls({ scale, onZoomOut, onZoomIn, onResetZoom, label, minScale = 0.5, maxScale = 3 }: ZoomControlsProps) {
  return (
    <div className="flex items-center gap-2">
      {label && <span className="text-xs text-zinc-600 font-mono">{label}</span>}
      <button
        onClick={onZoomOut}
        disabled={scale <= minScale}
        className="flex items-center justify-center w-8 h-8 rounded-lg border border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        title="Zoom out"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8"/>
          <path d="M21 21l-4.35-4.35"/>
          <line x1="8" y1="11" x2="14" y2="11"/>
        </svg>
      </button>
      <span className="text-xs text-zinc-500 font-mono w-12 text-center">{Math.round(scale * 100)}%</span>
      <button
        onClick={onZoomIn}
        disabled={scale >= maxScale}
        className="flex items-center justify-center w-8 h-8 rounded-lg border border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        title="Zoom in"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8"/>
          <path d="M21 21l-4.35-4.35"/>
          <line x1="11" y1="8" x2="11" y2="14"/>
          <line x1="8" y1="11" x2="14" y2="11"/>
        </svg>
      </button>
      <button
        onClick={onResetZoom}
        disabled={scale === 1}
        className="flex items-center justify-center w-8 h-8 rounded-lg border border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        title="Reset zoom"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
          <path d="M3 3v5h5"/>
        </svg>
      </button>
    </div>
  );
}
