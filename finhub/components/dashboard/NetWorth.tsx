"use client";

import { useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Sector } from "recharts";
import { usePortfolio } from "@/lib/hooks";
import { dateTime, money, pct, splitMoney } from "@/lib/format";
import { Delta, ErrorNote, Skeleton } from "@/components/ui";

const CLASSES = [
  { key: "cash", label: "Cash", color: "#3987E5" },
  { key: "cd", label: "CDs", color: "#D95926" },
  { key: "stocks", label: "Stocks", color: "#199E70" },
] as const;

export function NetWorth() {
  const { data, error, isLoading, mutate } = usePortfolio();

  if (error && !data) return <ErrorNote error={error} what="your portfolio" onRetry={() => mutate()} />;

  return (
    <section aria-labelledby="networth-title" className="grid gap-8 md:grid-cols-[minmax(0,1fr)_minmax(0,360px)] md:items-center">
      <div className="min-w-0">
        <h1 id="networth-title" className="text-sm text-ink-3">
          Net worth
        </h1>
        {isLoading || !data ? (
          <div className="mt-3 space-y-3">
            <Skeleton className="h-14 w-72" />
            <Skeleton className="h-5 w-48" />
          </div>
        ) : (
          <>
            {data.total == null ? <p className="mt-2 text-3xl text-ink">Awaiting prices</p> : <Hero value={data.total} />}
            {data.warnings?.length ? <p className="mt-2 text-xs text-down">{data.warnings.join(". ")}</p> : null}
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <Delta amount={data.day_change} fraction={data.day_change_pct} suffix="today" />
              <span className="text-ink-3">
                Updated {dateTime(data.as_of)}
                {data.market_open ? ", refreshing every minute" : ""}
              </span>
            </div>
          </>
        )}
      </div>
      <Allocation allocation={data?.allocation} total={data?.total} loading={isLoading || !data} />
    </section>
  );
}

function Hero({ value }: { value: number }) {
  const { whole, cents } = splitMoney(value);
  return (
    <p className="mt-1 text-[44px] font-semibold leading-[1.05] tracking-[-0.03em] text-ink sm:text-hero" aria-label={money(value, { cents: true })}>
      {whole}
      <span className="text-ink-3">{cents}</span>
    </p>
  );
}

function Allocation({
  allocation,
  total,
  loading,
}: {
  allocation?: { cash: number; cd: number; stocks: number };
  total?: number | null;
  loading: boolean;
}) {
  const [active, setActive] = useState<number | null>(null);

  if (!loading && allocation && total == null) return <p className="text-sm text-ink-3">Allocation weights await complete pricing.</p>;
  if (loading || !allocation || total == null) {
    return (
      <div className="flex items-center gap-5">
        <Skeleton className="h-[112px] w-[112px] shrink-0 rounded-full sm:h-[148px] sm:w-[148px]" />
        <div className="flex-1 space-y-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
        </div>
      </div>
    );
  }

  const rows = CLASSES.map((c) => ({ ...c, value: allocation[c.key], share: total ? allocation[c.key] / total : 0 }));
  const chartRows = rows.filter((r) => r.value > 0);
  const largest = rows.reduce((a, b) => (b.value > a.value ? b : a), rows[0]);
  const focus = active != null ? chartRows[active] : largest;

  return (
    <figure className="flex items-center gap-4 sm:gap-6" aria-label="Allocation of net worth">
      <div className="relative h-[112px] w-[112px] shrink-0 sm:h-[148px] sm:w-[148px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartRows}
              dataKey="value"
              nameKey="label"
              innerRadius="68%"
              outerRadius="94%"
              startAngle={90}
              endAngle={-270}
              stroke="#14110F"
              strokeWidth={2}
              isAnimationActive={false}
              activeIndex={active ?? undefined}
              activeShape={(props: unknown) => {
                const p = props as React.ComponentProps<typeof Sector>;
                return <Sector {...p} outerRadius={(Number(p.outerRadius) || 0) + 3} />;
              }}
              onMouseEnter={(_, i) => setActive(i)}
              onMouseLeave={() => setActive(null)}
            >
              {chartRows.map((r) => (
                <Cell key={r.key} fill={r.color} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        {focus && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
            <span className="text-lg font-semibold text-ink">{pct(focus.share, 0)}</span>
            <span className="text-2xs text-ink-3">{focus.label}</span>
          </div>
        )}
      </div>
      <figcaption className="min-w-0 flex-1">
        <ul className="space-y-2">
          {rows.map((r) => (
            <li
              key={r.key}
              className="grid grid-cols-[10px_minmax(0,1fr)_auto] items-center gap-x-2.5 whitespace-nowrap text-sm"
              onMouseEnter={() => {
                const i = chartRows.findIndex((c) => c.key === r.key);
                setActive(i === -1 ? null : i);
              }}
              onMouseLeave={() => setActive(null)}
            >
              <span aria-hidden className="h-2.5 w-2.5 rounded-[3px]" style={{ background: r.color }} />
              <span className="text-ink-2">
                {r.label} <span className="text-ink-3">{pct(r.share, 1)}</span>
              </span>
              <span className="num text-ink">{money(r.value)}</span>
            </li>
          ))}
        </ul>
      </figcaption>
    </figure>
  );
}
