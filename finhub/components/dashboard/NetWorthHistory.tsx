"use client";

import { useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { HistoryRange, NetWorthPoint } from "@/lib/api";
import { useNetWorthHistory } from "@/lib/hooks";
import { money, shortDate } from "@/lib/format";
import { ErrorNote, Segmented, Skeleton, SectionHeader } from "@/components/ui";

const RANGES: { value: HistoryRange; label: string }[] = [
  { value: "1M", label: "1M" },
  { value: "3M", label: "3M" },
  { value: "1Y", label: "1Y" },
  { value: "ALL", label: "All" },
];

const LINE = "#3987E5";
const GRID = "#2C2724";
const MUTED = "#8F8780";

const compactUsd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 });

function tickDate(ts: string, range: HistoryRange) {
  const d = new Date(`${ts}T00:00:00Z`);
  return d.toLocaleDateString("en-US", range === "1Y" || range === "ALL" ? { month: "short", year: "2-digit", timeZone: "UTC" } : { month: "short", day: "numeric", timeZone: "UTC" });
}

export function NetWorthHistory() {
  const [range, setRange] = useState<HistoryRange>("3M");
  const { data, error, isLoading, mutate } = useNetWorthHistory(range);
  const points = useMemo(() => [...(data?.points ?? [])].sort((a, b) => a.ts.localeCompare(b.ts)), [data]);
  const first = points[0];
  const last = points[points.length - 1];

  return (
    <section aria-labelledby="history-title" className="rounded-lg border border-edge bg-surface p-5 sm:p-6">
      <SectionHeader
        id="history-title"
        title="Net worth over time"
        action={<Segmented label="Time range" options={RANGES} value={range} onChange={setRange} />}
      />
      {error && !data ? (
        <ErrorNote error={error} what="net worth history" onRetry={() => mutate()} />
      ) : isLoading && !data ? (
        <Skeleton className="h-[200px] w-full" />
      ) : points.length < 2 ? (
        <p className="text-sm text-ink-3">Not enough data yet.</p>
      ) : (
        <div className="h-[200px] w-full" role="img" aria-label={`Net worth from ${shortDate(first?.ts)} to ${shortDate(last?.ts)}`}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={points} margin={{ top: 8, right: 4, bottom: 0, left: 4 }}>
              <defs>
                <linearGradient id="nw-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={LINE} stopOpacity={0.14} />
                  <stop offset="100%" stopColor={LINE} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke={GRID} strokeWidth={1} />
              <XAxis
                dataKey="ts"
                tickFormatter={(v: string) => tickDate(v, range)}
                tick={{ fill: MUTED, fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: GRID }}
                minTickGap={48}
              />
              <YAxis
                orientation="right"
                width={56}
                domain={[(min: number) => min * 0.985, (max: number) => max * 1.01]}
                tickFormatter={(v: number) => compactUsd.format(v)}
                tick={{ fill: MUTED, fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                tickCount={4}
              />
              <Tooltip
                cursor={{ stroke: "rgba(237,233,228,0.3)", strokeWidth: 1 }}
                content={<HistoryTooltip />}
                isAnimationActive={false}
              />
              <Area
                type="monotone"
                dataKey="total"
                name="Net worth"
                stroke={LINE}
                strokeWidth={2}
                fill="url(#nw-fill)"
                baseValue="dataMin"
                isAnimationActive={false}
                activeDot={{ r: 4, fill: LINE, stroke: "#14110F", strokeWidth: 2 }}
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}

function HistoryTooltip({ active, payload }: { active?: boolean; payload?: { payload: NetWorthPoint }[] }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="min-w-[180px] rounded border border-line-strong bg-overlay px-3 py-2 text-xs shadow-lg">
      <p className="text-ink-3">{shortDate(p.ts)}</p>
      <p className="mt-0.5 text-sm font-semibold text-ink num">{money(p.total)}</p>
      <dl className="mt-1.5 grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 text-ink-2 num">
        <dt>Cash</dt>
        <dd className="text-right">{money(p.cash)}</dd>
        <dt>CDs</dt>
        <dd className="text-right">{money(p.cd)}</dd>
        <dt>Stocks</dt>
        <dd className="text-right">{money(p.stocks)}</dd>
      </dl>
    </div>
  );
}
