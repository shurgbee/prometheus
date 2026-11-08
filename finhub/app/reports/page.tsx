"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { api, type ReportSummary, type ResearchJob } from "@/lib/api";
import { useReports } from "@/lib/hooks";
import { relativeTime } from "@/lib/format";
import { EmptyState, ErrorNote, Skeleton, Ticker } from "@/components/ui";
import { ResearchNotice } from "@/components/chat/ResearchNotice";

export default function ReportsPage() {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  const { data, error, isLoading, isValidating, mutate } = useReports(debounced);
  const searching = debounced.length > 0;

  return (
    <div className="space-y-10">
      <header>
        <h1 className="font-display font-semibold text-3xl text-ink sm:text-[44px] sm:leading-[48px]">Reports</h1>
      </header>

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-6">
          <div className="relative">
            <label htmlFor="report-search" className="sr-only">
              Search reports
            </label>
            <Search size={16} aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3" />
            <input
              id="report-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search reports"
              className="field rounded-pill py-2.5 pl-10"
            />
          </div>

          {error && !data ? (
            <ErrorNote error={error} what="reports" onRetry={() => mutate()} />
          ) : isLoading && !data ? (
            <div className="space-y-4">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : (
            <div className="space-y-8" aria-busy={isValidating || undefined}>
              <div>
                {searching && (
                  <p className="mb-2 text-sm text-ink-3" aria-live="polite">
                    {data?.results.length
                      ? `${data.results.length} best match${data.results.length === 1 ? "" : "es"} for "${debounced}"`
                      : `No reports match "${debounced}".`}
                  </p>
                )}
                {!searching && !data?.results.length ? (
                  <EmptyState>No reports yet.</EmptyState>
                ) : (
                  <ul className="divide-y divide-line overflow-hidden rounded-lg border border-edge bg-surface [&>li]:px-4">
                    {data?.results.map((hit) => (
                      <ReportRow key={hit.report.id} report={hit.report} passage={hit.passage} />
                    ))}
                  </ul>
                )}
              </div>
              {searching && !!data?.similar.length && (
                <div>
                  <h2 className="section-title mb-2 text-xl">Similar reports</h2>
                  <ul className="divide-y divide-line overflow-hidden rounded-lg border border-edge bg-surface [&>li]:px-4">
                    {data.similar.map((r) => (
                      <ReportRow key={r.id} report={r} />
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        <NewReport />
      </div>
    </div>
  );
}

function ReportRow({ report: r, passage }: { report: ReportSummary; passage?: string | null }) {
  return (
    <li>
      <Link href={`/reports/${encodeURIComponent(r.id)}`} className="group block py-4">
        <p className="font-display font-semibold text-xl leading-snug text-ink group-hover:text-accent">{r.title}</p>
        <p className="mt-1 line-clamp-2 text-sm text-ink-2">{passage ? <>&ldquo;{passage}&rdquo;</> : r.summary}</p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-ink-3">
          <span>{relativeTime(r.created_at)}</span>
          {r.tickers.map((t) => (
            <Ticker key={t}>{t}</Ticker>
          ))}
        </div>
      </Link>
    </li>
  );
}

function NewReport() {
  const [topic, setTopic] = useState("");
  const [jobs, setJobs] = useState<ResearchJob[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start(e: React.FormEvent) {
    e.preventDefault();
    if (!topic.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const job = await api.startResearch(topic.trim());
      setJobs((js) => [job, ...js]);
      setTopic("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't start the report.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside aria-labelledby="new-report-title" className="h-fit rounded-lg border border-edge bg-surface p-4">
      <h2 id="new-report-title" className="text-sm font-semibold text-ink">
        Start a report
      </h2>
      <form onSubmit={start} className="mt-3 space-y-2">
        <label htmlFor="new-report-topic" className="sr-only">
          Report topic
        </label>
        <textarea
          id="new-report-topic"
          className="field min-h-[72px] resize-y"
          placeholder="e.g. Tesla's US position and the risks to it"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
        />
        <button className="btn-primary w-full py-2" disabled={busy || !topic.trim()}>
          {busy ? "Starting" : "Start report"}
        </button>
      </form>
      {error && (
        <p role="alert" className="mt-2 text-xs text-down">
          {error}
        </p>
      )}
      {jobs.length > 0 && (
        <ul className="mt-4 space-y-2">
          {jobs.map((j) => (
            <li key={j.job_id}>
              <ResearchNotice jobId={j.job_id} topic={j.topic} />
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
