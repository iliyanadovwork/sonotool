import type { CircleFrame } from '@/lib/circleFrame';

// Reel flavours. 'comparison' is the original index chart. 'profit' plots both series as
// PERFECT TRADING: the value of $1,000 that bought every dip and sold every peak — applied
// identically to the artist's index and the real S&P 500.
export type ReelType = 'comparison' | 'profit';

// The S&P 500 pseudo-market id (its sparkline is real index closes, not Google Trends).
export const SP500_ID = '__sp500__';

export interface SparkPoint { value: number; timestamp: number }

export interface ChartsMarket {
  id: string;
  name: string;
  ticker: string;
  photo_url: string | null;
  industry: string | null;
  sparkline?: SparkPoint[];
  frame?: CircleFrame | null;
}

export interface ChartsCanvasProps {
  overlayCaption: string;
  /** Font size of the chart headline (the faint caption drawn over the chart area). */
  captionFontSize?: number;
  bannerText?: string;
  bannerFontSize?: number;
  /** 0–100 moving-average strength (same control as the landing animation). */
  smoothing?: number;
  reelType?: ReelType;
  /** Profit reels: scales the artist's portfolio value (any × / ÷ factor, default 1). */
  artistMultiplier?: number;
  /** Profit reels: true = artist is $100/mo DCA'd into the CUMULATIVE index (default);
   *  false = DCA straight on the raw Google Trends index (no floor). */
  profitCumulative?: boolean;
  markets: [ChartsMarket | null, ChartsMarket | null];
  overrideNames?: [string, string];
  onRecordingStateChange?: (state: { isRecording: boolean; recProgress: number; recStatus: string }) => void;
  audioUrl?: string;
  audioDurationMs?: number;
  /** Explicit target video length; takes priority over the audio track's duration. */
  videoLengthMs?: number;
}

export interface ChartsCanvasRef {
  startDownload: () => Promise<void>;
  /** Render the reel to an MP4 blob without downloading (for publishing). Null on failure. */
  exportBlob: () => Promise<Blob | null>;
  cancelExport: () => void;
  /** Restart the preview animation from the beginning (no-op while exporting). */
  replay: () => void;
  getTrimState: () => { trimStart: number; trimEnd: number; duration: number; includeEdit: boolean; videoScale: number; blockTopPct: number };
}

export interface VideoTrimState { trimStart: number; trimEnd: number; duration: number; includeEdit: boolean; videoScale: number; blockTopPct: number }
