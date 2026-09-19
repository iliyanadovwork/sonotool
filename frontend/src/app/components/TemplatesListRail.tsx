'use client';

import { useEffect, useRef, useState } from 'react';
import type { TemplateRow, DeletedTemplateRow } from '../hooks/useTemplateEditor';
import { ConfirmDialog } from './ui';

interface TemplatesListRailProps {
  templates: TemplateRow[];
  activeTemplateId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string, name: string) => void;
  onRestore: (id: string) => void;
  deletedTemplates: DeletedTemplateRow[];
  onLoadDeleted: () => void;
  noun?: string;   // 'template' | 'post' — drives the list copy
}

export function TemplatesListRail({
  templates,
  activeTemplateId,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  onRestore,
  deletedTemplates,
  onLoadDeleted,
  noun = 'template',
}: TemplatesListRailProps) {
  const Title = 'Library';   // your saved templates/posts — "Library" disambiguates from the sidebar section name
  const [confirm, setConfirm] = useState<{ id: string; name: string } | null>(null);
  const [showDeleted, setShowDeleted] = useState(false);
  return (
    <aside className="flex flex-col h-full w-full bg-surface">
      <div className="flex items-center justify-between gap-2 px-4 h-14 border-b border-separator shrink-0">
        <h2 className="text-label font-semibold text-label-secondary">{Title}</h2>
        {templates.length > 0 && <span className="text-caption-sm text-label-quaternary tabular-nums">{templates.length}</span>}
      </div>

      {templates.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 px-6 text-center">
          <span className="flex items-center justify-center w-11 h-11 rounded-full bg-surface-1 text-label-tertiary">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
            </svg>
          </span>
          <p className="text-body-sm text-label-secondary">No {noun}s yet</p>
          <p className="text-caption-sm text-label-tertiary leading-snug">Create one to save a design<br />you can reuse.</p>
        </div>
      ) : (
        <ul role="list" className="flex-1 overflow-y-auto px-2 py-2 flex flex-col gap-1">
          {templates.map(t => (
            <li key={t.id}>
              <TemplateCard
                template={t}
                isActive={t.id === activeTemplateId}
                onSelect={() => onSelect(t.id)}
                onRename={name => onRename(t.id, name)}
                onDelete={() => setConfirm({ id: t.id, name: t.name })}
              />
            </li>
          ))}
        </ul>
      )}

      {/* Recently deleted → restore */}
      <div className="border-t border-separator shrink-0">
        <button
          type="button"
          onClick={() => { const next = !showDeleted; setShowDeleted(next); if (next) onLoadDeleted(); }}
          aria-expanded={showDeleted}
          className="w-full flex items-center justify-between px-4 py-2 text-caption-sm text-label-tertiary hover:text-label-secondary transition-colors"
        >
          <span>Recently deleted{deletedTemplates.length ? ` (${deletedTemplates.length})` : ''}</span>
          <span aria-hidden>{showDeleted ? '▾' : '▸'}</span>
        </button>
        {showDeleted && (
          deletedTemplates.length === 0 ? (
            <p className="px-4 pb-2 text-caption-sm text-label-quaternary">Nothing deleted recently.</p>
          ) : (
            <ul role="list" className="px-2 pb-2 flex flex-col gap-0.5 max-h-40 overflow-y-auto">
              {deletedTemplates.map(d => (
                <li key={d.id} className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-md hover:bg-surface-1">
                  <span className="text-body-sm text-label-tertiary truncate" title={d.name}>{d.name}</span>
                  <button
                    type="button"
                    onClick={() => onRestore(d.id)}
                    className="shrink-0 text-caption-sm font-medium text-accent hover:opacity-80"
                  >
                    Restore
                  </button>
                </li>
              ))}
            </ul>
          )
        )}
      </div>

      <div className="border-t border-separator p-2 shrink-0">
        <button
          onClick={onCreate}
          aria-label={`Create new ${noun}`}
          className="w-full flex items-center justify-center gap-2 h-9 px-3 rounded-md bg-surface-1 hover:bg-surface-2 text-label-secondary hover:text-label transition-colors text-body-sm font-medium"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New {noun}
        </button>
      </div>

      {confirm && (
        <ConfirmDialog
          title={`Delete ${noun}?`}
          message={<>&ldquo;{confirm.name}&rdquo; will be moved to Recently deleted. You can restore it.</>}
          onConfirm={() => { onDelete(confirm.id, confirm.name); setConfirm(null); }}
          onCancel={() => setConfirm(null)}
        />
      )}
    </aside>
  );
}

// ── TemplateCard ─────────────────────────────────────────────────────────────
// Mac/Finder rename pattern: first click selects, second click on the name of
// an already-active card enters edit mode. Enter commits, Escape cancels.

function TemplateCard({
  template,
  isActive,
  onSelect,
  onRename,
  onDelete,
}: {
  template: TemplateRow;
  isActive: boolean;
  onSelect: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState(template.name);
  const [syncedName, setSyncedName] = useState(template.name);
  const inputRef              = useRef<HTMLInputElement>(null);

  // Resync the draft when the row's name changes underneath us (rename committed,
  // live sync from another tab). Adjusting state during render is React's
  // documented replacement for a setState-in-effect here.
  if (syncedName !== template.name) {
    setSyncedName(template.name);
    setDraft(template.name);
  }

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  function commit() {
    const trimmed = draft.trim();
    setEditing(false);
    if (trimmed && trimmed !== template.name) {
      onRename(trimmed);
    } else {
      setDraft(template.name);
    }
  }

  function cancel() {
    setDraft(template.name);
    setEditing(false);
  }

  return (
    <div
      onClick={() => { if (!editing) onSelect(); }}
      aria-current={isActive ? 'true' : undefined}
      className={`group relative px-3 py-2 rounded-md cursor-pointer transition-colors ${
        isActive
          ? 'bg-surface-2 text-label'
          : 'hover:bg-surface-1 text-label-tertiary hover:text-label'
      }`}
    >
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onClick={e => e.stopPropagation()}
          onKeyDown={e => {
            if (e.key === 'Enter')  { e.preventDefault(); commit(); }
            if (e.key === 'Escape') { e.preventDefault(); cancel(); }
          }}
          className="w-full bg-surface border border-tint rounded px-2 py-1 text-body-sm outline-none text-label"
        />
      ) : (
        <div className="flex items-center justify-between gap-2 min-w-0">
          <span
            onClick={e => {
              if (!isActive) return;             // First click selects; second click on active card name → edit
              e.stopPropagation();
              setEditing(true);
            }}
            className={`text-body-sm font-medium truncate flex-1 ${isActive ? 'cursor-text' : ''}`}
            title={template.name}
          >
            {template.name}
          </span>
          <button
            type="button"
            onClick={e => { e.stopPropagation(); onDelete(); }}
            className="shrink-0 w-7 h-7 flex items-center justify-center rounded text-label-quaternary hover:text-danger hover:bg-surface-2 transition-colors"
            title="Delete"
            aria-label={`Delete ${template.name}`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
