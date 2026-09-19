'use client';

import { CANVAS_W, DISPLAY_SCALE } from '../constants';

interface IncludeEditToggleProps {
  includeEdit: boolean;
  onToggle: () => void;
}

export function IncludeEditToggle({ includeEdit, onToggle }: IncludeEditToggleProps) {
  return (
    <div className="flex items-center gap-3" style={{ width: CANVAS_W * DISPLAY_SCALE }}>
      <span className="text-xs text-zinc-400 select-none">Include edit</span>
      <button
        onClick={onToggle}
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
          includeEdit ? 'bg-[#fe2c55]' : 'bg-zinc-700'
        }`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${
            includeEdit ? 'translate-x-4' : 'translate-x-0.5'
          }`}
        />
      </button>
      {includeEdit && (
        <span className="text-[10px] text-zinc-500">edit.mp4 appended on export</span>
      )}
    </div>
  );
}
