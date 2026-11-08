"use client";

import Link from "next/link";
import { useReports } from "@/lib/hooks";
import { relativeTime } from "@/lib/format";
import { EmptyState, ErrorNote, SectionHeader, Skeleton, Ticker } from "@/components/ui";

export function RecentReports() {
  const { data, error, isLoading, mutate } = useReports("");
  const reports = (data?.results ?? []).slice(0, 4).map((r) => r.report);

  return (
    <section aria-labelledby="reports-title">
      <SectionHeader
        id="reports-title"
        title="Recent reports"
        action={
          <Link href="/reports" className="btn-quiet">
            All reports
          </Link>
        }
      />
      {error && !data ? (
        <ErrorNote error={error} what="reports" onRetry={() => mutate()} />
      ) : isLoading && !data ? (
        <div className="space-y-3">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : !reports.length ? (
        <EmptyState>No reports yet.</EmptyState>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-edge bg-surface [&>li]:px-4">
          {reports.map((r) => (
            <li key={r.id}>
              <Link href={`/reports/${encodeURIComponent(r.id)}`} className="group block py-3">
                <p className="font-display font-semibold text-lg leading-snug text-ink group-hover:text-accent">{r.title}</p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-ink-3">
                  <span>{relativeTime(r.created_at)}</span>
                  {r.tickers.slice(0, 3).map((t) => (
                    <Ticker key={t}>{t}</Ticker>
                  ))}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
