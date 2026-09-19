'use client';

import React, { useEffect, useRef } from 'react';

/** HIG-correct confirmation for destructive actions (destructive-actions.md /
 *  confirmation-flows.md): role="alertdialog", title + consequence wired via aria,
 *  default focus on the SAFE action (Cancel), Escape cancels, Enter never destroys,
 *  backdrop click cancels. */
export function ConfirmDialog({
  title, message, confirmLabel = 'Delete', cancelLabel = 'Cancel', destructive = true, onConfirm, onCancel,
}: {
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancelRef.current?.focus();
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onCancel(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onCancel}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      aria-describedby="confirm-desc"
    >
      <div
        onClick={e => e.stopPropagation()}
        className="bg-surface-1/95 backdrop-blur-xl rounded-2xl shadow-lg border border-separator w-72 overflow-hidden"
      >
        <div className="px-5 pt-5 pb-4 text-center">
          <h3 id="confirm-title" className="text-body-sm font-semibold text-label mb-1.5">{title}</h3>
          <p id="confirm-desc" className="text-caption-sm text-label-tertiary leading-relaxed">{message}</p>
        </div>
        <div className="grid grid-cols-2 border-t border-separator">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="py-3 text-sm font-medium text-label-secondary hover:bg-surface-2/60 transition-colors border-r border-separator"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`py-3 text-sm font-semibold transition-colors hover:bg-surface-2/60 ${destructive ? 'text-danger' : 'text-tint'}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
