interface RecordingProgressProps {
  isRecording: boolean;
  recProgress: number;
  recStatus: string;
  onCancel: () => void;
  onExport: () => void;
}

export function RecordingProgress({
  isRecording,
  recProgress,
  recStatus,
  onCancel,
  onExport,
}: RecordingProgressProps) {
  if (isRecording) {
    return (
      <div className="w-[270px] space-y-1.5">
        <div className="h-1.5 w-full rounded-full bg-zinc-800 overflow-hidden">
          <div
            className="h-full bg-[#fe2c55] transition-all duration-100"
            style={{ width: `${Math.round(recProgress * 100)}%` }}
          />
        </div>
        <div className="flex justify-between text-xs text-zinc-500">
          <span>{recStatus || `Exporting… ${Math.round(recProgress * 100)}%`}</span>
          <button onClick={onCancel} className="text-red-400 hover:text-red-300 transition-colors">
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      onClick={onExport}
      className="flex items-center gap-2 rounded-lg bg-[#fe2c55] px-5 py-2.5 text-xs font-semibold text-white hover:opacity-90 transition-opacity"
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
        <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2"/>
        <circle cx="12" cy="12" r="4"/>
      </svg>
      Export Cropped Video
    </button>
  );
}
