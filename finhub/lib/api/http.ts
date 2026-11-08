import { parseEventStream } from "./sse";
import type { FinanceApi } from "./interface";
import type { BackendAlert, BackendEvaluation, BackendJob, BackendPortfolio, BackendSearch, BackendTrigger, ThreadState } from "./backend";
import type { Alert, ChatEvent, Evaluation, Holding, ImportResult, InjectSignalResponse, Portfolio, Report, ResearchJob, Trigger } from "./types";

// All requests go through the same-origin server proxy. The backend bearer token stays server-side.
export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

async function errorFrom(res: Response): Promise<ApiError> {
  let message = `${res.status} ${res.statusText}`.trim();
  try {
    const body = await res.json();
    if (typeof body.detail === "string") message = body.detail;
    else if (Array.isArray(body.detail)) message = body.detail.map((d: { msg?: string }) => d.msg).join("; ");
    else if (body.detail?.rows) message = body.detail.rows.map((r: { row: number; errors: { msg: string }[] }) =>
      `Row ${r.row}: ${r.errors.map((e) => e.msg).join(", ")}`).join("; ");
  } catch {
    if (res.status >= 500) message = "The backend is unavailable. Check the API process and BACKEND_URL.";
  }
  return new ApiError(res.status, message);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const isForm = typeof FormData !== "undefined" && init.body instanceof FormData;
  let res: Response;
  try {
    res = await fetch(path, { ...init, cache: "no-store", headers: {
      Accept: "application/json", ...(init.body && !isForm ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    } });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError(0, "Can't reach the app server.");
  }
  if (!res.ok) throw await errorFrom(res);
  if (res.status === 204) return undefined as T;
  return await res.json() as T;
}
const enc = encodeURIComponent;
const json = (method: string, body?: unknown): RequestInit => ({ method, ...(body ? { body: JSON.stringify(body) } : {}) });

export function normalizePortfolio(raw: BackendPortfolio): Portfolio {
  return { ...raw, day_change_pct: raw.day_change_percent == null ? null : raw.day_change_percent / 100,
    holdings: raw.holdings.map((h) => ({ ...h, price: h.price ?? null, gain: h.gain ?? null,
      day_change: h.day_change ?? null,
      day_change_pct: h.day_change_percent == null ? null : h.day_change_percent / 100,
      gain_pct: h.gain_percent == null ? null : h.gain_percent / 100 })) };
}
export function normalizeTrigger(raw: BackendTrigger): Trigger {
  return { ...raw.spec, id: raw.id, status: raw.status, created_at: raw.created_at,
    pinned: raw.spec.pinned ?? false, last_checked_at: raw.last_checked_at,
    last_level: raw.last_checked_at ? raw.level.toLowerCase() as Trigger["last_level"] : null,
    last_severity: raw.last_severity ?? null, latest_price: raw.latest_price ?? null, event_state: raw.event_state ?? null };
}
export function normalizeEvaluation(raw: BackendEvaluation): Evaluation {
  return { ...raw, exposure: Math.min(raw.exposure / .1, 1), level: raw.level.toLowerCase() as Evaluation["level"] };
}
export function normalizeAlert(raw: BackendAlert): Alert {
  return { ...raw, ts: raw.created_at, level: raw.level.toLowerCase() as Alert["level"] };
}
export function normalizeJob(raw: BackendJob): ResearchJob {
  return { ...raw, job_id: raw.id, status: raw.status === "completed" ? "done" : raw.status };
}

async function* stream(path: string, body?: unknown, signal?: AbortSignal): AsyncGenerator<ChatEvent> {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    ...(body ? { body: JSON.stringify(body) } : {}), signal, cache: "no-store" });
  if (!res.ok) throw await errorFrom(res);
  if (!res.body) throw new ApiError(502, "The chat stream had no body.");
  for await (const frame of parseEventStream(res.body)) {
    switch (frame.type) {
      case "thread": yield { type: "thread", thread_id: frame.thread_id as string }; break;
      case "token": yield { type: "token", text: frame.text as string }; break;
      case "error": yield { type: "error", message: frame.message as string }; break;
      case "done": yield { type: "done" }; break;
      case "trigger_approval":
        yield { type: "proposals", proposals: frame.proposals as import("./types").TriggerProposal[] }; break;
      case "triggers_updated": {
        const ids = new Set(frame.trigger_ids as string[]);
        const triggers = ids.size ? (await httpApi.listTriggers()).filter((t) => ids.has(t.id)) : [];
        yield { type: "triggers_created", triggers };
        yield { type: "token", text: triggers.length ? "Your approved trigger changes are saved." : "The proposed triggers were rejected." };
        break;
      }
      case "tool": {
        yield { type: "tool", id: "turn-context", name: "Portfolio and research tools", status: "done" };
        const data = frame.data as { cited_sources?: import("./types").ChatSource[]; research_job?: BackendJob } | undefined;
        if (data?.cited_sources?.length) yield { type: "sources", items: data.cited_sources };
        if (data?.research_job) yield { type: "research", job_id: data.research_job.id, topic: data.research_job.topic };
        break;
      }
      case "answer": yield { type: "answer", text: frame.text as string }; break;
    }
  }
}

export const httpApi: FinanceApi = {
  getPortfolio: async () => normalizePortfolio(await request<BackendPortfolio>("/api/portfolio")),
  getNetWorthHistory: async (range) => {
    const raw = await request<{ series: import("./types").NetWorthPoint[] }>(`/api/networth/history?range=${range === "ALL" ? "All" : range}`);
    return { range, points: raw.series };
  },
  createHolding: (input) => request<Holding>("/api/holdings", json("POST", input)),
  updateHolding: (id, patch) => request<Holding>(`/api/holdings/${enc(id)}`, json("PATCH", patch)),
  deleteHolding: (id) => request<void>(`/api/holdings/${enc(id)}`, json("DELETE")),
  importHoldings: async (file) => {
    const form = new FormData(); form.append("file", file);
    return { ...await request<{ imported: number }>("/api/holdings/import", { method: "POST", body: form }), errors: [] } as ImportResult;
  },
  listTriggers: async () => (await request<BackendTrigger[]>("/api/triggers")).map(normalizeTrigger),
  updateTrigger: async (id, patch) => {
    const { status, ...specPatch } = patch;
    let spec;
    if (Object.keys(specPatch).length) {
      const existing = (await request<BackendTrigger[]>("/api/triggers")).find((t) => t.id === id);
      if (!existing) throw new ApiError(404, "Trigger not found");
      spec = { ...existing.spec, ...specPatch };
    }
    return normalizeTrigger(await request<BackendTrigger>(`/api/triggers/${enc(id)}`, json("PATCH", { approved: true, status, spec })));
  },
  deleteTrigger: (id) => request<void>(`/api/triggers/${enc(id)}`, json("DELETE")),
  getEvaluations: async (id, since) => (await request<BackendEvaluation[]>(`/api/triggers/${enc(id)}/evaluations?since=${enc(since)}`)).map(normalizeEvaluation),
  listAlerts: async (status) => (await request<BackendAlert[]>(`/api/alerts?status=${status}`)).map(normalizeAlert),
  ackAlert: async (id) => normalizeAlert(await request<BackendAlert>(`/api/alerts/${enc(id)}/ack`, json("POST"))),
  searchReports: async (q) => {
    const raw = await request<BackendSearch>(q?.trim() ? `/api/reports?q=${enc(q.trim())}` : "/api/reports");
    return { results: (raw.matches ?? raw.reports ?? []).map((report) => ({ report,
      passage: "passage" in report ? report.passage as string : null,
      score: "score" in report ? report.score as number : null })), similar: raw.similar ?? [] };
  },
  getReport: (id) => request<Report>(`/api/reports/${enc(id)}`),
  startResearch: async (topic) => normalizeJob(await request<BackendJob>("/api/research", json("POST", { topic }))),
  getResearchJob: async (id) => normalizeJob(await request<BackendJob>(`/api/research/${enc(id)}`)),
  getChatState: (id) => request<ThreadState>(`/api/chat/${enc(id)}`),
  streamChat: (req, signal) => stream("/api/chat", req, signal),
  resumeChat: (id, req, signal) => stream(`/api/chat/${enc(id)}/resume`, req, signal),
  retryChat: (id, signal) => stream(`/api/chat/${enc(id)}/retry`, undefined, signal),
  injectSignal: async (req) => {
    const raw = await request<{ evaluation?: BackendEvaluation; alert?: BackendAlert | null; ignored?: string }>("/api/dev/inject-signal", json("POST", {
      trigger_id: req.trigger_id, source: req.source,
      title: req.price_change_pct == null ? req.title : `${req.title}. Synthetic daily move ${(req.price_change_pct * 100).toFixed(1)}%`,
      external_id: req.external_id ?? crypto.randomUUID(), url: req.url,
      magnitude: req.magnitude ?? Math.min(Math.abs(req.price_change_pct ?? 0) * 10, 1), urgency: req.urgency ?? .7,
    }));
    if (!raw.evaluation) throw new ApiError(409, raw.ignored ?? "No evaluation was produced.");
    return { evaluation: normalizeEvaluation(raw.evaluation), alert: raw.alert ? normalizeAlert(raw.alert) : null,
      suppressed_reason: raw.evaluation.suppressed_reason } as InjectSignalResponse;
  },
};
