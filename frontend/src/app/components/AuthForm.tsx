'use client';

import { useState } from 'react';
import { Button, Field, TextInput } from './ui';

interface AuthFormProps {
  onSignIn: (email: string, password: string) => Promise<string | null>;
  onSignUp: (email: string, password: string) => Promise<string | null>;
  onResetPassword: (email: string) => Promise<string | null>;
}

export function AuthForm({ onSignIn, onSignUp, onResetPassword }: AuthFormProps) {
  const [mode, setMode] = useState<'login' | 'signup' | 'forgot'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    if (mode === 'forgot') {
      const err = await onResetPassword(email);
      if (err) { setError(err); } else { setResetSent(true); }
      setLoading(false);
      return;
    }

    const err = mode === 'login'
      ? await onSignIn(email, password)
      : await onSignUp(email, password);

    if (err) setError(err);
    setLoading(false);
  }

  function switchMode(next: 'login' | 'signup' | 'forgot') {
    setMode(next);
    setError(null);
    setResetSent(false);
  }

  if (mode === 'forgot' && resetSent) {
    return (
      <div className="w-full max-w-sm flex flex-col gap-8 text-center">
        <header className="flex flex-col items-center gap-4">
          <span className="flex items-center justify-center w-14 h-14 rounded-full bg-surface-2">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-success" aria-hidden="true">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </span>
          <div className="flex flex-col gap-2">
            <h1 className="text-title2 text-label">Check your email</h1>
            <p className="text-body-sm text-label-tertiary">
              We sent a password reset link to{' '}
              <span className="text-label-secondary">{email}</span>.
            </p>
          </div>
        </header>
        <div className="flex flex-col gap-3">
          <p className="text-caption text-label-tertiary">
            No email? Check your spam folder, or try a different address.
          </p>
          <Button variant="secondary" block onClick={() => switchMode('login')}>
            Back to sign in
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm flex flex-col gap-8">
      <header className="text-center flex flex-col gap-1.5">
        <h1 className="text-title2 text-label">
          {mode === 'login' ? 'Welcome back' : mode === 'signup' ? 'Create your account' : 'Reset your password'}
        </h1>
        <p className="text-body-sm text-label-tertiary">
          {mode === 'login'
            ? 'Sign in to access your templates, posts and Brand Kit.'
            : mode === 'signup'
            ? 'Create an account to start building templates and posts.'
            : "Enter your email and we'll send a reset link."}
        </p>
      </header>

      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <div className="flex flex-col gap-4">
          <Field label="Email">
            <TextInput type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" required autoComplete="email" />
          </Field>

          {mode !== 'forgot' && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-3">
                <label htmlFor="auth-pw" className="text-label text-label-secondary">Password</label>
                {mode === 'login' && (
                  <button type="button" onClick={() => switchMode('forgot')} className="text-caption-sm text-tint hover:text-tint-hover font-medium transition-colors ease-out">
                    Forgot?
                  </button>
                )}
              </div>
              <TextInput
                id="auth-pw"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                minLength={6}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                aria-describedby={mode === 'signup' ? 'auth-pw-hint' : undefined}
              />
              {mode === 'signup' && (
                <p id="auth-pw-hint" className="text-caption-sm text-label-tertiary">
                  Use at least 6 characters.
                </p>
              )}
            </div>
          )}
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
          {mode === 'login' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Send reset link'}
        </Button>
      </form>

      {mode === 'forgot' ? (
        <Button variant="tertiary" block onClick={() => switchMode('login')}>
          Back to sign in
        </Button>
      ) : (
        <p className="text-center text-body-sm text-label-tertiary">
          {mode === 'login' ? "Don't have an account?" : 'Already have an account?'}
          {' '}
          <button type="button" onClick={() => switchMode(mode === 'login' ? 'signup' : 'login')} className="text-tint hover:text-tint-hover font-medium transition-colors ease-out">
            {mode === 'login' ? 'Sign up' : 'Sign in'}
          </button>
        </p>
      )}
    </div>
  );
}
