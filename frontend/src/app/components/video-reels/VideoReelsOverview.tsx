'use client';

import { useInstagramConnection } from '../InstagramConnection';
import { PAGE_CONFIGS } from '@/lib/video-reels/page-config';
import { AccountCard } from './AccountCard';

// The 2x2 landing grid. Iterates the 4 configured pages in a fixed order and
// matches each to the connected accounts by lowercased username, so exactly four
// rectangular cells always render in a stable order. Connected → AccountCard;
// otherwise → a Connect prompt.

const ORDER = ['sonotradehq', 'sonomediahd', 'sono.clips', 'sonotradeio'] as const;

const IG_ICON = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
    <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
    <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
  </svg>
);

function ConnectPromptCell({
  label,
  onConnect,
  onBuildOnly,
}: {
  label: string;
  onConnect: () => void;
  onBuildOnly: () => void;
}) {
  return (
    <div className="flex flex-col justify-between gap-3 rounded-xl bg-surface-1 border border-separator p-5 min-h-[252px]">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-full bg-surface-2 grid place-items-center text-label-quaternary shrink-0">{IG_ICON}</div>
        <div className="min-w-0">
          <div className="text-body font-semibold text-label truncate">{label}</div>
          <div className="text-caption-sm text-label-tertiary">Not connected</div>
        </div>
      </div>
      <p className="text-caption-sm text-label-tertiary">Connect this page to see reach, views and interactions, and to post.</p>
      <div className="flex items-center gap-2 self-start">
        <button
          type="button"
          onClick={onConnect}
          className="h-9 px-4 inline-flex items-center gap-2 rounded-md bg-accent text-on-accent text-caption font-medium hover:bg-accent-hover active:bg-accent-pressed transition-colors"
        >
          Connect
        </button>
        {/* Escape hatch for a page we can't (or don't want to) connect: build and
            export its reels with the right overlay + sheet tab, then upload by
            hand. Publishing stays disabled in that mode - see buildOnlyPage in
            VideoReelsSection - because the IG cookie still points at a DIFFERENT
            account and publishing would post this page's branding to that one. */}
        <button
          type="button"
          onClick={onBuildOnly}
          title="Build and export this page's reels without connecting it. Posting to Instagram stays disabled."
          className="h-9 px-4 inline-flex items-center gap-2 rounded-md bg-surface-2 border border-separator text-caption font-medium text-label-secondary hover:text-label hover:border-label-quaternary transition-colors"
        >
          Build without posting
        </button>
      </div>
    </div>
  );
}

function SkeletonCell() {
  return <div className="rounded-xl bg-surface-1 border border-separator p-5 min-h-[252px] animate-pulse" />;
}

export function VideoReelsOverview({
  onViewMore,
  onPost,
  onConnect,
  onBuildOnly,
}: {
  onViewMore: (igUserId: string) => void;
  onPost: (igUserId: string) => void;
  onConnect: () => void;
  onBuildOnly: (pageKey: string) => void;
}) {
  const { accounts, loading } = useInstagramConnection();
  const byUsername = new Map(
    accounts.filter((a) => a.igUsername).map((a) => [a.igUsername!.toLowerCase(), a]),
  );

  return (
    <div className="mx-auto w-full max-w-6xl px-6 pt-8 pb-16">
      <header className="mb-6 flex items-baseline justify-between">
        <h1 className="text-title1 text-label">Video Reels</h1>
        <p className="text-body-sm text-label-tertiary">Your Instagram pages</p>
      </header>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        {loading && accounts.length === 0
          ? ORDER.map((k) => <SkeletonCell key={k} />)
          : ORDER.map((key) => {
              const cfg = PAGE_CONFIGS[key];
              const label = cfg?.label ?? key;
              const acct = byUsername.get(key);
              if (acct?.igUserId) {
                const id = acct.igUserId;
                return (
                  <AccountCard
                    key={key}
                    igUserId={id}
                    label={label}
                    onViewMore={() => onViewMore(id)}
                    onPost={() => onPost(id)}
                  />
                );
              }
              return (
                <ConnectPromptCell
                  key={key}
                  label={label}
                  onConnect={onConnect}
                  onBuildOnly={() => onBuildOnly(key)}
                />
              );
            })}
      </div>
    </div>
  );
}
