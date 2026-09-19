'use client';

import { useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { TeamManager } from './TeamManager';

interface Props {
  user: User | null;
  onChangePassword: (currentPassword: string, newPassword: string) => Promise<string | null>;
  onSignOut: () => void;
}

// Dedicated account section: identity, change password, team management, and sign out.
export function AccountPanel({ user, onChangePassword, onSignOut }: Props) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null);

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (next.length < 6) { setMsg({ kind: 'error', text: 'New password must be at least 6 characters.' }); return; }
    if (next !== confirm) { setMsg({ kind: 'error', text: 'New passwords don’t match.' }); return; }
    setBusy(true);
    const err = await onChangePassword(current, next);
    setBusy(false);
    if (err) { setMsg({ kind: 'error', text: err }); return; }
    setCurrent(''); setNext(''); setConfirm('');
    setMsg({ kind: 'ok', text: 'Password updated.' });
  }

  const inputCls = 'h-9 w-full rounded-md bg-surface-1 border border-separator px-3 text-footnote text-label placeholder:text-label-quaternary focus:outline-none focus:ring-2 focus:ring-focus disabled:opacity-60';

  return (
    <div className="flex flex-col items-center px-4 pt-12 pb-24">
      <div className="w-full max-w-xl flex flex-col gap-10">
        <header className="flex flex-col gap-1.5">
          <h1 className="text-title1 text-label">Account</h1>
          <p className="text-body text-label-tertiary">Your sign-in, password, and team.</p>
        </header>

        {/* Identity */}
        <section className="flex flex-col gap-2.5">
          <h2 className="text-caption-sm font-medium text-label-tertiary px-1">Signed in as</h2>
          <div className="rounded-xl bg-surface-1 border border-separator px-4 py-3 flex items-center justify-between gap-3">
            <span className="text-footnote text-label truncate">{user?.email ?? '—'}</span>
            <button
              onClick={onSignOut}
              className="shrink-0 h-8 px-3 rounded-md border border-separator text-caption-sm font-medium text-label-secondary hover:text-danger hover:border-danger/50 transition-colors"
            >
              Sign out
            </button>
          </div>
        </section>

        {/* Change password */}
        <section className="flex flex-col gap-2.5">
          <h2 className="text-caption-sm font-medium text-label-tertiary px-1">Change password</h2>
          <form onSubmit={changePassword} className="rounded-xl bg-surface-1 border border-separator p-4 flex flex-col gap-3">
            <input type="password" autoComplete="current-password" placeholder="Current password" value={current} onChange={e => setCurrent(e.target.value)} disabled={busy} className={inputCls} />
            <input type="password" autoComplete="new-password" placeholder="New password" value={next} onChange={e => setNext(e.target.value)} disabled={busy} className={inputCls} />
            <input type="password" autoComplete="new-password" placeholder="Confirm new password" value={confirm} onChange={e => setConfirm(e.target.value)} disabled={busy} className={inputCls} />
            {msg && <p className={`text-caption-sm ${msg.kind === 'error' ? 'text-danger' : 'text-success'}`} role="status">{msg.text}</p>}
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={busy || !current || !next || !confirm}
                className="h-8 px-4 rounded-md bg-accent text-on-accent text-caption-sm font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {busy ? 'Updating…' : 'Update password'}
              </button>
            </div>
          </form>
        </section>

        {/* Team */}
        <section className="flex flex-col gap-2.5">
          <h2 className="text-caption-sm font-medium text-label-tertiary px-1">Team</h2>
          <div className="rounded-xl bg-surface-1 border border-separator p-4">
            <TeamManager />
          </div>
        </section>
      </div>
    </div>
  );
}
