'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from './chart';

// Account-level analytics dashboard for the active/selected IG page, styled after
// the the companion app analytics page: a 6-up KPI grid, recharts line charts (Reach,
// Followers over time) with hover tooltips, and a followers-gained bar chart.
// Read-only; follows the picker.

interface SeriesPt { end_time: string; value: number }
interface InsightsResponse {
  account: {
    igUserId: string;
    username: string | null;
    name: string | null;
    accountType: string | null;
    followersCount: number | null;
    followsCount: number | null;
    mediaCount: number | null;
    profilePictureUrl: string | null;
  };
  window: { since: number; until: number; days: number };
  metrics: {
    reach: number | null;
    views: number | null;
    totalInteractions: number | null;
    accountsEngaged: number | null;
    profileLinksTaps: number | null;
    followersGained: number | null;
  };
  series: { followerCount: SeriesPt[] | null; reach: SeriesPt[] | null };
  warnings: string[];
}

const WINDOWS = [7, 30] as const;
const FETCH_TIMEOUT_MS = 15000;

const nf = new Intl.NumberFormat('en-US');
const fmtFull = (n: number | null | undefined) => (typeof n === 'number' ? nf.format(n) : '—');
function fmt(n: number | null | undefined): string {
  if (typeof n !== 'number') return '—';
  if (Math.abs(n) >= 10000) return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
  return nf.format(n);
}
const fmtNum = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}K`;
  return `${n}`;
};
function shortDate(d: string): string {
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? d : dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: ReactNode }) {
  return (
    <div className="bg-surface-1 border border-separator rounded-xl px-4 py-3.5 flex flex-col gap-2">
      <span className="text-caption-sm text-label-tertiary">{label}</span>
      <span className="text-[26px] leading-none font-semibold text-label-primary tabular-nums">{value}</span>
      {sub ? <span className="text-caption-sm text-label-quaternary tabular-nums">{sub}</span> : null}
    </div>
  );
}

function ChartCard({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="rounded-xl bg-surface-1 border border-separator p-4">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-label font-medium text-label">{title}</span>
        {subtitle && <span className="text-caption-sm text-label-tertiary">{subtitle}</span>}
      </div>
      <div className="mt-3 h-[220px]">{children}</div>
    </div>
  );
}

function Empty({ hint }: { hint: string }) {
  return <div className="grid h-full place-items-center text-caption-sm text-label-tertiary text-center px-4">{hint}</div>;
}
function ChartSkeleton() {
  return <div className="h-full rounded-lg bg-surface-2 animate-pulse" />;
}

function LineCard({ title, subtitle, data, seriesLabel, loading, emptyHint }: {
  title: string; subtitle: string; data: { date: string; value: number }[]; seriesLabel: string; loading: boolean; emptyHint: string;
}) {
  return (
    <ChartCard title={title} subtitle={subtitle}>
      {loading ? <ChartSkeleton /> : data.length ? (
        <ChartContainer className="h-full">
          <LineChart data={data} margin={{ left: 0, right: 8, top: 6, bottom: 0 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} minTickGap={28} tick={{ fontSize: 11 }} tickFormatter={(v) => shortDate(String(v))} />
            <YAxis tickLine={false} axisLine={false} width={40} tick={{ fontSize: 11 }} tickFormatter={(v) => fmtNum(Number(v))} />
            <ChartTooltip content={<ChartTooltipContent labelFormatter={(v) => shortDate(String(v))} valueFormatter={(v) => fmtFull(Number(v))} labelMap={{ value: seriesLabel }} />} />
            <Line dataKey="value" name={seriesLabel} type="monotone" stroke="var(--color-accent)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
          </LineChart>
        </ChartContainer>
      ) : <Empty hint={emptyHint} />}
    </ChartCard>
  );
}

function GainedCard({ data, loading, days }: { data: { date: string; value: number }[]; loading: boolean; days: number }) {
  const peak = data.length ? Math.max(...data.map((d) => d.value)) : 0;
  return (
    <ChartCard title="Followers gained / day" subtitle={`last ${days} days`}>
      {loading ? <ChartSkeleton /> : data.length ? (
        <ChartContainer className="h-full">
          <BarChart data={data} margin={{ left: 0, right: 8, top: 6, bottom: 0 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} minTickGap={20} tick={{ fontSize: 11 }} tickFormatter={(v) => shortDate(String(v))} />
            <YAxis tickLine={false} axisLine={false} width={36} tick={{ fontSize: 11 }} tickFormatter={(v) => fmtNum(Number(v))} />
            <ChartTooltip cursor={false} content={<ChartTooltipContent labelFormatter={(v) => shortDate(String(v))} valueFormatter={(v) => `${Number(v) >= 0 ? '+' : ''}${fmtFull(Number(v))}`} labelMap={{ value: 'Gained' }} />} />
            <Bar dataKey="value" name="Gained" radius={[3, 3, 0, 0]} maxBarSize={26}>
              {data.map((d, i) => (
                <Cell key={i} fill={d.value < 0 ? 'var(--color-danger)' : d.value === peak && d.value > 0 ? 'var(--color-accent)' : 'var(--color-label-quaternary)'} />
              ))}
            </Bar>
          </BarChart>
        </ChartContainer>
      ) : <Empty hint="Daily follower changes need 100+ followers" />}
    </ChartCard>
  );
}

export function InsightsPanel({
  activeUsername,
  igUserId,
  onReconnect,
}: {
  activeUsername: string | null;
  igUserId?: string;
  onReconnect?: () => void;
}) {
  const [days, setDays] = useState<(typeof WINDOWS)[number]>(30);
  const [data, setData] = useState<InsightsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const reqIdRef = useRef(0);

  useEffect(() => {
    if (!igUserId && !activeUsername) return;
    const reqId = ++reqIdRef.current;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    setLoading(true);
    setError('');
    (async () => {
      try {
        const res = await fetch(
          `/api/video-reels/meta/insights?days=${days}${igUserId ? `&igUserId=${encodeURIComponent(igUserId)}` : ''}`,
          { cache: 'no-store', signal: controller.signal },
        );
        const json = await res.json().catch(() => ({}));
        if (reqId !== reqIdRef.current) return;
        if (!res.ok) {
          // Append Meta's human-readable reason (error_user_msg/title) when present,
          // so an app-level block shows WHY, not just "API access blocked."
          setError(json?.detail ? `${json.error || 'API error'} — ${json.detail}` : (json?.error || 'Could not load analytics.'));
          setData(null);
        }
        else { setData(json as InsightsResponse); }
      } catch {
        if (reqId !== reqIdRef.current) return;
        setError('Could not load analytics.');
        setData(null);
      } finally {
        if (reqId === reqIdRef.current) setLoading(false);
        clearTimeout(timer);
      }
    })();
    return () => { clearTimeout(timer); controller.abort(); };
  }, [igUserId ?? activeUsername, days]);

  if (!igUserId && !activeUsername) return null;

  const warnings = data?.warnings ?? [];
  const needsReconnect = warnings.includes('needsReconnect') || warnings.includes('needsInsightsScope');
  const notProfessional = warnings.includes('notProfessional');
  const acct = data?.account;
  const m = data?.metrics;
  const gained = m?.followersGained;
  const erate =
    typeof m?.totalInteractions === 'number' && typeof m?.reach === 'number' && m.reach > 0
      ? `${((m.totalInteractions / m.reach) * 100).toFixed(1)}%`
      : '—';

  // Reach daily series → line data.
  const reachData = (data?.series?.reach ?? []).map((p) => ({ date: p.end_time, value: p.value }));
  // Follower deltas → gained bars, and a cumulative "followers over time" line
  // anchored to the current total.
  const deltas = data?.series?.followerCount ?? [];
  const gainedData = deltas.map((p) => ({ date: p.end_time, value: p.value }));
  const cumData: { date: string; value: number }[] = [];
  {
    let acc = acct?.followersCount ?? 0;
    for (let i = deltas.length - 1; i >= 0; i--) {
      cumData[i] = { date: deltas[i].end_time, value: acc };
      acc -= deltas[i].value;
    }
  }

  return (
    <section>
      {/* Identity + window toggle */}
      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <div className="flex items-center gap-3 min-w-0">
          {acct?.profilePictureUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={acct.profilePictureUrl} alt="" className="w-11 h-11 rounded-full object-cover shrink-0" />
          ) : (
            <div className="w-11 h-11 rounded-full bg-surface-2 shrink-0" />
          )}
          <div className="min-w-0">
            <div className="text-title3 font-semibold text-label truncate">@{acct?.username || activeUsername}</div>
            <div className="text-caption-sm text-label-tertiary tabular-nums">
              {fmt(acct?.followersCount)} followers · {fmt(acct?.mediaCount)} posts
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {WINDOWS.map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => setDays(w)}
              aria-pressed={days === w}
              className={`text-caption-sm px-3 py-1.5 rounded-md transition-colors ${
                days === w ? 'bg-accent text-on-accent' : 'bg-surface-2 text-label-secondary hover:text-label'
              }`}
            >
              {w}d
            </button>
          ))}
        </div>
      </div>

      {/* Warnings */}
      {needsReconnect && (
        <div className="mb-4 flex items-center justify-between gap-3 flex-wrap bg-surface-2 rounded-lg px-3 py-2">
          <span className="text-caption-sm text-label-secondary">Reconnect this page to enable analytics (adds the insights permission).</span>
          {onReconnect && (
            <button type="button" onClick={onReconnect} className="text-caption-sm font-medium px-2.5 py-1 rounded-md bg-accent text-on-accent hover:bg-accent-hover">Reconnect</button>
          )}
        </div>
      )}
      {notProfessional && !needsReconnect && (
        <div className="mb-4 bg-surface-2 rounded-lg px-3 py-2 text-caption-sm text-label-secondary">
          Analytics need a Business or Creator account. Switch this page to a professional account in the Instagram app.
        </div>
      )}
      {error && !acct && (
        <div className="mb-4 bg-surface-2 rounded-lg px-3 py-2 text-caption-sm text-danger">{error}</div>
      )}

      {/* KPI grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
        <Kpi
          label="Followers"
          value={fmt(acct?.followersCount)}
          sub={typeof gained === 'number' && gained !== 0 ? (
            <span className={gained > 0 ? 'text-accent' : 'text-danger'}>{gained > 0 ? '+' : ''}{fmt(gained)} · {days}d</span>
          ) : undefined}
        />
        <Kpi label="Reach" value={fmt(m?.reach)} sub={`last ${days}d`} />
        <Kpi label="Views" value={fmt(m?.views)} sub={`last ${days}d`} />
        <Kpi label="Interactions" value={fmt(m?.totalInteractions)} sub={`last ${days}d`} />
        <Kpi label="Profile taps" value={fmt(m?.profileLinksTaps)} sub={`last ${days}d`} />
        <Kpi label="Engagement" value={erate} sub="interactions / reach" />
      </div>

      {/* Line charts */}
      <div className="grid gap-4 lg:grid-cols-2 mb-4">
        <LineCard title="Reach" subtitle={`last ${days} days`} data={reachData} seriesLabel="Reach" loading={loading} emptyHint="No reach history for this window yet" />
        <LineCard title="Followers over time" subtitle={`last ${days} days`} data={cumData} seriesLabel="Followers" loading={loading} emptyHint="Follower history needs 100+ followers" />
      </div>

      {/* Followers gained per day */}
      <GainedCard data={gainedData} loading={loading} days={days} />
    </section>
  );
}
