"use client";

import { useEffect, useState } from "react";
import { Layers, Wallet } from "lucide-react";
import { Cell, Pie, PieChart, Sector } from "recharts";
import { usePortfolio } from "@/lib/hooks";
import { dateTime, money, pct } from "@/lib/format";
import CountUp from "@/components/CountUp";
import { Delta, ErrorNote, Skeleton, TileHeader } from "@/components/ui";

const CLASSES = [
  { key: "cash", label: "Cash", color: "#F6F4F4" },
  { key: "cd", label: "CDs", color: "#A3A3A6" },
  { key: "stocks", label: "Stocks", color: "#B04A45" },
] as const;

const SWEEP_MS = 900;
const GAUGE = { width: 240, height: 124, outer: 116, inner: 92 };

// Recharts animates in JS, so the global prefers-reduced-motion CSS rule does not reach it.
function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

export function NetWorth() {
  const { data, error, isLoading, mutate } = usePortfolio();

  return (
    <section aria-labelledby="networth-title" className="tile tile-hero flex h-full min-h-[280px] flex-col">
      <TileHeader id="networth-title" title="Net worth" icon={Wallet} />
      {error && !data ? (
        <ErrorNote error={error} what="your portfolio" onRetry={() => mutate()} />
      ) : isLoading || !data ? (
        <div className="mt-auto space-y-3">
          <Skeleton className="h-14 w-72 max-w-full" />
          <Skeleton className="h-5 w-48" />
        </div>
      ) : (
        <div className="mt-auto min-w-0">
          {data.total == null ? <p className="text-3xl text-ink">Awaiting prices</p> : <Hero value={data.total} />}
          {data.warnings?.length ? <p className="mt-2 text-xs text-ink">{data.warnings.join(". ")}</p> : null}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <Delta amount={data.day_change} fraction={data.day_change_pct} suffix="today" className="!text-ink [&_span]:!text-ink" />
            <span className="text-ink-2">
              Updated {dateTime(data.as_of)}
              {data.market_open ? ", refreshing every minute" : ""}
            </span>
          </div>
        </div>
      )}
    </section>
  );
}

function Hero({ value }: { value: number }) {
  return (
    <p className="text-[40px] font-medium leading-[1.05] tracking-[-0.02em] text-ink sm:text-[52px] 2xl:text-[64px]" aria-label={money(value, { cents: true })}>
      <CountUp
        to={value}
        mode="roll"
        easing="expo"
        duration={1}
        decimals={2}
        prefix="$"
        separator=","
        trigger="load"
        fractionClassName="text-ink-2"
        proportional
        className="inline-block align-top"
        style={{ marginBlock: "-0.075em" }} // keeps the roll's 1.2em cells inside the original line height
      />
    </p>
  );
}

export function Allocation() {
  const { data, error, isLoading, mutate } = usePortfolio();
  const [active, setActive] = useState<number | null>(null);
  const reducedMotion = useReducedMotion();
  const allocation = data?.allocation;
  const total = data?.total;

  const shell = (children: React.ReactNode) => (
    <section aria-labelledby="allocation-title" className="tile flex h-full flex-col">
      <TileHeader id="allocation-title" title="Allocation" icon={Layers} />
      {children}
    </section>
  );

  if (error && !data) return shell(<ErrorNote error={error} what="allocation" onRetry={() => mutate()} />);
  if (!isLoading && allocation && total == null) return shell(<p className="text-sm text-ink-3">Allocation weights await complete pricing.</p>);
  if (isLoading || !allocation || total == null) {
    return shell(
      <div className="space-y-3">
        <Skeleton className="mx-auto h-[124px] w-[240px] max-w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
      </div>,
    );
  }

  const rows = CLASSES.map((c) => ({ ...c, value: allocation[c.key], share: total ? allocation[c.key] / total : 0 }));
  const chartRows = rows.filter((r) => r.value > 0);
  const largest = rows.reduce((a, b) => (b.value > a.value ? b : a), rows[0]);
  const focus = active != null ? chartRows[active] : largest;

  return shell(
    <figure className="flex flex-1 flex-col justify-between gap-4" aria-label="Allocation of net worth">
      <div className="relative mx-auto" style={{ width: GAUGE.width, height: GAUGE.height }}>
        <PieChart width={GAUGE.width} height={GAUGE.height} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
          <Pie
            data={chartRows}
            dataKey="value"
            nameKey="label"
            cx={GAUGE.width / 2}
            cy={GAUGE.height - 4}
            innerRadius={GAUGE.inner}
            outerRadius={GAUGE.outer}
            startAngle={180}
            endAngle={0}
            cornerRadius={4}
            stroke="#151516"
            strokeWidth={2}
            isAnimationActive={!reducedMotion}
            animationBegin={0}
            animationDuration={SWEEP_MS}
            animationEasing="ease-out"
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
        {focus && (
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center text-center"
            style={{ animation: `row-in 380ms cubic-bezier(0.2, 0.7, 0.2, 1) ${SWEEP_MS * 0.6}ms both` }}
          >
            <span className="text-3xl font-medium tracking-[-0.02em] text-ink num">{pct(focus.share, 0)}</span>
            <span className="text-xs text-ink-3">{focus.label}</span>
          </div>
        )}
      </div>
      <figcaption>
        <ul className="space-y-1.5">
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
    </figure>,
  );
}
