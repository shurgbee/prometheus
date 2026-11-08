"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { Bell, BellRing, Check, ChevronDown, ExternalLink, Phone } from "lucide-react";
import { api, type Alert } from "@/lib/api";
import { refresh, useAlerts } from "@/lib/hooks";
import { dateTime, pct, relativeTime } from "@/lib/format";
import { deliveryLabel } from "@/lib/labels";
import { EmptyState, ErrorNote, Segmented, Skeleton, TileHeader } from "@/components/ui";

export function AlertFeed() {
  const [status, setStatus] = useState<"open" | "all">("open");
  const { data: raw, error, isLoading, mutate } = useAlerts(status);
  const data = useMemo(() => (raw ? [...raw].sort((a, b) => b.ts.localeCompare(a.ts)) : raw), [raw]);
  // Remember which alerts were already on screen so only new arrivals animate.
  const seen = useRef<Set<string> | null>(null);
  const fresh = new Set<string>();
  if (data) {
    if (seen.current) data.forEach((a) => !seen.current!.has(a.id) && fresh.add(a.id));
  }
  useEffect(() => {
    if (!data) return;
    seen.current ??= new Set();
    data.forEach((a) => seen.current!.add(a.id));
  }, [data]);

  return (
    <section aria-labelledby="alerts-title" className="tile flex h-full flex-col">
      <TileHeader
        id="alerts-title"
        title="Alerts"
        icon={Bell}
        action={
          <Segmented
            label="Which alerts"
            value={status}
            onChange={setStatus}
            options={[
              { value: "open", label: "Open" },
              { value: "all", label: "All" },
            ]}
          />
        }
      />
      <div aria-live="polite" aria-relevant="additions">
        {error && !data ? (
          <ErrorNote error={error} what="alerts" onRetry={() => mutate()} />
        ) : isLoading && !data ? (
          <div className="space-y-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : !data?.length ? (
          <EmptyState>
            {status === "open"
              ? "No open alerts."
              : "No alerts."}
          </EmptyState>
        ) : (
          <ul className="-mt-3 divide-y divide-line overflow-y-auto md:max-h-[460px]">
            {data.map((a) => (
              <AlertRow key={a.id} alert={a} isNew={fresh.has(a.id)} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function AlertRow({ alert: a, isNew }: { alert: Alert; isNew: boolean }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const critical = a.level === "critical";
  const Icon = critical ? Phone : BellRing;

  async function ack() {
    setBusy(true);
    setError(null);
    try {
      await api.ackAlert(a.id);
      await refresh("alerts");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't acknowledge the alert.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className={clsx("py-3.5", isNew && "animate-row-in")}>
      <div className="grid grid-cols-[32px_minmax(0,1fr)] gap-x-3">
        <span
          className={clsx(
            "mt-0.5 flex h-8 w-8 items-center justify-center rounded-full",
            critical ? "bg-status-critical/15 text-status-critical" : "bg-status-normal/10 text-status-normal",
            isNew && critical && "animate-pulse-ring",
          )}
        >
          <Icon size={15} aria-hidden />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
            <p className="text-xs text-ink-3">
              <span className="font-semibold text-ink">{critical ? "Critical" : "Normal"}</span>
              <span className="num"> {a.severity}</span>
              <span>, {a.trigger_name}</span>
            </p>
            <time dateTime={a.ts} className="text-2xs text-ink-3" title={dateTime(a.ts)}>
              {relativeTime(a.ts)}
            </time>
          </div>
          <p className="mt-1 text-sm text-ink">{a.summary}</p>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className={clsx("text-xs", a.delivery_status === "failed" ? "text-down" : "text-ink-3")}>
              {deliveryLabel(a)}
              {a.attempts > 1 ? `, attempt ${a.attempts}` : ""}
            </span>
            <button
              className="inline-flex items-center gap-1 text-xs text-ink-2 hover:text-ink"
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
            >
              Why
              <ChevronDown size={13} aria-hidden className={clsx("transition-transform", open && "rotate-180")} />
            </button>
            <span className="ml-auto">
              {a.acked_at ? (
                <span className="inline-flex items-center gap-1 text-xs text-ink-3">
                  <Check size={13} aria-hidden /> Acknowledged {relativeTime(a.acked_at)}
                </span>
              ) : (
                <button className="btn-ghost py-1 text-xs" onClick={ack} disabled={busy}>
                  {busy ? "Acknowledging" : "Acknowledge"}
                </button>
              )}
            </span>
          </div>
          {error && (
            <p role="alert" className="mt-1 text-xs text-down">
              {error}
            </p>
          )}
          {open && <AlertDetail alert={a} />}
        </div>
      </div>
    </li>
  );
}

const FACTORS: { key: "magnitude" | "exposure" | "credibility" | "urgency"; label: string; weight: number }[] = [
  { key: "magnitude", label: "Magnitude", weight: 0.35 },
  { key: "exposure", label: "Exposure", weight: 0.25 },
  { key: "credibility", label: "Credibility", weight: 0.2 },
  { key: "urgency", label: "Urgency", weight: 0.2 },
];

function AlertDetail({ alert: a }: { alert: Alert }) {
  return (
    <div className="mt-3 space-y-3 rounded border border-line bg-raised p-3">
      {a.rationale && <p className="text-sm text-ink-2">{a.rationale}</p>}
      {a.breakdown && (
        <div>
          <p className="label mb-1.5">Severity breakdown</p>
          <dl className="grid gap-1.5">
            {FACTORS.map((f) => {
              const v = a.breakdown![f.key];
              return (
                <div key={f.key} className="grid grid-cols-[96px_minmax(0,1fr)_92px] items-center gap-3 text-xs">
                  <dt className="text-ink-2">{f.label}</dt>
                  <dd className="h-1.5 overflow-hidden rounded-full bg-raised" aria-hidden>
                    <span className="block h-full rounded-full bg-accent-strong" style={{ width: `${Math.max(0, Math.min(1, v)) * 100}%` }} />
                  </dd>
                  <dd className="text-right text-ink-3 num">
                    {pct(v, 0)} <span className="text-ink-3">{"\u00d7"} {f.weight}</span>
                  </dd>
                </div>
              );
            })}
            <div className="grid grid-cols-[96px_minmax(0,1fr)_92px] items-center gap-3 text-xs">
              <dt className="text-ink-2">Adjustment</dt>
              <dd className="text-ink-3">From the triage model, limited to 15 points either way</dd>
              <dd className="text-right text-ink num">
                {a.breakdown.adjustment > 0 ? "+" : ""}
                {a.breakdown.adjustment}
              </dd>
            </div>
          </dl>
        </div>
      )}
      {a.evidence.length > 0 && (
        <div>
          <p className="label mb-1">Evidence</p>
          <ul className="space-y-1">
            {a.evidence.map((e, i) => (
              <li key={`${e.url}-${i}`}>
                <a href={e.url} target="_blank" rel="noreferrer" className="inline-flex items-start gap-1 text-sm text-accent hover:underline">
                  <span>{e.title}</span>
                  <ExternalLink size={12} aria-hidden className="mt-1 shrink-0" />
                </a>
                {e.publisher && <span className="ml-1 text-xs text-ink-3">{e.publisher}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
