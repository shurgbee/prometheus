"use client";

import { useState } from "react";
import clsx from "clsx";
import { Pause, Play, Trash2 } from "lucide-react";
import { api, type Trigger } from "@/lib/api";
import { refresh, useEvaluations, useTriggers } from "@/lib/hooks";
import { relativeTime } from "@/lib/format";
import { EmptyState, ErrorNote, LevelBadge, SectionHeader, Skeleton, Ticker } from "@/components/ui";
import { SeverityTrace } from "./SeverityTrace";
import { signalLabel } from "@/lib/labels";

export function Watching() {
  const { data, error, isLoading, mutate } = useTriggers();
  const active = data?.filter((t) => t.status === "active").length ?? 0;

  return (
    <section aria-labelledby="watching-title">
      <SectionHeader
        id="watching-title"
        title="Watching"
        description={
          data?.length
            ? `${active} active trigger${active === 1 ? "" : "s"}. Each line is the last 24 hours of severity checks.`
            : "Triggers check news, filings and prices, then text or call you when something matters."
        }
      />
      {error && !data ? (
        <ErrorNote error={error} what="triggers" onRetry={() => mutate()} />
      ) : isLoading && !data ? (
        <div className="space-y-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : !data?.length ? (
        <EmptyState>
          Nothing is being watched yet. Ask the advisor about something you&apos;ve noticed, like &ldquo;I see a lot of Teslas on the road,
          why?&rdquo;, and approve the triggers it suggests.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-line border-y border-line">
          {data.map((t) => (
            <TriggerRow key={t.id} trigger={t} />
          ))}
        </ul>
      )}
    </section>
  );
}

function TriggerRow({ trigger: t }: { trigger: Trigger }) {
  const { data: evals } = useEvaluations(t.id);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const paused = t.status === "paused";

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await refresh("triggers");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <li className={clsx("grid gap-x-6 gap-y-3 py-4 md:grid-cols-[minmax(0,240px)_minmax(0,1fr)_auto] md:items-center", paused && "opacity-60")}>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-ink" title={t.name}>
          {t.name}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {t.tickers.map((tk) => (
            <Ticker key={tk}>{tk}</Ticker>
          ))}
          <span className="text-xs text-ink-3">{t.signals.map((s) => signalLabel(s.source)).join(", ")}</span>
        </div>
        <p className="mt-1 line-clamp-2 text-xs text-ink-3" title={t.hypothesis}>
          {t.hypothesis}
        </p>
      </div>

      <div className="mr-9 min-w-0">
        {evals ? <SeverityTrace evaluations={evals} label={t.name} /> : <Skeleton className="h-16 w-full" />}
      </div>

      <div className="flex items-center justify-between gap-4 md:w-[176px] md:flex-col md:items-end md:justify-center md:gap-1.5">
        <div className="text-right">
          {paused ? <span className="text-xs text-ink-3">Paused</span> : <LevelBadge level={t.last_level} />}
          <p className="text-2xs text-ink-3">
            {t.last_severity != null ? `Severity ${t.last_severity}, ` : ""}
            checked {relativeTime(t.last_checked_at)}
          </p>
        </div>
        <div className="flex items-center gap-1">
          {confirming ? (
            <>
              <span className="text-xs text-ink-2">Stop watching?</span>
              <button className="btn-quiet text-down" disabled={busy} onClick={() => run(() => api.deleteTrigger(t.id))}>
                Remove
              </button>
              <button className="btn-quiet" onClick={() => setConfirming(false)}>
                Keep
              </button>
            </>
          ) : (
            <>
              <button
                className="btn-quiet"
                disabled={busy}
                onClick={() => run(() => api.updateTrigger(t.id, { status: paused ? "active" : "paused" }))}
                aria-label={paused ? `Resume ${t.name}` : `Pause ${t.name}`}
                title={paused ? "Resume" : "Pause"}
              >
                {paused ? <Play size={14} aria-hidden /> : <Pause size={14} aria-hidden />}
                {paused ? "Resume" : "Pause"}
              </button>
              <button
                className="btn-quiet"
                disabled={busy}
                onClick={() => setConfirming(true)}
                aria-label={`Remove ${t.name}`}
                title="Remove"
              >
                <Trash2 size={14} aria-hidden />
              </button>
            </>
          )}
        </div>
        {error && (
          <p role="alert" className="text-xs text-down">
            {error}
          </p>
        )}
      </div>
    </li>
  );
}
