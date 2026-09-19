'use client';

import { useRef, useState, useCallback } from 'react';
import type { BrandProps } from '../types';
import { AuthForm } from './AuthForm';
import { UploadsGallery } from './UploadsGallery';
import { parseFontName } from './customFonts';
import { Button, Field, TextInput } from './ui';

const WEIGHT_NAME: Record<number, string> = {
  100: 'Thin', 200: 'ExtraLight', 300: 'Light', 400: 'Regular',
  500: 'Medium', 600: 'SemiBold', 700: 'Bold', 800: 'ExtraBold', 900: 'Black',
};
// Human-readable name for one uploaded style. Prefer the font's own weight name (e.g. "Heavy") over
// the generic CSS one (e.g. "Black") when the filename carried it.
function styleLabel(weight: number, style: 'normal' | 'italic', variable: boolean, name?: string) {
  if (variable) return 'Variable';
  return (name ?? WEIGHT_NAME[weight] ?? String(weight)) + (style === 'italic' ? ' Italic' : '');
}

function Spinner({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-block rounded-full border-2 border-separator border-t-label animate-spin ${className}`}
      aria-hidden="true"
    />
  );
}

const PlusIcon = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);
const TrashIcon = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);
const PasteIcon = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /><rect x="8" y="2" width="8" height="4" rx="1" />
  </svg>
);

/** Apple-style inset grouped section: a small caps-less title above a rounded card,
 *  with an optional header action and footer caption. */
function SettingsGroup({ title, action, caption, children }: {
  title?: string; action?: React.ReactNode; caption?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2.5">
      {(title || action) && (
        <div className="flex items-center justify-between gap-3 min-h-7 px-1">
          {title && <h2 className="text-caption-sm font-medium text-label-tertiary">{title}</h2>}
          {action}
        </div>
      )}
      <div className="rounded-xl bg-surface-1 border border-separator overflow-hidden">
        {children}
      </div>
      {caption && <p className="text-caption-sm text-label-tertiary px-1">{caption}</p>}
    </section>
  );
}

interface BrandKitPanelProps {
  brand: BrandProps;
  loading?: boolean;
  saving?: boolean;
  uploading?: boolean;
  error?: string | null;
  user: { id: string; email?: string } | null;
  authLoading?: boolean;
  onSignIn: (email: string, password: string) => Promise<string | null>;
  onSignUp: (email: string, password: string) => Promise<string | null>;
  onResetPassword: (email: string) => Promise<string | null>;
  onSave: (displayName: string, handle: string) => Promise<boolean>;
  onUploadLogo: (file: File) => void;
  onDeleteLogo: (id: string) => void;
  onSelectLogo: (url: string) => void;
  onUploadFont: (file: File) => void | Promise<void>;
  onDeleteFont: (id: string) => void;
  onClearError?: () => void;
}

export function BrandKitPanel({
  brand, loading, saving, uploading, error,
  user, authLoading, onSignIn, onSignUp, onResetPassword,
  onSave, onUploadLogo, onDeleteLogo, onSelectLogo, onUploadFont, onDeleteFont, onClearError,
}: BrandKitPanelProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const fontFileRef = useRef<HTMLInputElement>(null);
  const [fontProgress, setFontProgress] = useState<{ done: number; total: number } | null>(null);
  const [fontMessage, setFontMessage] = useState<string | null>(null);
  const [expandedFonts, setExpandedFonts] = useState<Set<string>>(() => new Set());

  function toggleFontFamily(family: string) {
    setExpandedFonts(prev => {
      const next = new Set(prev);
      if (next.has(family)) next.delete(family); else next.add(family);
      return next;
    });
  }
  const [displayName, setDisplayName] = useState(brand.displayName);
  const [handle, setHandle] = useState(brand.handle);
  const [saved, setSaved] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pasteMessage, setPasteMessage] = useState<string | null>(null);
  const pasteMessageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync local fields when brand loads from Supabase
  const prevDisplayName = useRef(brand.displayName);
  if (brand.displayName !== prevDisplayName.current) {
    prevDisplayName.current = brand.displayName;
    setDisplayName(brand.displayName);
  }
  const prevHandle = useRef(brand.handle);
  if (brand.handle !== prevHandle.current) {
    prevHandle.current = brand.handle;
    setHandle(brand.handle);
  }

  const isDirty = displayName !== brand.displayName || handle !== brand.handle;
  const canSave = isDirty && displayName.trim().length > 0 && handle.trim().length > 0;

  const handleSave = useCallback(async () => {
    const ok = await onSave(displayName, handle);
    if (ok) {
      setSaved(true);
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSaved(false), 2500);
    }
  }, [onSave, displayName, handle]);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    onUploadLogo(file);
    e.target.value = '';
  }

  // Identify a font by its variant (family + weight + style) so re-uploads / renamed copies are caught.
  const variantKey = (name: string) => {
    const { family, weight, style } = parseFontName(name);
    return `${family.toLowerCase()}|${weight}|${style}`;
  };

  async function handleFontFile(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (!files.length) return;

    // Skip variants already uploaded (or repeated within this batch).
    const seen = new Set(brand.fonts.map(f => variantKey(f.label)));
    const toUpload: File[] = [];
    let skipped = 0;
    for (const file of files) {
      const key = variantKey(file.name);
      if (seen.has(key)) { skipped++; continue; }
      seen.add(key);
      toUpload.push(file);
    }
    setFontMessage(skipped > 0 ? `Skipped ${skipped} font${skipped > 1 ? 's' : ''} already uploaded.` : null);
    if (!toUpload.length) return;

    // Sequential so the brand kit auto-creates once (no race) when uploading a whole family.
    setFontProgress({ done: 0, total: toUpload.length });
    for (let i = 0; i < toUpload.length; i++) {
      await onUploadFont(toUpload[i]);
      setFontProgress({ done: i + 1, total: toUpload.length });
    }
    setFontProgress(null);
  }

  // Group uploaded font files by family, keeping each style (member) so the family can expand.
  type FontMember = { id: string; label: string; weight: number; style: 'normal' | 'italic'; variable: boolean; weightLabel?: string };
  const fontFamilies = (() => {
    const m = new Map<string, { family: string; members: FontMember[] }>();
    for (const f of brand.fonts) {
      const { family, weight, style, variable, weightLabel } = parseFontName(f.label);
      const member: FontMember = { id: f.id, label: f.label, weight, style, variable, weightLabel };
      const e = m.get(family);
      if (e) e.members.push(member);
      else m.set(family, { family, members: [member] });
    }
    // Order styles lightest→heaviest, normal before italic.
    for (const fam of m.values()) {
      fam.members.sort((a, b) => a.weight - b.weight || (a.style === b.style ? 0 : a.style === 'normal' ? -1 : 1));
    }
    return [...m.values()];
  })();

  async function handlePaste() {
    setPasteMessage(null);
    if (typeof navigator === 'undefined' || !navigator.clipboard?.read) {
      flashPasteMessage('Your browser doesn’t support reading the clipboard');
      return;
    }
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        // Brand assets can be video (an animated logo/sting), not just stills.
        const imageType = item.types.find(t => t.startsWith('image/') || t.startsWith('video/'));
        if (!imageType) continue;
        const blob = await item.getType(imageType);
        const ext  = imageType.split('/')[1] || 'png';
        // eslint-disable-next-line react-hooks/purity -- handlePaste only runs from the Paste button's onClick, never during render, so Date.now() here is not a render-purity issue.
        const file = new File([blob], `pasted-${Date.now()}.${ext}`, { type: imageType });
        onUploadLogo(file);
        return;
      }
      flashPasteMessage('No image or video in clipboard');
    } catch {
      flashPasteMessage('Clipboard permission denied');
    }
  }

  function flashPasteMessage(text: string) {
    setPasteMessage(text);
    if (pasteMessageTimer.current) clearTimeout(pasteMessageTimer.current);
    pasteMessageTimer.current = setTimeout(() => setPasteMessage(null), 3000);
  }

  if (authLoading || loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner className="w-5 h-5" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex flex-col items-center pt-16 gap-10">
        <AuthForm onSignIn={onSignIn} onSignUp={onSignUp} onResetPassword={onResetPassword} />
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center px-4 pt-12 pb-24">
      <div className="w-full max-w-xl flex flex-col gap-10">
        {error && (
          <div role="alert" className="flex items-start gap-3 bg-danger/10 border border-danger/40 text-danger text-body-sm rounded-xl px-4 py-3">
            <span className="flex-1">{error}</span>
            <button type="button" onClick={onClearError} aria-label="Dismiss error" className="shrink-0 text-danger/70 hover:text-danger transition-colors">✕</button>
          </div>
        )}

        <header className="flex flex-col gap-1.5">
          <h1 className="text-title1 text-label">Branding</h1>
          <p className="text-body text-label-tertiary">Set your identity once — it’s used on every post.</p>
        </header>

        {/* Identity */}
        <SettingsGroup title="Identity">
          <div className="flex flex-col gap-5 p-5">
            <Field label="Display name">
              <TextInput value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="e.g. Sonotrade" />
            </Field>
            <Field label="Handle">
              <TextInput value={handle} onChange={e => setHandle(e.target.value)} placeholder="e.g. @SonotradeHQ" />
            </Field>
          </div>
          <div className="flex items-center justify-end gap-3 border-t border-separator px-5 py-3.5">
            <span role="status" aria-live="polite" className="sr-only">{saved ? 'Branding saved.' : ''}</span>
            {saved && !saving && (
              <span className="flex items-center gap-1.5 text-caption-sm text-success">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5" /></svg>
                Saved
              </span>
            )}
            <Button variant="primary" onClick={handleSave} disabled={saving || !canSave} loading={saving}>Save changes</Button>
          </div>
        </SettingsGroup>

        {/* Logos */}
        <SettingsGroup
          title="Logos"
          caption={brand.logos.length > 0 ? 'Select an upload to use it on your posts.' : undefined}
          action={
            <div className="flex items-center gap-1">
              {pasteMessage && <span role="status" className="text-caption-sm text-label-tertiary mr-1">{pasteMessage}</span>}
              <Button variant="tertiary" size="sm" onClick={handlePaste} disabled={uploading} iconLeft={PasteIcon}>Paste</Button>
              <Button variant="tertiary" size="sm" onClick={() => fileRef.current?.click()} disabled={uploading} loading={uploading} iconLeft={PlusIcon}>Upload</Button>
              <input ref={fileRef} type="file" accept="image/*,video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov" className="hidden" onChange={handleFile} />
            </div>
          }
        >
          {brand.logos.length === 0 ? (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="w-full flex flex-col items-center justify-center gap-2 py-10 text-label-tertiary hover:text-label-secondary hover:bg-surface-2 transition-colors"
            >
              <span className="flex items-center justify-center w-10 h-10 rounded-full bg-surface-2 text-label-secondary">{PlusIcon}</span>
              <span className="text-caption-sm">Upload your first logo</span>
            </button>
          ) : (
            <div className="p-4">
              <UploadsGallery logos={brand.logos} activeLogoUrl={brand.logoSrc} onSelect={onSelectLogo} onDelete={onDeleteLogo} />
            </div>
          )}
        </SettingsGroup>

        {/* Fonts */}
        <SettingsGroup
          title="Fonts"
          caption={brand.fonts.length > 0 ? 'Pick the family in any font dropdown — the weight buttons & italic toggle select the style.' : undefined}
          action={
            <div className="flex items-center gap-2">
              {fontProgress && <span role="status" className="text-caption-sm text-label-tertiary tabular-nums">Uploading {fontProgress.done}/{fontProgress.total}…</span>}
              <Button variant="tertiary" size="sm" onClick={() => fontFileRef.current?.click()} disabled={uploading || fontProgress !== null} loading={uploading || fontProgress !== null} iconLeft={PlusIcon} title="Upload font files (.ttf, .otf, .woff, .woff2) — select several at once for a whole family">Upload</Button>
              <input ref={fontFileRef} type="file" accept=".ttf,.otf,.woff,.woff2,font/*" multiple className="hidden" onChange={handleFontFile} />
            </div>
          }
        >
          {fontProgress && (
            <div className="h-1 bg-surface-2 overflow-hidden" role="progressbar" aria-valuenow={fontProgress.done} aria-valuemin={0} aria-valuemax={fontProgress.total}>
              <div className="h-full bg-tint transition-all ease-out" style={{ width: `${Math.round((fontProgress.done / fontProgress.total) * 100)}%` }} />
            </div>
          )}
          {fontMessage && <p className="text-caption-sm text-warning px-5 py-3">{fontMessage}</p>}

          {brand.fonts.length === 0 ? (
            <button
              type="button"
              onClick={() => fontFileRef.current?.click()}
              className="w-full flex flex-col items-center justify-center gap-2 py-8 text-label-tertiary hover:text-label-secondary hover:bg-surface-2 transition-colors"
            >
              <span className="flex items-center justify-center w-10 h-10 rounded-full bg-surface-2 text-label-secondary">{PlusIcon}</span>
              <span className="text-caption-sm">Upload a font (.ttf, .otf, .woff, .woff2)</span>
            </button>
          ) : (
            <div className="divide-y divide-separator-subtle">
              {fontFamilies.map(fam => {
                const expanded = expandedFonts.has(fam.family);
                return (
                  <div key={fam.family}>
                    <div className="group flex items-center gap-2 px-4 py-2.5">
                      <button type="button" onClick={() => toggleFontFamily(fam.family)} aria-expanded={expanded} className="flex items-center gap-2 flex-1 min-w-0 text-left min-h-9">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-label-tertiary shrink-0 transition-transform" style={{ transform: expanded ? 'rotate(90deg)' : 'none' }} aria-hidden="true"><polyline points="9 18 15 12 9 6" /></svg>
                        <span className="text-body-sm text-label truncate" style={{ fontFamily: `"${fam.family}", sans-serif` }} title={fam.family}>{fam.family}</span>
                      </button>
                      <span className="text-caption-sm text-label-tertiary tabular-nums shrink-0">{fam.members.length} style{fam.members.length > 1 ? 's' : ''}</span>
                      <button type="button" onClick={() => fam.members.forEach(mm => onDeleteFont(mm.id))} className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 text-label-quaternary hover:text-danger transition-opacity shrink-0 w-7 h-7 flex items-center justify-center rounded hover:bg-surface-2" title="Delete whole family" aria-label={`Delete ${fam.family}`}>{TrashIcon}</button>
                    </div>
                    {expanded && (
                      <div className="bg-surface pb-1">
                        {fam.members.map(mm => (
                          <div key={mm.id} className="group/style flex items-center gap-2 pl-10 pr-3 py-2 hover:bg-surface-2">
                            <span className="flex-1 min-w-0 text-caption text-label-secondary truncate" style={{ fontFamily: `"${fam.family}", sans-serif`, fontWeight: mm.weight, fontStyle: mm.style }} title={mm.label}>{styleLabel(mm.weight, mm.style, mm.variable, mm.weightLabel)}</span>
                            <button type="button" onClick={() => onDeleteFont(mm.id)} className="opacity-0 group-hover/style:opacity-100 focus-visible:opacity-100 text-label-quaternary hover:text-danger transition-opacity shrink-0 w-7 h-7 flex items-center justify-center rounded hover:bg-surface-2" title="Delete this style" aria-label={`Delete ${fam.family} ${styleLabel(mm.weight, mm.style, mm.variable, mm.weightLabel)}`}>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </SettingsGroup>
      </div>
    </div>
  );
}
