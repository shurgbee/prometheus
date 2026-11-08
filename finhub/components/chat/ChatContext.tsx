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

interface Conversation {
  id: string;
  threadId: string | null;
  title: string;
  updatedAt: number;
  messages: Message[];
  streaming: boolean;
  retryable: boolean;
}

export interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: number;
  streaming: boolean;
  needsDecision: boolean;
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
  /** Conversations with at least one message, newest first. */
  conversations: ConversationSummary[];
  activeId: string;
  newConversation: () => void;
  selectConversation: (id: string) => void;
  deleteConversation: (id: string) => void;
}

const ChatContext = createContext<ChatState | null>(null);
const STORAGE_KEY = "finhub.chat.v2";
const LEGACY_STORAGE_KEY = "finhub.chat.v1";
const MAX_SAVED = 50;
const INITIAL_ID = "c-initial";
let seq = 0;
const mid = () => `m${Date.now().toString(36)}${(seq++).toString(36)}`;

const blank = (id: string = mid()): Conversation =>
  ({ id, threadId: null, title: "", updatedAt: 0, messages: [], streaming: false, retryable: false });

const hasPendingDecision = (messages: Message[]) =>
  messages.some((m) => m.parts.some((p) => p.kind === "proposals" && !p.decided));

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
    case "answer": {
      if (!ev.text) return parts;
      for (let i = next.length - 1; i >= 0; i--) {
        if (next[i].kind === "text") {
          next[i] = { kind: "text", text: ev.text };
          return next;
        }
      }
      next.push({ kind: "text", text: ev.text });
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

function readSaved(): { activeId: string | null; conversations: Conversation[] } {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw) {
    const saved = JSON.parse(raw) as { activeId: string | null; conversations: Conversation[] };
    return { activeId: saved.activeId, conversations: saved.conversations.map((c) => ({ ...c, streaming: false })) };
  }
  // Carry the single conversation from the previous storage format over.
  const legacy = window.localStorage.getItem(LEGACY_STORAGE_KEY);
  if (!legacy) return { activeId: null, conversations: [] };
  const old = JSON.parse(legacy) as { threadId: string | null; messages: Message[] };
  if (!old.threadId || !old.messages?.length) return { activeId: null, conversations: [] };
  const first = old.messages.find((m) => m.role === "user")?.parts.find((p) => p.kind === "text");
  const migrated: Conversation = { ...blank(), threadId: old.threadId, messages: old.messages,
    title: first?.kind === "text" ? first.text : "Conversation", updatedAt: Date.now() };
  return { activeId: migrated.id, conversations: [migrated] };
}

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const [conversations, setConversations] = useState<Conversation[]>([blank(INITIAL_ID)]);
  const [activeId, setActiveId] = useState(INITIAL_ID);
  const [recovering, setRecovering] = useState(!USE_MOCKS);
  const threadIds = useRef(new Map<string, string | null>());
  const controllers = useRef(new Map<string, AbortController>());
  /** Conversations loaded from storage that have not been reconciled with the server yet. */
  const unsynced = useRef(new Set<string>());
  const loaded = useRef(false);
  const latest = useRef({ conversations, activeId });
  latest.current = { conversations, activeId };

  const patch = useCallback((id: string, fn: (c: Conversation) => Conversation) => {
    setConversations((all) => all.map((c) => (c.id === id ? fn(c) : c)));
  }, []);

  const remove = useCallback((id: string) => {
    controllers.current.get(id)?.abort();
    controllers.current.delete(id);
    threadIds.current.delete(id);
    unsynced.current.delete(id);
    const replacement = latest.current.activeId === id ? blank() : null;
    setConversations((all) => [...all.filter((c) => c.id !== id), ...(replacement ? [replacement] : [])]);
    if (replacement) setActiveId(replacement.id);
  }, []);

  // Reconcile local UI state with the durable graph after reload, disconnect or failed resume.
  const synchronize = useCallback(async (conversationId: string, restoring = false) => {
    const threadId = threadIds.current.get(conversationId);
    if (!api.getChatState || !threadId) return;
    const state = await api.getChatState(threadId);
    if (threadIds.current.get(conversationId) !== threadId) return;
    patch(conversationId, (conversation) => {
      const textCount = conversation.messages.filter((m) => m.parts.some((p) => p.kind === "text")).length;
      // Saved messages keep sources and cards, so rebuild from the server only if they fell behind.
      const rebuild = restoring && textCount !== state.history.length;
      let next: Message[] = rebuild ? state.history.map((m) => ({
        id: mid(), role: m.role, parts: [{ kind: "text", text: m.content }],
      })) : conversation.messages.map((m) => ({ ...m, parts: m.parts.map((p) =>
        p.kind === "proposals" ? { ...p, decided: true } : p) }));
      if (state.awaiting_approval && state.proposals.length) {
        const pending: Part = { kind: "proposals", proposals: state.proposals, decided: false };
        const target = next.findIndex((m) => m.parts.some((p) => p.kind === "proposals" &&
          p.proposals.some((p) => p.proposal_id === state.proposals[0].proposal_id)));
        if (target >= 0) next = next.map((m, i) => i === target ? { ...m,
          parts: m.parts.map((p) => p.kind === "proposals" ? pending : p) } : m);
        else next.push({ id: mid(), role: "assistant", parts: [pending] });
      }
      if (rebuild && state.research_job) {
        next.push({ id: mid(), role: "assistant", parts: [{ kind: "research",
          job_id: state.research_job.id, topic: state.research_job.topic }] });
      }
      return { ...conversation, messages: next, retryable: state.retryable };
    });
  }, [patch]);

  const syncSaved = useCallback(async (id: string) => {
    if (!unsynced.current.delete(id)) return;
    try {
      await synchronize(id, true);
    } catch (error) {
      // The server no longer knows this thread, so it can't be continued.
      if ((error as { status?: number }).status === 404) remove(id);
    }
  }, [synchronize, remove]);

  useEffect(() => {
    let cancelled = false;
    async function restore() {
      try {
        if (USE_MOCKS) return;
        const saved = readSaved();
        if (!saved.conversations.length) return;
        for (const c of saved.conversations) {
          threadIds.current.set(c.id, c.threadId);
          unsynced.current.add(c.id);
        }
        const activeSaved = saved.conversations.some((c) => c.id === saved.activeId) ? saved.activeId! : saved.conversations[0].id;
        latest.current = { conversations: saved.conversations, activeId: activeSaved };
        setConversations(saved.conversations);
        setActiveId(activeSaved);
        await syncSaved(activeSaved);
      } catch {
        /* Storage is optional, and a bad entry shouldn't block the chat. */
      } finally {
        if (!cancelled) { loaded.current = true; setRecovering(false); }
      }
    }
    void restore();
    return () => { cancelled = true; };
  }, [syncSaved]);

  // Tokens arrive quickly, so writes are debounced.
  useEffect(() => {
    if (USE_MOCKS || !loaded.current || recovering) return;
    const timer = window.setTimeout(() => {
      try {
        const kept = conversations.filter((c) => c.messages.length && c.threadId)
          .sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_SAVED);
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ activeId, conversations: kept }));
      } catch { /* Storage is optional. */ }
    }, 400);
    return () => window.clearTimeout(timer);
  }, [conversations, activeId, recovering]);

  const updateMessage = useCallback((conversationId: string, id: string, fn: (m: Message) => Message) => {
    patch(conversationId, (c) => ({ ...c, messages: c.messages.map((m) => (m.id === id ? fn(m) : m)) }));
  }, [patch]);

  const consume = useCallback(
    async (conversationId: string, stream: () => AsyncIterable<ChatEvent>, assistantId: string, controller: AbortController, onFail?: () => void) => {
      patch(conversationId, (c) => ({ ...c, streaming: true }));
      let failed = false;
      let completed = false;
      try {
        for await (const ev of stream()) {
          if (controller.signal.aborted) break;
          if (ev.type === "thread") {
            threadIds.current.set(conversationId, ev.thread_id);
            patch(conversationId, (c) => ({ ...c, threadId: ev.thread_id }));
            continue;
          }
          if (ev.type === "done") { completed = true; break; }
          if (ev.type === "error") { failed = true; onFail?.(); }
          if (ev.type === "triggers_created") void refresh("triggers");
          updateMessage(conversationId, assistantId, (m) => ({ ...m, parts: applyEvent(m.parts, ev) }));
        }
        if (!completed && !failed && !controller.signal.aborted) throw new Error("The connection closed before the turn finished");
        if (controller.signal.aborted) updateMessage(conversationId, assistantId, (m) => ({ ...m, stopped: true }));
      } catch (e) {
        failed = true;
        if ((e as { name?: string })?.name === "AbortError" || controller.signal.aborted) {
          updateMessage(conversationId, assistantId, (m) => ({ ...m, stopped: true }));
        } else {
          updateMessage(conversationId, assistantId, (m) => ({ ...m, parts: [...m.parts, { kind: "error", message: errorText(e) }] }));
          onFail?.();
        }
      } finally {
        if (controllers.current.get(conversationId) === controller) {
          if (failed || controller.signal.aborted) {
            try { await synchronize(conversationId); } catch { /* Preserve recoverable cards while offline. */ }
          }
          controllers.current.delete(conversationId);
          patch(conversationId, (c) => ({ ...c, streaming: false }));
        }
      }
    },
    [patch, updateMessage, synchronize],
  );

  const send = useCallback(
    (text: string) => {
      const message = text.trim();
      const { activeId: id, conversations: all } = latest.current;
      if (!message || controllers.current.has(id) || recovering || all.find((c) => c.id === id)?.retryable) return;
      const user: Message = { id: mid(), role: "user", parts: [{ kind: "text", text: message }] };
      const assistant: Message = { id: mid(), role: "assistant", parts: [] };
      patch(id, (c) => ({ ...c, title: c.title || message, updatedAt: Date.now(), messages: [...c.messages, user, assistant] }));
      const controller = new AbortController();
      controllers.current.set(id, controller);
      void consume(id, () => api.streamChat({ thread_id: threadIds.current.get(id) ?? null, message }, controller.signal), assistant.id, controller);
    },
    [consume, patch, recovering],
  );

  const decide = useCallback(
    (messageId: string, decisions: ProposalDecision[]) => {
      const id = latest.current.activeId;
      const threadId = threadIds.current.get(id);
      if (!threadId || controllers.current.has(id)) return;
      const setDecided = (decided: boolean) => (c: Conversation) => ({ ...c, messages: c.messages.map((m) =>
        m.id === messageId ? { ...m, parts: m.parts.map((p) => (p.kind === "proposals" ? { ...p, decided } : p)) } : m) });
      const assistant: Message = { id: mid(), role: "assistant", parts: [] };
      patch(id, (c) => ({ ...setDecided(true)(c), updatedAt: Date.now(), messages: [...setDecided(true)(c).messages, assistant] }));
      const controller = new AbortController();
      controllers.current.set(id, controller);
      // If the resume request fails, reopen the cards so the user can decide again.
      const reopen = () => patch(id, setDecided(false));
      void consume(id, () => api.resumeChat(threadId, { decisions }, controller.signal), assistant.id, controller, reopen);
    },
    [consume, patch],
  );

  const retry = useCallback(() => {
    const id = latest.current.activeId;
    const threadId = threadIds.current.get(id);
    if (!threadId || controllers.current.has(id) || !api.retryChat) return;
    const assistant: Message = { id: mid(), role: "assistant", parts: [] };
    patch(id, (c) => ({ ...c, retryable: false, messages: [...c.messages, assistant] }));
    const controller = new AbortController();
    controllers.current.set(id, controller);
    void consume(id, () => api.retryChat!(threadId, controller.signal), assistant.id, controller);
  }, [consume, patch]);

  const stop = useCallback(() => {
    controllers.current.get(latest.current.activeId)?.abort();
  }, []);

  const newConversation = useCallback(() => {
    const { conversations: all } = latest.current;
    const empty = all.find((c) => !c.messages.length);
    if (empty) { setActiveId(empty.id); return; }
    const fresh = blank();
    setConversations((current) => [...current, fresh]);
    setActiveId(fresh.id);
  }, []);

  const selectConversation = useCallback((id: string) => {
    setActiveId(id);
    void syncSaved(id);
  }, [syncSaved]);

  const active = conversations.find((c) => c.id === activeId) ?? blank(activeId);
  const awaitingDecision = hasPendingDecision(active.messages);

  const summaries = useMemo<ConversationSummary[]>(
    () => conversations.filter((c) => c.messages.length)
      .map((c) => ({ id: c.id, title: c.title || "Conversation", updatedAt: c.updatedAt, streaming: c.streaming,
                     needsDecision: hasPendingDecision(c.messages) }))
      .sort((a, b) => b.updatedAt - a.updatedAt),
    [conversations],
  );

  const value: ChatState = {
    threadId: active.threadId, messages: active.messages, streaming: active.streaming, recovering,
    retryable: active.retryable, retry, awaitingDecision, send, decide, stop,
    conversations: summaries, activeId, newConversation, selectConversation, deleteConversation: remove,
  };

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat(): ChatState {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChat must be used inside ChatProvider");
  return ctx;
}
