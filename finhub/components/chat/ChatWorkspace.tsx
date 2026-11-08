"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { ArrowUp, History, Loader2, Plus, Square, Trash2 } from "lucide-react";
import { useChat, type ConversationSummary } from "./ChatContext";
import { MessageView } from "./MessageView";

const SUGGESTIONS = [
  "I see a lot of Teslas on the road, why?",
  "How is my money split right now?",
  "Write a report on EV subsidies",
];

function ago(timestamp: number): string {
  const minutes = Math.floor((Date.now() - timestamp) / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function ConversationList({ items, activeId, onSelect, onDelete }: {
  items: ConversationSummary[];
  activeId: string;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  if (!items.length) return <p className="px-3 py-2 text-sm text-ink-3">No conversations yet.</p>;
  return (
    <ul className="space-y-1" aria-label="Conversations">
      {items.map((c) => (
        <li key={c.id} className={clsx("group flex items-center rounded hover:bg-raised", c.id === activeId && "bg-raised")}>
          <button className="min-w-0 flex-1 px-3 py-2.5 text-left" onClick={() => onSelect(c.id)} aria-current={c.id === activeId || undefined}>
            <span className="block truncate text-sm text-ink">{c.title}</span>
            <span className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-3">
              {c.streaming ? (
                <><Loader2 size={11} className="animate-spin" aria-hidden /> Answering</>
              ) : c.needsDecision ? (
                <span className="text-accent">Needs your decision</span>
              ) : (
                ago(c.updatedAt)
              )}
            </span>
          </button>
          <button
            className="mr-1.5 shrink-0 rounded p-2 text-ink-2 hover:text-down focus:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
            onClick={() => onDelete(c.id)}
            aria-label={`Delete conversation: ${c.title}`}
          >
            <Trash2 size={14} aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  );
}

/** The advisor's own page: conversation rail, centered prompt when empty, reading-width thread once started. */
export function ChatWorkspace() {
  const { messages, streaming, recovering, retryable, retry, awaitingDecision, send, stop, conversations, activeId,
          newConversation, selectConversation, deleteConversation } = useChat();
  const [draft, setDraft] = useState("");
  const [showHistory, setShowHistory] = useState(false); // phones only; the rail is always visible from md up
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const stick = useRef(true);

  // Keep the view pinned to the newest message unless the user scrolled up to read.
  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages, showHistory]);

  // Each conversation opens at its newest message.
  useEffect(() => {
    stick.current = true;
    setDraft("");
  }, [activeId]);

  // Grow the composer with its content, up to a limit.
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [draft]);

  const blocked = streaming || recovering || retryable || awaitingDecision;
  const empty = messages.length === 0 && !showHistory;

  function submit(text: string) {
    if (blocked || !text.trim()) return;
    stick.current = true;
    send(text);
    setDraft("");
    setShowHistory(false);
  }

  function startNew() {
    newConversation();
    setShowHistory(false);
    input.current?.focus();
  }

  function select(id: string) {
    selectConversation(id);
    setShowHistory(false);
  }

  return (
    <div className="flex h-full min-h-0 gap-3">
      <aside aria-label="Conversations" className="hidden w-[280px] shrink-0 flex-col rounded-lg bg-surface p-3 md:flex">
        <button className="btn-ghost w-full py-2" onClick={startNew}>
          <Plus size={14} aria-hidden /> New conversation
        </button>
        <p className="label mb-1 mt-4 px-3">Recent</p>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ConversationList items={conversations} activeId={activeId} onSelect={select} onDelete={deleteConversation} />
        </div>
      </aside>

      <section aria-labelledby="advisor-title" className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg bg-surface">
        <h1 id="advisor-title" className="sr-only">Advisor</h1>

        <div className="flex shrink-0 items-center justify-end gap-1 border-b border-line px-3 py-2 md:hidden">
          <button
            className={clsx("btn-quiet", showHistory && "bg-raised text-ink")}
            onClick={() => setShowHistory((open) => !open)}
            aria-expanded={showHistory}
          >
            <History size={14} aria-hidden /> History
          </button>
          <button className="btn-quiet" onClick={startNew}>
            <Plus size={14} aria-hidden /> New
          </button>
        </div>

        <div className={clsx("flex min-h-0 flex-1 flex-col", empty && "justify-center overflow-y-auto")}>
          {empty ? (
            <div className="mx-auto w-full max-w-[720px] px-5 pb-6 text-center">
              <p className="font-display text-[32px] leading-[1.15] tracking-[-0.02em] text-ink sm:text-[40px]">Noticed something?</p>
              <p className="mt-2 text-lg text-ink-2">Let&apos;s find out what it means for your money.</p>
            </div>
          ) : (
            <div
              ref={scroller}
              className="min-h-0 flex-1 overflow-y-auto px-5 py-8"
              onScroll={(e) => {
                const el = e.currentTarget;
                stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
              }}
            >
              <div className="mx-auto w-full max-w-[720px]">
                {showHistory ? (
                  <ConversationList items={conversations} activeId={activeId} onSelect={select} onDelete={deleteConversation} />
                ) : (
                  <ol className="space-y-8" aria-label="Conversation">
                    {messages.map((m, i) => (
                      <MessageView key={m.id} message={m} live={streaming && i === messages.length - 1} />
                    ))}
                  </ol>
                )}
              </div>
            </div>
          )}

          <form
            className="mx-auto w-full max-w-[760px] shrink-0 px-5 pb-4 pt-2"
            onSubmit={(e) => {
              e.preventDefault();
              submit(draft);
            }}
          >
            {recovering && <p className="mb-2 text-xs text-ink">Restoring your conversation…</p>}
            {retryable && !streaming && <button type="button" className="btn-ghost mb-2" onClick={retry}>Retry interrupted turn</button>}
            {awaitingDecision && !streaming && (
              <p className="mb-2 text-xs text-ink">Approve or reject the suggested triggers above to keep going.</p>
            )}
            <div className="rounded-lg border border-line-strong bg-raised p-3 focus-within:border-accent">
              <label htmlFor="chat-input" className="sr-only">
                Message the advisor
              </label>
              <textarea
                id="chat-input"
                ref={input}
                rows={empty ? 2 : 1}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    submit(draft);
                  }
                }}
                placeholder={awaitingDecision ? "Waiting for your decision on the triggers" : empty ? "Ask about a trend, a stock, or your money" : "Ask a follow-up"}
                disabled={awaitingDecision && !streaming}
                className="block max-h-[200px] w-full resize-none bg-transparent text-base text-ink placeholder:text-ink-3 focus:outline-none disabled:opacity-60"
              />
              <div className="mt-2 flex items-center justify-between gap-3">
                <span className="text-2xs text-ink-3">Not financial advice.</span>
                {streaming ? (
                  <button type="button" onClick={stop} className="btn-ghost h-8 w-8 shrink-0 p-0" aria-label="Stop the response">
                    <Square size={12} aria-hidden fill="currentColor" />
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={blocked || !draft.trim()}
                    className="btn-primary h-8 w-8 shrink-0 p-0"
                    aria-label="Send message"
                  >
                    <ArrowUp size={16} aria-hidden />
                  </button>
                )}
              </div>
            </div>
            {empty && (
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((text) => (
                  <button
                    key={text}
                    type="button"
                    onClick={() => submit(text)}
                    className="rounded-pill border border-line-strong px-3 py-1.5 text-sm text-ink-2 transition-colors hover:bg-raised hover:text-ink"
                  >
                    {text}
                  </button>
                ))}
              </div>
            )}
          </form>
        </div>
      </section>
    </div>
  );
}
