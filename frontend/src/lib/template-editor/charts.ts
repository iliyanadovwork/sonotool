// ─────────────────────────────────────────────────────────────────────────────
// Chart-data helpers. A template-editor ChartBox snapshots a self-contained series
// `{ index: number; timestamp: string }[]` so it renders/exports with no network
// call. Agents normally pass their own numbers (defaultChartBox takes `data`
// directly); these helpers (a) normalize {value,date} pairs into that shape and
// (b) optionally pull a live Google-Trends series from the running app so a chart
// can be data-backed without hand-typing points.
// ─────────────────────────────────────────────────────────────────────────────

export interface SeriesPoint { value: number; date: string | number | Date }
export type ChartSeries = { index: number; timestamp: string }[];

/** Normalize {value,date} pairs into the ChartBox.data shape (ISO timestamps, ascending). */
export function toChartData(points: SeriesPoint[]): ChartSeries {
  const out: ChartSeries = [];
  for (const p of points) {
    const d = new Date(p.date);
    if (!Number.isFinite(p.value) || Number.isNaN(d.getTime())) continue;
    out.push({ index: p.value, timestamp: d.toISOString() });
  }
  return out.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

/** Pull a Google-Trends interest-over-time series for `term` from the running app
 *  (`/api/charts/trends`) and map it into ChartBox.data. Needs the dev/prod server up. */
export async function fetchTrendData(appUrl: string, term: string): Promise<ChartSeries> {
  const res = await fetch(`${appUrl}/api/charts/trends?term=${encodeURIComponent(term)}`);
  if (!res.ok) throw new Error(`trends fetch for "${term}" failed: ${res.status}`);
  const points = await res.json() as unknown;
  if (!Array.isArray(points)) throw new Error(`trends endpoint returned no series for "${term}"`);
  return toChartData((points as { timestamp: number; value: number }[]).map(p => ({ value: p.value, date: p.timestamp })));
}
