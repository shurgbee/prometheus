"use client";

import { CalendarClock } from "lucide-react";
import { usePortfolio } from "@/lib/hooks";
import { daysUntil, money, pct, shortDate } from "@/lib/format";
import { EmptyState, ErrorNote, Skeleton, TileHeader } from "@/components/ui";

export function CdLadder() {
  const { data, error, isLoading, mutate } = usePortfolio();
  const cds = (data?.holdings ?? [])
    .filter((h) => h.asset_class === "cd")
    .sort((a, b) => (a.maturity_date ?? "9999").localeCompare(b.maturity_date ?? "9999"));

  return (
    <section aria-labelledby="cd-title" className="tile flex h-full flex-col">
      <TileHeader id="cd-title" title="CD ladder" icon={CalendarClock} />
      {error && !data ? (
        <ErrorNote error={error} what="CDs" onRetry={() => mutate()} />
      ) : isLoading && !data ? (
        <Skeleton className="h-24 w-full" />
      ) : !cds.length ? (
        <EmptyState>No CDs yet.</EmptyState>
      ) : (
        <ul className="-mt-3 divide-y divide-line">
          {cds.map((cd) => {
            const left = daysUntil(cd.maturity_date);
            const total = cd.start_date && cd.maturity_date ? daysUntil(cd.maturity_date, new Date(`${cd.start_date}T12:00:00Z`)) : null;
            const progress = total && left != null ? Math.max(0, Math.min(1, 1 - left / total)) : null;
            return (
              <li key={cd.id} className="grid gap-x-6 gap-y-2 py-3.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_auto] sm:items-center">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink">{cd.name}</p>
                  <p className="text-xs text-ink-3 num">
                    {money(cd.principal)} at {pct(cd.apy, 2)} APY
                  </p>
                </div>
                <div className="min-w-0">
                  {progress != null ? (
                    <div
                      className="h-1.5 overflow-hidden rounded-full bg-raised"
                      role="progressbar"
                      aria-label={`${cd.name} term elapsed`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(progress * 100)}
                    >
                      <span className="block h-full rounded-full bg-ink" style={{ width: `${progress * 100}%` }} />
                    </div>
                  ) : (
                    <div className="h-1.5 rounded-full bg-raised" />
                  )}
                  <p className="mt-1 flex justify-between text-2xs text-ink-3">
                    <span>{shortDate(cd.start_date)}</span>
                    <span>{shortDate(cd.maturity_date)}</span>
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm text-ink num">{money(cd.value, { cents: true })}</p>
                  <p className="text-2xs text-ink-3">
                    {left == null ? "No maturity date" : left > 0 ? `${left} day${left === 1 ? "" : "s"} to maturity` : left === 0 ? "Matures today" : "Matured"}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
