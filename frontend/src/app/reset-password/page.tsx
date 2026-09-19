'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { Button, Field, TextInput } from '@/app/components/ui';

export default function ResetPasswordPage() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Supabase processes the recovery token from the URL hash and fires PASSWORD_RECOVERY
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setReady(true);
    });
    return () => subscription.unsubscribe();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) { setError('Passwords do not match'); return; }
    setError(null);
    setLoading(true);
    const { error: err } = await supabase.auth.updateUser({ password });
    if (err) { setError(err.message); } else { setDone(true); }
    setLoading(false);
  }

  if (done) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <div className="w-full max-w-sm flex flex-col gap-8 text-center px-4">
          <header className="flex flex-col items-center gap-4">
            <span className="flex items-center justify-center w-14 h-14 rounded-full bg-surface-2">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-success" aria-hidden="true">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </span>
            <div className="flex flex-col gap-2">
              <h1 className="text-title2 text-label">Password updated</h1>
              <p className="text-body-sm text-label-tertiary">Your password has been changed successfully.</p>
            </div>
          </header>
          <Link href="/" className="h-10 w-full inline-flex items-center justify-center rounded-md bg-accent text-on-accent text-caption font-medium hover:bg-accent-hover active:bg-accent-pressed transition-colors ease-out">
            Go to app
          </Link>
        </div>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-5 h-5 border-2 border-separator border-t-label rounded-full animate-spin" />
          <p className="text-body-sm text-label-tertiary">Verifying your link…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center">
      <div className="w-full max-w-sm flex flex-col gap-8 px-4">
        <header className="text-center flex flex-col gap-1.5">
          <h1 className="text-title2 text-label">Set a new password</h1>
          <p className="text-body-sm text-label-tertiary">Choose a strong password for your account.</p>
        </header>

        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <div className="flex flex-col gap-4">
            <Field label="New password" hint="Use at least 6 characters.">
              <TextInput
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                minLength={6}
                autoComplete="new-password"
              />
            </Field>

            <Field label="Confirm password">
              <TextInput
                type="password"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                placeholder="••••••••"
                required
                minLength={6}
                autoComplete="new-password"
              />
            </Field>
          </div>

          {error && (
            <div role="alert" className="flex items-start gap-2 text-caption-sm text-danger bg-danger/10 border border-danger/40 rounded-md px-3 py-2">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="shrink-0 mt-px" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span>{error}</span>
            </div>
          )}

          <Button type="submit" variant="primary" block loading={loading}>
            Update password
          </Button>
        </form>
      </div>
    </div>
  );
}
