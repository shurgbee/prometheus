"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import Link from "next/link";
import clsx from "clsx";
import { Check, CircleAlert, ExternalLink, Eye, Loader2 } from "lucide-react";
import type { Message, Part } from "./ChatContext";
import { ProposalCards } from "./ProposalCards";
import { ResearchNotice } from "./ResearchNotice";

export function MessageView({ message, live }: { message: Message; live: boolean }) {
  if (message.role === "user") {
    const text = message.parts.find((p) => p.kind === "text");
    return (
      <li className="flex justify-end">
        <p className="max-w-[85%] whitespace-pre-wrap rounded-lg rounded-br-sm bg-raised px-3.5 py-2 text-sm text-ink">
          {text?.kind === "text" ? text.text : ""}
        </p>
      </li>
    );
  }

  const empty = message.parts.length === 0;
  return (
    <li className="space-y-3" aria-busy={live || undefined}>
      {empty && live && (
        <p className="flex items-center gap-2 text-sm text-ink-2">
          <Loader2 size={14} className="animate-spin" aria-hidden /> Thinking
        </p>
      )}
      {empty && !live && !message.stopped && <p className="text-sm text-ink-3">No response.</p>}
      {message.parts.map((p, i) => (
        <PartView key={i} part={p} messageId={message.id} caret={live && i === message.parts.length - 1 && p.kind === "text"} />
      ))}
      {message.stopped && <p className="text-xs text-ink-2">Stopped.</p>}
    </li>
  );
}

function PartView({ part, messageId, caret }: { part: Part; messageId: string; caret: boolean }) {
  switch (part.kind) {
    case "text":
      return (
        <div className="prose-fin chat-prose text-sm" aria-live={caret ? "off" : undefined}>
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              a: ({ href, children }) => {
                const label = String(children);
                const citation = /^\d+$/.test(label);
                return (
                  <a href={href} target="_blank" rel="noreferrer" className={citation ? "citation" : undefined}
                     aria-label={citation ? `Source ${label}` : undefined}>
                    {children}
                  </a>
                );
              },
            }}
          >
            {part.text}
          </ReactMarkdown>
        </div>
      );
    case "tools":
      return (
        <ul className="space-y-1 border-l border-line pl-3" aria-label="What the advisor did">
          {part.items.map((t) => (
            <li key={t.id} className="flex items-center gap-2 text-xs text-ink-2">
              {t.status === "running" ? (
                <Loader2 size={12} className="animate-spin" aria-hidden />
              ) : t.status === "error" ? (
                <CircleAlert size={12} className="text-down" aria-hidden />
              ) : (
                <Check size={12} aria-hidden />
              )}
              <span className={clsx(t.status === "running" && "text-ink")}>{t.label || t.name}</span>
              {t.status === "error" && <span className="text-down">failed</span>}
            </li>
          ))}
        </ul>
      );
    case "sources":
      return (
        <div>
          <p className="label mb-1.5">Sources</p>
          <ul className="flex flex-wrap gap-1.5">
            {part.items.map((s, i) => (
              <li key={`${s.url}-${i}`}>
                <a
                  href={s.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex max-w-[260px] items-center gap-1 rounded-pill border border-line px-2.5 py-1 text-xs text-ink hover:border-line-strong hover:text-ink"
                  title={s.publisher ? `${s.title} (${s.publisher})` : s.title}
                >
                  <span className="shrink-0 font-medium text-accent">{i + 1}</span>
                  <span className="truncate">{s.title}</span>
                  <ExternalLink size={11} aria-hidden className="shrink-0" />
                </a>
              </li>
            ))}
          </ul>
        </div>
      );
    case "proposals":
      return <ProposalCards messageId={messageId} proposals={part.proposals} decided={part.decided} />;
    case "research":
      return <ResearchNotice jobId={part.job_id} topic={part.topic} />;
    case "created":
      return (
        <div className="rounded border border-line bg-plane px-3 py-2.5">
          <p className="flex items-center gap-1.5 text-xs text-ink-2">
            <Eye size={13} aria-hidden /> Saved watches
          </p>
          <ul className="mt-1 space-y-0.5">
            {part.triggers.map((t) => (
              <li key={t.id} className="text-sm text-ink">
                {t.name}{t.status === "paused" ? " (paused)" : ""}
              </li>
            ))}
          </ul>
          <Link href="/#watching-title" className="mt-1.5 inline-block text-xs text-accent hover:underline">
            See them on the overview
          </Link>
        </div>
      );
    case "error":
      return (
        <p role="alert" className="flex items-start gap-2 rounded border border-down/50 px-3 py-2 text-sm text-ink-2">
          <CircleAlert size={15} className="mt-0.5 shrink-0 text-down" aria-hidden />
          {part.message}
        </p>
      );
  }
}
