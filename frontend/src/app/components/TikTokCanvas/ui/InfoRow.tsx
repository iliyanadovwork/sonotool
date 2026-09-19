import type { Box } from '../types';

interface InfoRowProps {
  box: Box;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onReset: () => void;
  onCenter: () => void;
}

export function InfoRow({ box, isPlaying, onTogglePlay, onReset, onCenter }: InfoRowProps) {
  return (
    <div className="flex items-center gap-1.5 text-[10px] text-zinc-600">
      <span>{Math.round(box.w)}×{Math.round(box.h)}</span>
      <span>at ({Math.round(box.x)}, {Math.round(box.y)})</span>
      <span>·</span>
      <button
        onClick={onTogglePlay}
        className="text-zinc-500 hover:text-zinc-300 underline underline-offset-2 transition-colors"
      >
        {isPlaying ? 'Pause template preview' : 'Play on template'}
      </button>
      <span>·</span>
      <button
        onClick={onReset}
        className="text-zinc-500 hover:text-zinc-300 underline underline-offset-2 transition-colors"
      >
        Reset
      </button>
      <span>·</span>
      <button
        onClick={onCenter}
        className="text-zinc-500 hover:text-zinc-300 underline underline-offset-2 transition-colors"
      >
        Center
      </button>
    </div>
  );
}
