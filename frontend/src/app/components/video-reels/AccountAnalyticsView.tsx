'use client';

import { InsightsPanel } from './InsightsPanel';
import { ReelBreakdownList } from './ReelBreakdownList';

// Full-screen "View more": the account dashboard (reused InsightsPanel, per-page
// by id) + the per-reel breakdown, as two independent fetches so a media failure
// never blanks the account tiles. Rendered inside VideoReelsSection's shell (which
// supplies the page background), so this is just the content container.

export function AccountAnalyticsView({
  igUserId,
  label,
  onBack,
  onReconnect,
}: {
  igUserId: string;
  label: string;
  onBack: () => void;
  onReconnect?: () => void;
}) {
  return (
    <div className="mx-auto w-full max-w-6xl px-6 pt-6 pb-16">
      <div className="mb-5 flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="h-9 px-3 inline-flex items-center gap-1.5 rounded-md bg-surface-2 border border-separator text-caption font-medium text-label-secondary hover:text-label hover:border-label-quaternary transition-colors"
        >
          ← Back
        </button>
        <h1 className="text-title2 font-semibold text-label">Analytics</h1>
      </div>
      <InsightsPanel igUserId={igUserId} activeUsername={label} onReconnect={onReconnect} />
      <ReelBreakdownList igUserId={igUserId} />
    </div>
  );
}
