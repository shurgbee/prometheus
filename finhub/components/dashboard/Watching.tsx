"use client";

import { useState } from "react";
import clsx from "clsx";
import { Pause, Play, Trash2 } from "lucide-react";
import { api, type EventState, type Trigger } from "@/lib/api";
import { refresh, useEvaluations, useTriggers } from "@/lib/hooks";
import { money, relativeTime, shortDate } from "@/lib/format";
import { EmptyState, ErrorNote, LevelBadge, SectionHeader, Skeleton, Ticker } from "@/components/ui";
import { SeverityTrace } from "./SeverityTrace";
import { signalLabel } from "@/lib/labels";

export function Watching() {
  const { data, error, isLoading, mutate } = useTriggers();

  return (
    <section aria-labelledby="watching-title">
      <SectionHeader
        id="watching-title"
        title="Watching"
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
          Nothing watched yet.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-edge bg-surface [&>li]:px-4">
          {data.map((t) => (
            <TriggerRow key={t.id} trigger={t} />
          ))}
        </ul>
      )}
    </section>
  );
}

function PriceProgress({ level, direction, price, label }: { level: number; direction: "above" | "below"; price: number | null; label: string }) {
  if (price == null) return <p className="text-sm text-ink-2">Waiting for price.</p>;
  const reached = direction === "above" ? price >= level : price <= level;
  const fraction = Math.min(direction === "above" ? price / level : level / price, 1);
  const remaining = Math.abs(level - price);
  const needed = (remaining / price) * 100;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-semibold text-ink num">{money(price, { cents: true })}</span>
        <span className="text-ink-2 num">Target {money(level)}</span>
      </div>
      <div
        className="mt-2 h-1.5 overflow-hidden rounded-pill bg-white/10"
        role="progressbar"
        aria-label={`${label}: progress to target`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(fraction * 100)}
      >
        <div className="h-full rounded-pill bg-accent" style={{ width: `${fraction * 100}%` }} />
      </div>
      <p className="mt-2 text-xs text-ink-2 num">
        {reached ? "Target reached" : `${money(remaining)} to go, needs a ${needed.toFixed(1)}% ${direction === "above" ? "rise" : "fall"}`}
      </p>
    </div>
  );
}

function EventStatus({ state, deadline }: { state: EventState | null | undefined; deadline: string | null }) {
  if (state?.outcome === "happened") {
    return (
      <div>
        <p className="text-sm font-semibold text-ink">Happened</p>
        <a href={state.url} target="_blank" rel="noreferrer" className="mt-1 block truncate text-xs text-accent hover:underline" title={state.title}>
          {state.title}
        </a>
      </div>
    );
  }
  if (state?.outcome === "expired") {
    return <p className="text-sm text-ink-2">Deadline passed.</p>;
  }
  const checked = state?.checked ?? 0;
  return (
    <div>
      <p className="text-sm font-semibold text-ink">Not yet</p>
      <p className="mt-1 text-xs text-ink-2 num">
        {checked.toLocaleString("en-US")} article{checked === 1 ? "" : "s"} checked{deadline ? `, watching until ${shortDate(deadline)}` : ""}
      </p>
    </div>
  );
}

function TriggerRow({ trigger: t }: { trigger: Trigger }) {
  const { data: evals } = useEvaluations(t.id);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const paused = t.status === "paused";
  const levelSignal = t.signals.find((s) => s.detector === "price_level");
  const eventSignal = t.signals.find((s) => s.detector === "event_occurs");

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
        {!levelSignal && !eventSignal && (
          <p className="mt-1 line-clamp-2 text-xs text-ink-3" title={t.hypothesis}>
            {t.hypothesis}
          </p>
        )}
      </div>

      <div className="mr-9 min-w-0">
        {eventSignal ? (
          <EventStatus state={t.event_state} deadline={typeof eventSignal.params?.deadline === "string" ? eventSignal.params.deadline : null} />
        ) : levelSignal ? (
          <PriceProgress
            level={Number(levelSignal.params?.level)}
            direction={levelSignal.params?.direction === "below" ? "below" : "above"}
            price={t.latest_price ?? null}
            label={t.name}
          />
        ) : evals ? (
          <SeverityTrace evaluations={evals} label={t.name} />
        ) : (
          <Skeleton className="h-16 w-full" />
        )}
      </div>

      <div className="flex items-center justify-between gap-4 md:w-[176px] md:flex-col md:items-end md:justify-center md:gap-1.5">
        <div className="text-right">
          {paused ? <span className="text-xs text-ink-3">Paused</span> : <LevelBadge level={t.last_level} />}
          <p className="text-2xs text-ink-3">
            {t.last_severity != null && !levelSignal && !eventSignal ? `Severity ${t.last_severity}, ` : ""}
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
