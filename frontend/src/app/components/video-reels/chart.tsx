'use client';

import type { ReactNode, ReactElement } from 'react';
import { ResponsiveContainer, Tooltip } from 'recharts';

// Minimal shadcn/Recharts chart primitives, adapted to sonotool's semantic tokens
// (Shared with the companion app's chart.tsx). ChartContainer styles the recharts
// axis/grid via the token CSS vars; ChartTooltipContent renders a themed hover
// tooltip. Colors are passed directly to Line/Bar as var(--color-accent) etc.

export function ChartContainer({ className = '', children }: { className?: string; children: ReactElement }) {
  return (
    <div
      className={`w-full text-caption-sm [&_.recharts-cartesian-axis-tick_text]:fill-[var(--color-label-tertiary)] [&_.recharts-cartesian-grid_line]:stroke-[var(--color-separator)] [&_.recharts-cartesian-grid_line]:opacity-60 [&_.recharts-layer]:outline-none [&_.recharts-sector]:outline-none [&_.recharts-surface]:outline-none ${className}`}
    >
      <ResponsiveContainer width="100%" height="100%">
        {children}
      </ResponsiveContainer>
    </div>
  );
}

export const ChartTooltip = Tooltip;

interface TooltipItem {
  dataKey?: string;
  name?: string;
  value?: number | string;
  color?: string;
}

export function ChartTooltipContent({
  active,
  payload,
  label,
  labelFormatter,
  hideLabel,
  valueFormatter,
  labelMap,
}: {
  active?: boolean;
  payload?: TooltipItem[];
  label?: string | number;
  labelFormatter?: (v: string | number) => ReactNode;
  hideLabel?: boolean;
  valueFormatter?: (v: number | string) => ReactNode;
  labelMap?: Record<string, string>;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="min-w-[8rem] rounded-xl border border-separator bg-surface-2 px-3 py-2 shadow-lg">
      {!hideLabel && label != null && (
        <div className="mb-1 text-caption-sm font-medium text-label">{labelFormatter ? labelFormatter(label) : label}</div>
      )}
      <div className="flex flex-col gap-1">
        {payload.map((item, i) => {
          const key = (item.dataKey ?? item.name ?? '') as string;
          const color = item.color ?? 'var(--color-accent)';
          const v = item.value;
          return (
            <div key={i} className="flex items-center gap-2 text-caption-sm">
              <span className="w-2 h-2 shrink-0 rounded-[2px]" style={{ background: color }} aria-hidden />
              <span className="text-label-tertiary">{labelMap?.[key] ?? item.name ?? key}</span>
              <span className="ml-auto font-medium tabular-nums text-label">
                {valueFormatter ? valueFormatter(v as number) : typeof v === 'number' ? v.toLocaleString() : v}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
