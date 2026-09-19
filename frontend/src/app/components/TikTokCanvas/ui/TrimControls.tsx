'use client';

import type { RefObject, MutableRefObject } from 'react';
import { CANVAS_W, DISPLAY_SCALE } from '../constants';

function fmt(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

interface TrimControlsProps {
  videoDuration: number;
  trimStart: number;
  trimEnd: number;
  currentTime: number;
  videoRef: RefObject<HTMLVideoElement | null>;
  trimStartRef: MutableRefObject<number>;
  trimEndRef: MutableRefObject<number>;
  setTrimStart: (v: number) => void;
  setTrimEnd: (v: number) => void;
}

export function TrimControls({
  videoDuration, trimStart, trimEnd, currentTime,
  videoRef, trimStartRef, trimEndRef, setTrimStart, setTrimEnd,
}: TrimControlsProps) {
  if (videoDuration <= 0) return null;

  const startPct = (trimStart / videoDuration) * 100;
  const endPct = (trimEnd / videoDuration) * 100;
  const curPct = Math.min((currentTime / videoDuration) * 100, 100);

  return (
    <div className="flex flex-col gap-1.5 px-1" style={{ width: CANVAS_W * DISPLAY_SCALE }}>
      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold text-zinc-400">Trim</span>
        <span className="text-zinc-400">{fmt(trimStart)} – {fmt(trimEnd)}</span>
        <span className="text-zinc-600">{fmt(trimEnd - trimStart)}</span>
      </div>
      <div className="relative h-6 flex items-center">
        <div className="absolute inset-x-0 h-1.5 rounded-full bg-zinc-700" />
        <div
          className="absolute h-1.5 rounded-full bg-[#fe2c55]"
          style={{ left: `${startPct}%`, right: `${100 - endPct}%` }}
        />
        <div
          className="absolute w-px h-4 bg-white/50 pointer-events-none"
          style={{ left: `${curPct}%` }}
        />
        <input
          type="range" min={0} max={videoDuration} step={0.1} value={trimStart}
          onChange={e => {
            const val = Math.min(parseFloat(e.target.value), trimEndRef.current - 0.5);
            trimStartRef.current = val;
            setTrimStart(val);
            const v = videoRef.current;
            if (v) v.currentTime = val;
          }}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          style={{ zIndex: startPct >= endPct / 2 ? 3 : 1 }}
        />
        <input
          type="range" min={0} max={videoDuration} step={0.1} value={trimEnd}
          onChange={e => {
            const val = Math.max(parseFloat(e.target.value), trimStartRef.current + 0.5);
            trimEndRef.current = val;
            setTrimEnd(val);
          }}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          style={{ zIndex: startPct >= endPct / 2 ? 1 : 3 }}
        />
        <div
          className="absolute w-3.5 h-3.5 -translate-x-1/2 rounded-full bg-white border-2 border-[#fe2c55] shadow pointer-events-none z-10"
          style={{ left: `${startPct}%` }}
        />
        <div
          className="absolute w-3.5 h-3.5 -translate-x-1/2 rounded-full bg-white border-2 border-[#fe2c55] shadow pointer-events-none z-10"
          style={{ left: `${endPct}%` }}
        />
      </div>
      <div className="flex justify-between text-[10px] text-zinc-600">
        <span>0:00</span>
        <span>{fmt(videoDuration)}</span>
      </div>
      <button
        onClick={() => {
          trimStartRef.current = 0;
          trimEndRef.current = videoDuration;
          setTrimStart(0);
          setTrimEnd(videoDuration);
          const v = videoRef.current;
          if (v) v.currentTime = 0;
        }}
        className="self-center text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors"
      >
        Reset trim
      </button>
    </div>
  );
}
