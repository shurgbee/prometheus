"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { ArrowUp, RotateCcw, Square, X } from "lucide-react";
import { useChat } from "./ChatContext";
import { MessageView } from "./MessageView";

const SUGGESTIONS = [
  { text: "I see a lot of Teslas on the road, why?", tone: "border-[#3987E5]/50 text-[#9DC0F2]" },
  { text: "How is my money split right now?", tone: "border-[#199E70]/55 text-[#7FD3B2]" },
  { text: "Write a report on EV subsidies", tone: "border-[#D95926]/55 text-[#F0A27E]" },
];

export function ChatPanel({ onClose }: { onClose: () => void }) {
  const { messages, streaming, recovering, retryable, retry, awaitingDecision, send, stop, reset } = useChat();
  const [draft, setDraft] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const stick = useRef(true);

  // Keep the view pinned to the newest message unless the user scrolled up to read.
  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Grow the composer with its content, up to a limit.
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [draft]);

  const blocked = streaming || recovering || retryable || awaitingDecision;

  function submit(text: string) {
    if (blocked || !text.trim()) return;
    stick.current = true;
    send(text);
    setDraft("");
  }

  return (
    <div className="flex h-full flex-col border-l border-line bg-surface">
      <div className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-line px-5">
        <div>
          <h2 className="font-serif text-xl leading-none text-ink">Advisor</h2>
        </div>
        <div className="flex items-center gap-1">
          {messages.length > 0 && (
            <button className="btn-quiet" onClick={reset} title="Start a new conversation">
              <RotateCcw size={14} aria-hidden />
              New
            </button>
          )}
          <button className="btn-quiet xl:hidden" onClick={onClose} aria-label="Close advisor chat">
            <X size={16} aria-hidden />
          </button>
        </div>
      </div>

      <div
        ref={scroller}
        className="min-h-0 flex-1 overflow-y-auto px-5 py-5"
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        {messages.length === 0 ? (
          <div className="flex h-full flex-col justify-end pb-2">
            <p className="font-serif text-[28px] leading-[1.15] text-ink">
              Noticed something?
              <br />
              <span className="text-ink-3">Let&apos;s find out what it means for your money.</span>
            </p>
            <p className="mt-3 text-sm text-ink-2">
              I can explain a trend, check your portfolio, set up triggers that watch the news for you, or write a research report.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s.text}
                  onClick={() => submit(s.text)}
                  className={clsx("rounded-pill border px-3 py-1.5 text-left text-sm transition-colors hover:bg-raised", s.tone)}
                >
                  {s.text}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <ol className="space-y-5" aria-label="Conversation">
            {messages.map((m, i) => (
              <MessageView key={m.id} message={m} live={streaming && i === messages.length - 1} />
            ))}
          </ol>
        )}
      </div>

      <form
        className="shrink-0 border-t border-line px-4 pb-3 pt-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit(draft);
        }}
      >
        {recovering && <p className="mb-2 text-xs text-ink-2">Restoring your conversation…</p>}
        {retryable && !streaming && <button type="button" className="btn-ghost mb-2" onClick={retry}>Retry interrupted turn</button>}
        {awaitingDecision && !streaming && (
          <p className="mb-2 text-xs text-ink-2">Approve or reject the suggested triggers above to keep going.</p>
        )}
        <div className="flex items-end gap-2 rounded-lg border border-line-strong bg-raised px-3 py-2 focus-within:border-accent">
          <label htmlFor="chat-input" className="sr-only">
            Message the advisor
          </label>
          <textarea
            id="chat-input"
            ref={input}
            rows={1}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit(draft);
              }
            }}
            placeholder={awaitingDecision ? "Waiting for your decision on the triggers" : "Ask about a trend, a stock, or your money"}
            disabled={awaitingDecision && !streaming}
            className="max-h-40 min-h-[24px] flex-1 resize-none bg-transparent text-sm text-ink placeholder:text-ink-3 focus:outline-none disabled:opacity-60"
          />
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
        <p className="mt-2 text-2xs text-ink-3">Educational, not financial advice. The advisor never places trades.</p>
      </form>
    </div>
  );
}
