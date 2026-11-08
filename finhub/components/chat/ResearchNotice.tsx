"use client";

import Link from "next/link";
import { useEffect } from "react";
import useSWR from "swr";
import { CircleAlert, FileText, Loader2 } from "lucide-react";
import { api, type ResearchJob } from "@/lib/api";
import { refresh } from "@/lib/hooks";

/** Polls a research job every 3 s until it finishes, then links to the report. */
export function ResearchNotice({ jobId, topic }: { jobId: string; topic: string }) {
  const { data, error } = useSWR<ResearchJob>(["research", jobId], () => api.getResearchJob(jobId), {
    refreshInterval: (latest) => (latest && (latest.status === "done" || latest.status === "failed") ? 0 : 3000),
  });

  const status = data?.status;
  useEffect(() => {
    if (status === "done") void refresh("reports");
  }, [status]);

  return (
    <div className="flex items-start gap-3 rounded border border-line bg-plane px-3 py-2.5">
      <span className="mt-0.5 text-ink-3">
        {status === "done" ? (
          <FileText size={15} aria-hidden />
        ) : status === "failed" || (error && !data) ? (
          <CircleAlert size={15} className="text-down" aria-hidden />
        ) : (
          <Loader2 size={15} className="animate-spin" aria-hidden />
        )}
      </span>
      <div className="min-w-0 text-sm" aria-live="polite">
        <p className="text-ink">{data?.topic ?? topic}</p>
        {status === "done" && data?.report_id ? (
          <Link href={`/reports/${encodeURIComponent(data.report_id)}`} className="text-xs text-accent hover:underline">
            Read the report
          </Link>
        ) : status === "failed" ? (
          <p className="text-xs text-ink-2">The report failed: {data?.error || "no reason given"}. Ask again to retry.</p>
        ) : error && !data ? (
          <p className="text-xs text-ink-2">Couldn&apos;t check on the report. It may still be running; look under Reports in a minute.</p>
        ) : (
          <p className="text-xs text-ink-3">{status === "running" ? "Researching and writing" : "Queued"}. This usually takes a couple of minutes.</p>
        )}
      </div>
    </div>
  );
}
