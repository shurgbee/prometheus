"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { ApiError } from "@/lib/api";
import { useReport } from "@/lib/hooks";
import { shortDate } from "@/lib/format";
import { EmptyState, ErrorNote, Skeleton, Ticker } from "@/components/ui";

function hostname(url: string): string {
  try {
    return new URL(url).hostname || url;
  } catch {
    return url;
  }
}

export default function ReportPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ? decodeURIComponent(params.id) : null;
  const { data: r, error, isLoading, mutate } = useReport(id);

  return (
    <article className="mx-auto max-w-[720px]">
      <Link href="/reports" className="inline-flex items-center gap-1.5 text-sm text-ink-3 hover:text-ink">
        <ArrowLeft size={14} aria-hidden /> All reports
      </Link>

      {error && !r ? (
        <div className="mt-8">
          {error instanceof ApiError && error.status === 404 ? (
            <EmptyState action={<Link href="/reports" className="btn-ghost">Back to reports</Link>}>This report doesn&apos;t exist or was removed.</EmptyState>
          ) : (
            <ErrorNote error={error} what="the report" onRetry={() => mutate()} />
          )}
        </div>
      ) : isLoading || !r ? (
        <div className="mt-8 space-y-4">
          <Skeleton className="h-12 w-3/4" />
          <Skeleton className="h-5 w-1/3" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : (
        <>
          <header className="mt-6 border-b border-line pb-6">
            <h1 className="font-serif text-3xl leading-tight text-ink sm:text-[44px] sm:leading-[1.08]">{r.title}</h1>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-ink-3">
              <span>{shortDate(r.created_at)}</span>
              {r.tickers.map((t) => (
                <Ticker key={t}>{t}</Ticker>
              ))}
            </div>
            <p className="mt-4 text-lg leading-relaxed text-ink-2">{r.summary}</p>
          </header>

          <div className="prose-fin mt-6 text-base">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                a: ({ href, children }) => (
                  <a href={href} target="_blank" rel="noreferrer">
                    {children}
                  </a>
                ),
              }}
            >
              {r.body_md.replace(/^# ([^\r\n]+)\r?\n+/, (heading, title: string) =>
                title.trim() === r.title.trim() ? "" : heading)}
            </ReactMarkdown>
          </div>

          {r.sources.length > 0 && (
            <section aria-labelledby="sources-title" className="mt-10 border-t border-line pt-6">
              <h2 id="sources-title" className="section-title text-xl">
                Sources
              </h2>
              <ol className="mt-3 space-y-3">
                {r.sources.map((s, i) => (
                  <li key={`${s.url}-${i}`} className="grid grid-cols-[24px_minmax(0,1fr)] gap-x-2 text-sm">
                    <span className="text-ink-3 num">{i + 1}.</span>
                    <div className="min-w-0">
                      <a href={s.url} target="_blank" rel="noreferrer" className="inline-flex items-start gap-1 break-all text-accent hover:underline">
                        {s.publisher || hostname(s.url)}
                        <ExternalLink size={12} aria-hidden className="mt-1 shrink-0" />
                      </a>
                      {s.published_at && <span className="ml-2 text-xs text-ink-3">{shortDate(s.published_at)}</span>}
                      {s.excerpt && <p className="mt-0.5 text-ink-2">{s.excerpt}</p>}
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {r.similar.length > 0 && (
            <section aria-labelledby="similar-title" className="mt-10 border-t border-line pt-6">
              <h2 id="similar-title" className="section-title text-xl">
                Similar reports
              </h2>
              <ul className="mt-2 divide-y divide-line">
                {r.similar.map((s) => (
                  <li key={s.id}>
                    <Link href={`/reports/${encodeURIComponent(s.id)}`} className="group block py-3">
                      <p className="font-serif text-lg text-ink group-hover:text-accent">{s.title}</p>
                      <p className="mt-0.5 line-clamp-1 text-sm text-ink-3">{s.summary}</p>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </article>
  );
}
