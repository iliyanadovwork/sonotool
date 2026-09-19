'use client';

// Dependency-free bar chart (pure divs) in the companion app's style: the peak bar
// is highlighted with the accent, the rest are muted, and negative values (net
// unfollows on a day) read as a small danger-tinted bar. Used for followers
// gained per day in the analytics view.

export function MiniBars({
  values,
  className = 'h-28',
  emptyHint = 'Not enough data',
}: {
  values: Array<{ label?: string; value: number }> | null | undefined;
  className?: string;
  emptyHint?: string;
}) {
  const data = (values ?? []).filter((v) => v && typeof v.value === 'number');
  if (data.length < 2) {
    return <div className={`${className} grid place-items-center text-caption-sm text-label-quaternary`}>{emptyHint}</div>;
  }
  const maxAbs = Math.max(1, ...data.map((d) => Math.abs(d.value)));
  const peak = Math.max(...data.map((d) => d.value));

  return (
    <div className={`${className} flex items-end gap-1`} role="img" aria-label={`Followers gained per day over ${data.length} days`}>
      {data.map((d, i) => {
        const h = Math.max(3, (Math.abs(d.value) / maxAbs) * 100);
        const isPeak = d.value === peak && d.value > 0;
        const neg = d.value < 0;
        return (
          <div
            key={i}
            className={`flex-1 rounded-t ${neg ? 'bg-danger/50' : isPeak ? 'bg-accent' : 'bg-label-quaternary/40'}`}
            style={{ height: `${h}%` }}
            title={d.label ? `${d.label}: ${d.value >= 0 ? '+' : ''}${d.value}` : `${d.value >= 0 ? '+' : ''}${d.value}`}
          />
        );
      })}
    </div>
  );
}
