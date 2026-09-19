'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { colorForUser } from './usePostCollab';
import type { AppSection } from '../types';

export interface OnlineMember {
  id: string;
  name: string;
  color: string;
  section: AppSection | null;   // which section they're currently viewing
  self: boolean;
}

// App-wide presence: who on the team currently has Sonotool open, and which SECTION each is on.
// One global channel (`presence:team`) that every signed-in TEAM MEMBER joins on load (non-members
// don't participate, so nobody outside the team is shown or sees the roster). Ephemeral — no DB.
export function useTeamPresence(
  user: { id: string; email?: string | null } | null,
  activeSection: AppSection,
): OnlineMember[] {
  const [online, setOnline] = useState<OnlineMember[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const channelRef = useRef<any>(null);
  const sectionRef = useRef<AppSection>(activeSection);

  useEffect(() => {
    if (!user) return;   // initial state is [] and the cleanup resets on teardown
    const id = user.id;
    const name = user.email || 'You';
    const color = colorForUser(id);

    let cancelled = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let channel: any = null;

    (async () => {
      // Only team members participate (keeps non-team accounts out of the roster).
      const { data: isMember } = await supabase.rpc('is_team_member');
      if (cancelled || !isMember) return;

      const ch = supabase.channel('presence:team', { config: { presence: { key: id } } });
      channel = ch;
      channelRef.current = ch;
      ch.on('presence', { event: 'sync' }, () => {
        const state = ch.presenceState<{ id: string; name: string; color: string; section: AppSection | null }>();
        const list: OnlineMember[] = [];
        for (const key of Object.keys(state)) {
          const meta = state[key]?.[0];
          if (meta) list.push({ id: meta.id, name: meta.name, color: meta.color, section: meta.section ?? null, self: meta.id === id });
        }
        list.sort((a, b) => (a.self ? 0 : 1) - (b.self ? 0 : 1) || a.name.localeCompare(b.name));
        setOnline(list);
      });
      ch.subscribe(status => { if (status === 'SUBSCRIBED') void ch.track({ id, name, color, section: sectionRef.current }); });
    })();

    return () => {
      cancelled = true;
      setOnline([]);
      if (channel) void supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [user?.id, user?.email]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-broadcast presence when this client switches sections (no re-subscribe).
  useEffect(() => {
    sectionRef.current = activeSection;
    const ch = channelRef.current;
    if (!ch || !user) return;
    void ch.track({ id: user.id, name: user.email || 'You', color: colorForUser(user.id), section: activeSection });
  }, [activeSection, user?.id, user?.email]);

  return online;
}
