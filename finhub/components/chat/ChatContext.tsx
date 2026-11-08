"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api, USE_MOCKS, type ChatEvent, type ChatSource, type ProposalDecision, type Trigger, type TriggerProposal } from "@/lib/api";
import { refresh } from "@/lib/hooks";

export type ToolItem = { id: string; name: string; status: "running" | "done" | "error"; label?: string | null };

export type Part =
  | { kind: "text"; text: string }
  | { kind: "tools"; items: ToolItem[] }
  | { kind: "sources"; items: ChatSource[] }
  | { kind: "proposals"; proposals: TriggerProposal[]; decided: boolean }
  | { kind: "research"; job_id: string; topic: string }
  | { kind: "created"; triggers: Trigger[] }
  | { kind: "error"; message: string };

export interface Message {
  id: string;
  role: "user" | "assistant";
  parts: Part[];
  stopped?: boolean;
}

interface ChatState {
  threadId: string | null;
  messages: Message[];
  streaming: boolean;
  recovering: boolean;
  retryable: boolean;
  retry: () => void;
  /** True while the agent is waiting for the user to approve or reject proposals. */
  awaitingDecision: boolean;
  send: (text: string) => void;
  decide: (messageId: string, decisions: ProposalDecision[]) => void;
  stop: () => void;
  reset: () => void;
}

const ChatContext = createContext<ChatState | null>(null);
const STORAGE_KEY = "finhub.chat.v1";
let seq = 0;
const mid = () => `m${Date.now().toString(36)}${(seq++).toString(36)}`;

function applyEvent(parts: Part[], ev: ChatEvent): Part[] {
  const next = [...parts];
  const last = next[next.length - 1];
  switch (ev.type) {
    case "token": {
      if (!ev.text) return parts;
      if (last?.kind === "text") next[next.length - 1] = { kind: "text", text: last.text + ev.text };
      else next.push({ kind: "text", text: ev.text });
      return next;
    }
    case "tool": {
      const item: ToolItem = { id: ev.id, name: ev.name, status: ev.status, label: ev.label };
      // Update the tool if it's already listed anywhere in this message.
      for (let i = next.length - 1; i >= 0; i--) {
        const p = next[i];
        if (p.kind === "tools" && p.items.some((t) => t.id === ev.id)) {
          next[i] = { kind: "tools", items: p.items.map((t) => (t.id === ev.id ? { ...t, ...item, label: item.label ?? t.label } : t)) };
          return next;
        }
      }
      if (last?.kind === "tools") next[next.length - 1] = { kind: "tools", items: [...last.items, item] };
      else next.push({ kind: "tools", items: [item] });
      return next;
    }
    case "sources":
      if (!ev.items?.length) return parts;
      next.push({ kind: "sources", items: ev.items });
      return next;
    case "proposals":
      if (!ev.proposals?.length) return parts;
      next.push({ kind: "proposals", proposals: ev.proposals, decided: false });
      return next;
    case "triggers_created":
      if (!ev.triggers?.length) return parts;
      next.push({ kind: "created", triggers: ev.triggers });
      return next;
    case "research":
      next.push({ kind: "research", job_id: ev.job_id, topic: ev.topic });
      return next;
    case "error":
      next.push({ kind: "error", message: ev.message || "The advisor hit an error." });
      return next;
    default:
      return parts;
  }
}

function errorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return `Couldn't get a reply: ${msg}.`;
}

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [recovering, setRecovering] = useState(!USE_MOCKS);
  const [retryable, setRetryable] = useState(false);
  const threadRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const loaded = useRef(false);

  // Reconcile local UI state with the durable graph after reload, disconnect or failed resume.
  const synchronize = useCallback(async (id: string, restoring = false) => {
    if (!api.getChatState) return;
    const state = await api.getChatState(id);
    if (threadRef.current !== id) return;
    setRetryable(state.retryable);
    setMessages((current) => {
      let next: Message[] = restoring ? state.history.map((m) => ({
        id: mid(), role: m.role, parts: [{ kind: "text", text: m.content }],
      })) : current.map((m) => ({ ...m, parts: m.parts.map((p) =>
        p.kind === "proposals" ? { ...p, decided: true } : p) }));
      if (state.awaiting_approval && state.proposals.length) {
        const pending: Part = { kind: "proposals", proposals: state.proposals, decided: false };
        const target = next.findIndex((m) => m.parts.some((p) => p.kind === "proposals" &&
          p.proposals.some((p) => p.proposal_id === state.proposals[0].proposal_id)));
        if (target >= 0) next = next.map((m, i) => i === target ? { ...m,
          parts: m.parts.map((p) => p.kind === "proposals" ? pending : p) } : m);
        else next.push({ id: mid(), role: "assistant", parts: [pending] });
      }
      if (restoring && state.research_job) {
        next.push({ id: mid(), role: "assistant", parts: [{ kind: "research",
          job_id: state.research_job.id, topic: state.research_job.topic }] });
      }
      return next;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function restore() {
      try {
        if (!USE_MOCKS) {
          const raw = window.localStorage.getItem(STORAGE_KEY);
          if (raw) {
            const saved = JSON.parse(raw) as { threadId: string | null; messages: Message[] };
            threadRef.current = saved.threadId;
            setThreadId(saved.threadId);
            setMessages(saved.messages ?? []);
            if (saved.threadId) await synchronize(saved.threadId, true);
          }
        }
      } catch (error) {
        if ((error as { status?: number }).status === 404) {
          threadRef.current = null; setThreadId(null); setMessages([]);
        }
      } finally {
        if (!cancelled) { loaded.current = true; setRecovering(false); }
      }
    }
    void restore();
    return () => { cancelled = true; };
  }, [synchronize]);

  useEffect(() => {
    if (USE_MOCKS || !loaded.current || streaming || recovering) return;
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ threadId, messages })); }
    catch { /* Storage is optional. */ }
  }, [threadId, messages, streaming, recovering]);

  const updateMessage = useCallback((id: string, fn: (m: Message) => Message) => {
    setMessages((ms) => ms.map((m) => (m.id === id ? fn(m) : m)));
  }, []);

  const consume = useCallback(
    async (stream: () => AsyncIterable<ChatEvent>, assistantId: string, controller: AbortController, onFail?: () => void) => {
      setStreaming(true);
      let failed = false;
      let completed = false;
      try {
        for await (const ev of stream()) {
          if (controller.signal.aborted) break;
          if (ev.type === "thread") {
            threadRef.current = ev.thread_id;
            setThreadId(ev.thread_id);
            if (!USE_MOCKS) {
              try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ threadId: ev.thread_id, messages: [] })); }
              catch { /* The server checkpoint remains authoritative. */ }
            }
            continue;
          }
          if (ev.type === "done") { completed = true; break; }
          if (ev.type === "error") { failed = true; onFail?.(); }
          if (ev.type === "triggers_created") void refresh("triggers");
          updateMessage(assistantId, (m) => ({ ...m, parts: applyEvent(m.parts, ev) }));
        }
        if (!completed && !failed && !controller.signal.aborted) throw new Error("The connection closed before the turn finished");
        if (controller.signal.aborted) updateMessage(assistantId, (m) => ({ ...m, stopped: true }));
      } catch (e) {
        failed = true;
        if ((e as { name?: string })?.name === "AbortError" || controller.signal.aborted) {
          updateMessage(assistantId, (m) => ({ ...m, stopped: true }));
        } else {
          updateMessage(assistantId, (m) => ({ ...m, parts: [...m.parts, { kind: "error", message: errorText(e) }] }));
          onFail?.();
        }
      } finally {
        if (abortRef.current === controller) {
          const id = threadRef.current;
          if ((failed || controller.signal.aborted) && id) {
            try { await synchronize(id); } catch { /* Preserve recoverable cards while offline. */ }
          }
          abortRef.current = null;
          setStreaming(false);
        }
      }
    },
    [updateMessage, synchronize],
  );

  const send = useCallback(
    (text: string) => {
      const message = text.trim();
      if (!message || abortRef.current || recovering || retryable) return;
      const user: Message = { id: mid(), role: "user", parts: [{ kind: "text", text: message }] };
      const assistant: Message = { id: mid(), role: "assistant", parts: [] };
      setMessages((ms) => [...ms, user, assistant]);
      const controller = new AbortController();
      abortRef.current = controller;
      void consume(() => api.streamChat({ thread_id: threadRef.current, message }, controller.signal), assistant.id, controller);
    },
    [consume, recovering, retryable],
  );

  const decide = useCallback(
    (messageId: string, decisions: ProposalDecision[]) => {
      const tid = threadRef.current;
      if (!tid || abortRef.current) return;
      setMessages((ms) =>
        ms.map((m) =>
          m.id === messageId
            ? { ...m, parts: m.parts.map((p) => (p.kind === "proposals" ? { ...p, decided: true } : p)) }
            : m,
        ),
      );
      const assistant: Message = { id: mid(), role: "assistant", parts: [] };
      setMessages((ms) => [...ms, assistant]);
      const controller = new AbortController();
      abortRef.current = controller;
      // If the resume request fails, reopen the cards so the user can decide again.
      const reopen = () =>
        setMessages((ms) =>
          ms.map((m) =>
            m.id === messageId
              ? { ...m, parts: m.parts.map((p) => (p.kind === "proposals" ? { ...p, decided: false } : p)) }
              : m,
          ),
        );
      void consume(() => api.resumeChat(tid, { decisions }, controller.signal), assistant.id, controller, reopen);
    },
    [consume],
  );

  const retry = useCallback(() => {
    const id = threadRef.current;
    if (!id || abortRef.current || !api.retryChat) return;
    const assistant: Message = { id: mid(), role: "assistant", parts: [] };
    setMessages((ms) => [...ms, assistant]);
    const controller = new AbortController(); abortRef.current = controller;
    setRetryable(false);
    void consume(() => api.retryChat!(id, controller.signal), assistant.id, controller);
  }, [consume]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    threadRef.current = null;
    setThreadId(null);
    setMessages([]);
    setStreaming(false);
    setRetryable(false);
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  const awaitingDecision = useMemo(
    () => messages.some((m) => m.parts.some((p) => p.kind === "proposals" && !p.decided)),
    [messages],
  );

  const value = useMemo(
    () => ({ threadId, messages, streaming, recovering, retryable, retry, awaitingDecision, send, decide, stop, reset }),
    [threadId, messages, streaming, recovering, retryable, retry, awaitingDecision, send, decide, stop, reset],
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat(): ChatState {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChat must be used inside ChatProvider");
  return ctx;
}
