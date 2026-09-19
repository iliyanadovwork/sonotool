'use client';

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

interface Member {
  user_id: string;
  email: string;
  is_self: boolean;
}

// Roster + add/remove for the shared team. Everyone is equal (no roles); any member can manage.
// Backed by the team_members allowlist + add_team_member / list_team_members RPCs (RLS-enforced).
// Used inline in the Account section and inside the Team modal.
export function TeamManager() {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const { data, error: err } = await supabase.rpc('list_team_members');
    if (err) { setError(err.message); return; }
    setMembers((data ?? []) as Member[]);
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function add() {
    const addr = email.trim();
    if (!addr) { setError('Enter an email address.'); return; }
    setBusy(true); setError('');
    try {
      const { error: err } = await supabase.rpc('add_team_member', { p_email: addr });
      if (err) throw new Error(err.message);
      setEmail('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add');
    } finally {
      setBusy(false);
    }
  }

  async function remove(userId: string, isSelf: boolean) {
    if (isSelf && !confirm('Remove yourself from the team? You will lose access to all shared posts and templates.')) return;
    setBusy(true); setError('');
    try {
      const { error: err } = await supabase.from('team_members').delete().eq('user_id', userId);
      if (err) throw new Error(err.message);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-caption-sm text-label-tertiary">Everyone on the team sees and edits the same posts and templates. There are no roles — all members are equal.</p>

      <div className="flex items-center gap-2">
        <input
          value={email}
          onChange={e => setEmail(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void add(); } }}
          disabled={busy}
          type="email"
          placeholder="teammate@email.com"
          className="flex-1 h-8 rounded-md bg-surface-1 border border-separator px-2.5 text-footnote text-label placeholder:text-label-quaternary focus:outline-none focus:ring-2 focus:ring-focus disabled:opacity-60"
        />
        <button
          onClick={() => void add()}
          disabled={busy || !email.trim()}
          className="h-8 px-3 rounded-md bg-accent text-on-accent text-caption-sm font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
        >
          {busy ? '…' : 'Add'}
        </button>
      </div>
      <span className="text-caption-sm text-label-quaternary -mt-1">They need a Sonotool account first — have them sign up, then add their email.</span>

      {error && <p className="text-caption-sm text-danger" role="alert">{error}</p>}

      {members === null ? (
        <p className="text-caption-sm text-label-quaternary py-1">Loading…</p>
      ) : (
        <ul className="flex flex-col">
          {members.map(m => (
            <li key={m.user_id} className="flex items-center justify-between gap-2 py-1.5">
              <span className="min-w-0 flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-surface-2 shrink-0 flex items-center justify-center text-caption-sm text-label-tertiary uppercase">{m.email.slice(0, 1)}</span>
                <span className="text-footnote text-label truncate">{m.email}{m.is_self && <span className="text-label-tertiary"> (you)</span>}</span>
              </span>
              <button
                onClick={() => void remove(m.user_id, m.is_self)}
                disabled={busy}
                className="text-caption-sm text-label-quaternary hover:text-danger disabled:opacity-40 shrink-0"
                title={m.is_self ? 'Leave the team' : 'Remove from team'}
              >
                {m.is_self ? 'Leave' : 'Remove'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
