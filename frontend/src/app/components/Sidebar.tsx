'use client';

import type { AppSection } from '../types';
import { InstagramSidebarItem } from './InstagramConnection';
import { GoogleSidebarItem } from './GoogleConnection';
import { PublishingLimit } from './PublishingLimit';
import type { OnlineMember } from '../hooks/useTeamPresence';

const Icon = ({ children }: { children: React.ReactNode }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);

interface SidebarProps {
  active: AppSection;
  onSelect: (s: AppSection) => void;
  signedIn: boolean;
  online?: OnlineMember[];
}

// Live roster of team members currently using Sonotool (global presence).
function OnlineNow({ online }: { online: OnlineMember[] }) {
  if (online.length === 0) return null;
  return (
    <div className="shrink-0 px-3 py-2.5 border-t border-separator">
      <div className="text-micro font-medium text-label-tertiary mb-2 px-1">Online now</div>
      <ul className="flex flex-col gap-1.5">
        {online.map(m => (
          <li key={m.id} className="flex items-center gap-2 px-1" title={m.self ? `${m.name} (you)` : m.name}>
            <span className="relative shrink-0">
              <span
                className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-semibold text-white uppercase"
                style={{ backgroundColor: m.color }}
              >
                {m.name.slice(0, 1)}
              </span>
              <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-500 ring-2 ring-surface-1" />
            </span>
            <span className="min-w-0 flex-1 flex items-baseline gap-1">
              <span className="text-[11px] leading-tight text-label-secondary truncate">{m.name}</span>
              {m.self && <span className="text-[11px] leading-tight text-label-quaternary shrink-0">(you)</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

type NavEntry = { id: AppSection; label: string; icon: React.ReactNode };

const NAV: NavEntry[] = [
  {
    id: 'template-editor',
    label: 'Templates',
    icon: <Icon><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></Icon>,
  },
  {
    id: 'posts',
    label: 'Posts',
    icon: <Icon><rect x="7" y="3" width="14" height="14" rx="2" /><path d="M3 7v12a2 2 0 0 0 2 2h12" /></Icon>,
  },
  {
    id: 'chart-reels',
    label: 'Chart Reels',
    icon: <Icon><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></Icon>,
  },
  {
    id: 'video-reels', // internal id (api/video-reels/*, component dirs) — display name is "Video Reels"
    label: 'Video Reels',
    icon: <Icon><polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" /></Icon>,
  },
];

const SETTINGS_NAV: NavEntry[] = [
  {
    id: 'branding',
    label: 'Branding',
    icon: <Icon><circle cx="13.5" cy="6.5" r=".5" fill="currentColor" /><circle cx="17.5" cy="10.5" r=".5" fill="currentColor" /><circle cx="8.5" cy="7.5" r=".5" fill="currentColor" /><circle cx="6.5" cy="12.5" r=".5" fill="currentColor" /><path d="M12 22a10 10 0 1 1 0-20 10 10 0 0 1 10 10c0 2.21-1.79 4-4 4-1.66 0-3 1.34-3 3" /></Icon>,
  },
];

// Stacked avatars of everyone currently on a given section (you included, so it's visible solo).
function SectionAvatars({ members }: { members: OnlineMember[] }) {
  if (members.length === 0) return null;
  const shown = members.slice(0, 3);
  const extra = members.length - shown.length;
  return (
    <span className="ml-auto shrink-0 flex items-center -space-x-1.5">
      {shown.map(m => (
        <span
          key={m.id}
          title={m.name}
          className="w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-semibold text-white uppercase ring-2 ring-surface-1"
          style={{ backgroundColor: m.color }}
        >
          {m.name.slice(0, 1)}
        </span>
      ))}
      {extra > 0 && <span className="pl-1 text-[9px] text-label-tertiary">+{extra}</span>}
    </span>
  );
}

function NavItem({ item, active, onSelect, online = [] }: { item: NavEntry; active: AppSection; onSelect: (s: AppSection) => void; online?: OnlineMember[] }) {
  const isActive = active === item.id;
  const here = online.filter(m => m.section === item.id);
  return (
    <button
      type="button"
      onClick={() => onSelect(item.id)}
      aria-current={isActive ? 'page' : undefined}
      className={`w-full flex items-center gap-3 h-9 px-3 rounded-md text-body-sm font-medium transition-colors ${
        isActive ? 'bg-surface-2 text-label' : 'text-label-secondary hover:text-label hover:bg-surface-2'
      }`}
    >
      <span className="shrink-0 flex items-center justify-center">{item.icon}</span>
      <span className="flex-1 text-left truncate">{item.label}</span>
      <SectionAvatars members={here} />
    </button>
  );
}

export function Sidebar({ active, onSelect, signedIn, online = [] }: SidebarProps) {
  return (
    <aside className="fixed left-0 top-0 z-30 h-screen w-56 flex flex-col bg-surface-1 border-r border-separator">
      {/* Brand */}
      <div className="flex items-center h-14 px-4 shrink-0">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/sonotool-logo.png" alt="Sonotool" className="h-6 w-auto select-none" draggable={false} />
      </div>

      {/* Primary navigation — quiet chrome; active state is a subtle fill, not a tint (deference). */}
      <nav aria-label="Primary" className="flex-1 flex flex-col gap-0.5 px-2 overflow-y-auto">
        {NAV.map(item => <NavItem key={item.id} item={item} active={active} onSelect={onSelect} online={online} />)}
        <div className="my-2 mx-1 border-t border-separator" />
        {SETTINGS_NAV.map(item => <NavItem key={item.id} item={item} active={active} onSelect={onSelect} online={online} />)}
      </nav>

      {/* Who on the team currently has Sonotool open (global presence). */}
      <OnlineNow online={online} />

      {/* Team-shared Google Sheets connection — Video Reels import/compose + sheet writes */}
      <div className="shrink-0 px-2 py-2 border-t border-separator">
        <GoogleSidebarItem />
      </div>

      {/* Global Instagram connection — one place for every section (Chart Reels, Video Reels, Posts) */}
      <div className="shrink-0 px-2 py-2 border-t border-separator">
        <InstagramSidebarItem />
        {/* Shared daily publish budget — all sections post against the same Instagram quota */}
        <PublishingLimit />
      </div>

      {/* Account — identity, password, team, sign out */}
      {signedIn && (
        <div className="shrink-0 px-2 py-2 border-t border-separator">
          <button
            type="button"
            onClick={() => onSelect('account')}
            aria-current={active === 'account' ? 'page' : undefined}
            className={`w-full flex items-center gap-3 h-9 px-3 rounded-md text-body-sm font-medium transition-colors ${
              active === 'account' ? 'bg-surface-2 text-label' : 'text-label-secondary hover:text-label hover:bg-surface-2'
            }`}
          >
            <span className="shrink-0 flex items-center justify-center">
              <Icon><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></Icon>
            </span>
            <span className="flex-1 text-left">Account</span>
            <SectionAvatars members={online.filter(m => m.section === 'account')} />
          </button>
        </div>
      )}
    </aside>
  );
}
