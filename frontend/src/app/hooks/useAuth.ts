'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import type { User } from '@supabase/supabase-js';

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  async function signIn(email: string, password: string): Promise<string | null> {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return error?.message ?? null;
  }

  async function signUp(email: string, password: string): Promise<string | null> {
    const { error } = await supabase.auth.signUp({ email, password });
    return error?.message ?? null;
  }

  async function signOut() {
    // Clear this browser's Instagram cookies (httpOnly, so a server route must do
    // it) BEFORE dropping the Supabase session, so the next user to log in on a
    // shared browser can't inherit the previous user's IG connection. Best-effort.
    try {
      await fetch('/api/video-reels/meta/logout', { method: 'POST' });
    } catch {
      /* best-effort — never block sign-out */
    }
    await supabase.auth.signOut();
  }

  async function resetPassword(email: string): Promise<string | null> {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    return error?.message ?? null;
  }

  async function updatePassword(password: string): Promise<string | null> {
    const { error } = await supabase.auth.updateUser({ password });
    return error?.message ?? null;
  }

  async function changePassword(currentPassword: string, newPassword: string): Promise<string | null> {
    if (!user?.email) return 'No user email found';
    const { error: verifyErr } = await supabase.auth.signInWithPassword({ email: user.email, password: currentPassword });
    if (verifyErr) return 'Current password is incorrect';
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    return error?.message ?? null;
  }

  return { user, loading, signIn, signUp, signOut, resetPassword, updatePassword, changePassword };
}
