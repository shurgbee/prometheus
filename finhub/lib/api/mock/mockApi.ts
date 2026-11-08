/**
 * In-browser mock backend. Implements the same FinanceApi as the HTTP client so the
 * whole UI works before the FastAPI backend exists. State lives in memory and resets
 * on a full page reload.
 */
import type { FinanceApi } from "../interface";
import type {
  Alert,
  AssetClass,
  ChatEvent,
  ChatRequest,
  Evaluation,
  EvaluationLevel,
  HistoryRange,
  Holding,
  HoldingInput,
  ImportResult,
  InjectSignalRequest,
  InjectSignalResponse,
  NetWorthHistory,
  NetWorthPoint,
  Portfolio,
  Report,
  ReportSearchHit,
  ReportSearchResponse,
  ReportSummary,
  ResearchJob,
  ResumeRequest,
  Trigger,
  TriggerPatch,
  TriggerProposal,
  TriggerSpec,
  ValuedHolding,
} from "../types";
import { SEED_HOLDINGS, SEED_PRICES, SEED_REPORTS, SEED_TRIGGER, TESLA_PROPOSALS } from "./seed";
import { ApiError } from "../http";
import { isMarketOpen } from "../../market";

/* ------------------------------------------------------------------ */
/* Utilities                                                           */
/* ------------------------------------------------------------------ */

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });

const latency = () => sleep(120 + Math.random() * 180);
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
let idCounter = 0;
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(idCounter++).toString(36)}`;
const DAY = 86_400_000;
const round2 = (n: number) => Math.round(n * 100) / 100;

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function cdValue(h: Holding, now: Date): number {
  const p = h.principal ?? 0;
  if (!h.apy || !h.start_date) return p;
  const start = Date.parse(`${h.start_date}T00:00:00Z`);
  const end = h.maturity_date ? Date.parse(`${h.maturity_date}T00:00:00Z`) : Infinity;
  const d = Math.max(0, Math.floor((Math.min(now.getTime(), end) - start) / DAY));
  return p * Math.pow(1 + h.apy / 365, d);
}

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

const state = {
  holdings: clone(SEED_HOLDINGS) as Holding[],
  prevClose: { ...SEED_PRICES } as Record<string, number>,
  prices: {} as Record<string, number>,
  triggers: [] as Trigger[],
  evaluations: {} as Record<string, Evaluation[]>,
  alerts: [] as Alert[],
  reports: clone(SEED_REPORTS) as Report[],
  jobs: {} as Record<string, ResearchJob & { created: number }>,
  threads: {} as Record<string, { pending: TriggerProposal[] }>,
  seeded: false,
};

const priceRng = mulberry32(42);

function seedOnce() {
  if (state.seeded) return;
  state.seeded = true;
  const now = Date.now();
  // Today's prices start a little off the previous close.
  for (const [t, p] of Object.entries(state.prevClose)) {
    state.prices[t] = p * (1 + (priceRng() - 0.45) * 0.024);
  }
  // One existing trigger with 24 h of quiet evaluations.
  const trig: Trigger = {
    ...clone(SEED_TRIGGER),
    id: "t-nvda",
    status: "active",
    pinned: false,
    created_at: new Date(now - 3 * DAY).toISOString(),
    last_checked_at: null,
    last_level: null,
    last_severity: null,
  };
  state.triggers.push(trig);
  const rng = mulberry32(7);
  const evals: Evaluation[] = [];
  for (let t = now - DAY; t <= now; t += 10 * 60_000) {
    const bump = Math.abs(((t - (now - DAY)) / DAY) - 0.62) < 0.02 ? 22 : 0;
    evals.push(makeEval(t, 6 + rng() * 18 + bump, rng));
  }
  state.evaluations[trig.id] = evals;
  syncTriggerLast(trig);
  // One acknowledged alert from two days ago, so the "All" view has history.
  state.alerts.push({
    id: "a-seed-1",
    trigger_id: trig.id,
    trigger_name: trig.name,
    ts: new Date(now - 2 * DAY).toISOString(),
    level: "normal",
    severity: 52,
    summary: "NVIDIA moved 3.4% after an analyst raised data-center estimates. No change to guidance.",
    rationale: "Price move crossed the 3% threshold. Moderate exposure (6.7% of net worth). No company filing, so urgency is moderate.",
    breakdown: { magnitude: 0.5, exposure: 0.67, credibility: 0.8, urgency: 0.3, adjustment: -3 },
    evidence: [{ title: "Analyst note on data-center demand (sample)", url: "https://example.com/nvda-note", publisher: "Sample source (mock mode)" }],
    channel: "text",
    delivery_status: "delivered",
    attempts: 1,
    acked_at: new Date(now - 2 * DAY + 20 * 60_000).toISOString(),
  });
}

function makeEval(ts: number, severity: number, rng: () => number = Math.random): Evaluation {
  const s = Math.max(0, Math.min(100, severity));
  const level: EvaluationLevel = s >= 75 ? "critical" : s >= 40 ? "normal" : "ok";
  return {
    ts: new Date(ts).toISOString(),
    severity: Math.round(s),
    level,
    magnitude: round2(Math.min(1, s / 100 + rng() * 0.1)),
    exposure: 0.4,
    credibility: 0.8,
    urgency: round2(Math.min(1, s / 120)),
    adjustment: 0,
  };
}

function syncTriggerLast(t: Trigger) {
  const list = state.evaluations[t.id] ?? [];
  const last = list[list.length - 1];
  t.last_checked_at = last?.ts ?? null;
  t.last_level = last?.level ?? null;
  t.last_severity = last?.severity ?? null;
}

/** Add quiet evaluations up to now, one per minute, for active triggers. */
function tickEvaluations() {
  const now = Date.now();
  for (const t of state.triggers) {
    if (t.status !== "active") continue;
    const list = (state.evaluations[t.id] ??= []);
    const lastTs = list.length ? Date.parse(list[list.length - 1].ts) : now - 60_000;
    let ts = lastTs + 60_000;
    let added = 0;
    while (ts <= now && added < 600) {
      list.push(makeEval(ts, 5 + Math.random() * 20));
      ts += 60_000;
      added++;
    }
    // Keep 48 h.
    const cutoff = now - 2 * DAY;
    while (list.length && Date.parse(list[0].ts) < cutoff) list.shift();
    syncTriggerLast(t);
  }
}

function tickPrices() {
  for (const t of Object.keys(state.prices)) {
    state.prices[t] *= 1 + (priceRng() - 0.5) * 0.0025;
  }
}

function valued(): Portfolio {
  const now = new Date();
  const rows: ValuedHolding[] = state.holdings.map((h) => {
    if (h.asset_class === "stock") {
      const ticker = h.ticker ?? "";
      const price = state.prices[ticker] ?? state.prevClose[ticker] ?? ((h.cost_basis ?? 0) / (h.quantity || 1));
      const prev = state.prevClose[ticker] ?? price;
      const qty = h.quantity ?? 0;
      const value = qty * price;
      const cost = h.cost_basis ?? 0;
      return {
        ...h,
        price: round2(price),
        value: round2(value),
        day_change: round2(qty * (price - prev)),
        day_change_pct: prev ? (price - prev) / prev : null,
        gain: h.cost_basis != null ? round2(value - cost) : null,
        gain_pct: cost ? (value - cost) / cost : null,
        weight: 0,
      };
    }
    if (h.asset_class === "cd") {
      const value = cdValue(h, now);
      const p = h.principal ?? 0;
      return { ...h, price: null, value: round2(value), day_change: null, day_change_pct: null, gain: round2(value - p), gain_pct: p ? (value - p) / p : null, weight: 0 };
    }
    return { ...h, price: null, value: round2(h.principal ?? 0), day_change: null, day_change_pct: null, gain: null, gain_pct: null, weight: 0 };
  });
  const total = rows.reduce((s, r) => s + (r.value ?? 0), 0);
  rows.forEach((r) => (r.weight = total ? (r.value ?? 0) / total : 0));
  const sum = (c: AssetClass) => round2(rows.filter((r) => r.asset_class === c).reduce((s, r) => s + (r.value ?? 0), 0));
  const dayChange = rows.reduce((s, r) => s + (r.day_change ?? 0), 0);
  return {
    as_of: now.toISOString(),
    market_open: isMarketOpen(now),
    total: round2(total),
    day_change: round2(dayChange),
    day_change_pct: total - dayChange ? dayChange / (total - dayChange) : 0,
    allocation: { cash: sum("cash"), cd: sum("cd"), stocks: sum("stock") },
    holdings: rows, demo: true, complete: true, warnings: [], dev_injection_enabled: true,
  };
}

function history(range: HistoryRange): NetWorthHistory {
  const p = valued();
  const days = range === "1M" ? 30 : range === "3M" ? 90 : range === "1Y" ? 365 : 730;
  const rng = mulberry32(1234);
  // Build 730 days backwards from today's values so ranges are consistent slices.
  const all: NetWorthPoint[] = [];
  let stocks = p.allocation.stocks;
  let cash = p.allocation.cash;
  let cd = p.allocation.cd;
  const today = new Date();
  for (let i = 0; i < 730; i++) {
    const d = new Date(today.getTime() - i * DAY);
    all.push({ ts: isoDate(d), total: round2(stocks + cash + cd), cash: round2(cash), cd: round2(cd), stocks: round2(stocks) });
    // Step backwards: undo a day of drift and noise.
    stocks = stocks / (1 + 0.00045 + (rng() - 0.5) * 0.022);
    cash = Math.max(2000, cash - (rng() - 0.47) * 160);
    cd = Math.max(0, cd - cd * (0.045 / 365));
  }
  return { range, points: all.slice(0, days).reverse() };
}

function holdingFromInput(input: Partial<HoldingInput>, base?: Holding): Holding {
  const merged = { ...(base ?? {}), ...input } as Holding;
  if (!merged.name || !merged.asset_class) throw new ApiError(422, "Name and asset class are required.");
  if (merged.asset_class === "stock") {
    if (!merged.ticker) throw new ApiError(422, "Stocks need a ticker.");
    if (!merged.quantity || merged.quantity <= 0) throw new ApiError(422, "Stocks need a quantity above 0.");
    merged.ticker = merged.ticker.toUpperCase();
    if (!(merged.ticker in state.prevClose)) {
      const guess = merged.cost_basis && merged.cost_basis > 0 ? merged.cost_basis / merged.quantity : 100;
      state.prevClose[merged.ticker] = guess;
      state.prices[merged.ticker] = guess;
    }
  } else if (merged.principal == null || merged.principal < 0) {
    throw new ApiError(422, merged.asset_class === "cash" ? "Cash needs a balance." : "CDs need a principal.");
  }
  return {
    id: base?.id ?? newId("h"),
    asset_class: merged.asset_class,
    name: merged.name,
    ticker: merged.asset_class === "stock" ? merged.ticker : null,
    quantity: merged.asset_class === "stock" ? merged.quantity ?? null : null,
    cost_basis: merged.asset_class === "stock" ? merged.cost_basis ?? null : null,
    principal: merged.asset_class === "stock" ? null : merged.principal ?? null,
    apy: merged.asset_class === "stock" ? null : merged.apy ?? null,
    start_date: merged.asset_class === "cd" ? merged.start_date ?? null : null,
    maturity_date: merged.asset_class === "cd" ? merged.maturity_date ?? null : null,
  };
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

function summaryOf(r: Report): ReportSummary {
  return { id: r.id, title: r.title, topic: r.topic, summary: r.summary, tickers: r.tickers, created_at: r.created_at };
}

const SYNONYMS: Record<string, string[]> = {
  subsidies: ["incentives", "credits", "subsidy", "rebates"],
  subsidy: ["incentives", "subsidies"],
  ev: ["electric", "evs"],
  evs: ["electric", "ev"],
  cars: ["auto", "vehicles"],
  tesla: ["tsla"],
};

function tokens(s: string) {
  return s.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

function searchReports(q?: string): ReportSearchResponse {
  const sorted = [...state.reports].sort((a, b) => b.created_at.localeCompare(a.created_at));
  if (!q || !q.trim()) {
    return { results: sorted.map((r) => ({ report: summaryOf(r), passage: null, score: null })), similar: [] };
  }
  const qt = tokens(q);
  const expanded = new Set(qt.flatMap((t) => [t, ...(SYNONYMS[t] ?? [])]));
  const hits: ReportSearchHit[] = [];
  for (const r of sorted) {
    const text = `${r.title} ${r.topic} ${r.summary} ${r.body_md}`;
    const words = tokens(text);
    let score = 0;
    for (const w of words) if (expanded.has(w)) score += 1;
    for (const w of tokens(r.title)) if (expanded.has(w)) score += 3;
    if (score === 0) continue;
    const prose = r.body_md
      .split("\n")
      .filter((line) => line.trim() && !line.trim().startsWith("#") && !line.trim().startsWith("|"))
      .map((line) => line.replace(/^\s*-\s+/, ""))
      .join(" ")
      .replace(/[*_]/g, "");
    const sentences = prose.split(/(?<=[.!?])\s+/);
    const passage = sentences.find((s) => tokens(s).some((w) => expanded.has(w)))?.trim() ?? r.summary;
    hits.push({ report: summaryOf(r), passage, score: round2(score / words.length * 100) });
  }
  hits.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const top = hits.slice(0, 3);
  const shown = new Set(top.map((h) => h.report.id));
  const similar = sorted.filter((r) => !shown.has(r.id)).slice(0, 3).map(summaryOf);
  return { results: top, similar };
}

function reportFor(topic: string): Report {
  const p = valued();
  const tsla = p.holdings.find((h) => h.ticker === "TSLA");
  const exposure = tsla ? `${((tsla.weight ?? 0) * 100).toFixed(1)}%` : "none";
  return {
    id: newId("r"),
    title: topic.length > 80 ? `${topic.slice(0, 77)}…` : topic.charAt(0).toUpperCase() + topic.slice(1),
    topic,
    summary: `A sample research report on ${topic}, generated in mock mode to exercise the report view and search.`,
    tickers: ["TSLA"],
    created_at: new Date().toISOString(),
    body_md: `## Summary

This is a **sample report** produced by the mock backend. The real research agent plans sub-questions, gathers sources and writes a cited report.

## Key findings

- Demand for electric vehicles depends on price, incentives and charging access.
- Policy changes on EV subsidies shift purchase timing.
- Leadership and legal headlines can move TSLA on short notice.

## Affected tickers and your exposure

TSLA exposure: ${exposure} of net worth.

## Suggested triggers

- Leadership and legal news for Tesla
- EV policy and subsidy changes`,
    sources: [{ url: "https://example.com/sample-source", publisher: "Sample source (mock mode)", published_at: isoDate(new Date()), excerpt: "Placeholder source for the mock report." }],
    similar: [],
  };
}

function advanceJob(job: ResearchJob & { created: number }) {
  const age = Date.now() - job.created;
  if (job.status === "queued" && age > 800) job.status = "running";
  if (job.status === "running" && age > 7000) {
    const r = reportFor(job.topic);
    state.reports.unshift(r);
    job.status = "done";
    job.report_id = r.id;
  }
}

function deliveryOf(a: Alert): Alert {
  if (a.delivery_status === "failed" || a.delivery_status === "delivered") return a;
  const age = Date.now() - Date.parse(a.ts);
  const status = age > 6000 ? "delivered" : age > 2000 ? "sent" : "pending";
  return { ...a, delivery_status: status };
}

/* ------------------------------------------------------------------ */
/* Chat scripting                                                      */
/* ------------------------------------------------------------------ */

async function* typeOut(text: string, signal?: AbortSignal): AsyncGenerator<ChatEvent> {
  const parts = text.match(/\S+\s*|\s+/g) ?? [];
  for (let i = 0; i < parts.length; i += 2) {
    await sleep(18 + Math.random() * 26, signal);
    yield { type: "token", text: parts.slice(i, i + 2).join("") };
  }
}

async function* tool(id: string, name: string, label: string, signal?: AbortSignal): AsyncGenerator<ChatEvent> {
  yield { type: "tool", id, name, status: "running", label };
  await sleep(350 + Math.random() * 400, signal);
  yield { type: "tool", id, name, status: "done", label };
}

const fmtUsd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const DISCLAIMER = "\n\n_Educational, not financial advice._";

async function* chatScript(req: ChatRequest, signal?: AbortSignal): AsyncGenerator<ChatEvent> {
  const threadId = req.thread_id ?? newId("th");
  if (!state.threads[threadId]) state.threads[threadId] = { pending: [] };
  if (!req.thread_id) yield { type: "thread", thread_id: threadId };
  const msg = req.message.toLowerCase();
  await sleep(250, signal);

  if (/(report|research|deep dive)/.test(msg)) {
    yield* tool("t1", "request_research", "Starting a research report", signal);
    const topic = req.message.replace(/^(please\s+)?(write|make|create|start|run|do)?\s*(me\s+)?(a\s+)?(deep\s+)?(report|research)\s*(on|about)?\s*/i, "").trim() || "Tesla's US position and the risks to it";
    const job = await mockApi.startResearch(topic);
    yield { type: "research", job_id: job.job_id, topic: job.topic };
    yield* typeOut(`I've started a research report on **${job.topic}**. It usually takes a couple of minutes. I'll post it here when it's ready, and it will show up under Reports.${DISCLAIMER}`, signal);
    yield { type: "done" };
    return;
  }

  if (/(tesla|teslas|tsla)/.test(msg)) {
    yield* tool("t1", "get_portfolio", "Reading your portfolio", signal);
    yield* tool("t2", "get_quote", "Getting the TSLA quote", signal);
    yield* tool("t3", "search_news", "Searching recent Tesla news", signal);
    yield* tool("t4", "search_reports", "Checking your reports", signal);
    const p = valued();
    const tsla = p.holdings.find((h) => h.ticker === "TSLA");
    const exposure = tsla
      ? `You hold **${tsla.quantity} TSLA shares worth ${fmtUsd(tsla.value ?? 0)}**, which is **${((tsla.weight ?? 0) * 100).toFixed(1)}% of your net worth**.`
      : "You don't hold TSLA right now.";
    const price = tsla?.price != null ? ` TSLA last traded at ${fmtUsd(tsla.price)}.` : "";
    const text = `Teslas are common on US roads because the company has been one of the best-selling EV brands for several years. Price cuts made its cars cheaper to buy, and its charging network makes long trips easier than with many rivals.

${exposure}${price}

If you want to follow this theme, a few things are worth researching rather than acting on right away:

- **TSLA itself**, which moves sharply on leadership news, deliveries and policy
- **EV and autonomy ETFs**, which spread the bet across several companies
- **Competitors and suppliers**, such as other automakers and battery makers

I can watch the things most likely to move TSLA. Approve the ones you want below.${DISCLAIMER}`;
    yield* typeOut(text, signal);
    yield {
      type: "sources",
      items: [
        { title: "EV sales overview (sample)", url: "https://example.com/ev-sales", publisher: "Sample source (mock mode)" },
        { title: "Tesla pricing history (sample)", url: "https://example.com/tesla-pricing", publisher: "Sample source (mock mode)" },
      ],
    };
    const proposals = TESLA_PROPOSALS.map((spec) => ({ proposal_id: newId("p"), spec: clone(spec) }));
    state.threads[threadId].pending = proposals;
    yield { type: "proposals", proposals };
    yield { type: "done" };
    return;
  }

  if (/(portfolio|net worth|how much|allocation|exposure|holdings|cash|cd)/.test(msg)) {
    yield* tool("t1", "get_portfolio", "Reading your portfolio", signal);
    const p = valued();
    const pct = (n: number | null) => `${(((n ?? 0) / (p.total || 1)) * 100).toFixed(1)}%`;
    const top = [...p.holdings].sort((a, b) => (b.value ?? 0) - (a.value ?? 0)).slice(0, 3);
    yield* typeOut(
      `Your net worth is **${fmtUsd(p.total ?? 0)}**.

- Cash: ${fmtUsd(p.allocation.cash)} (${pct(p.allocation.cash)})
- CDs: ${fmtUsd(p.allocation.cd)} (${pct(p.allocation.cd)})
- Stocks: ${fmtUsd(p.allocation.stocks)} (${pct(p.allocation.stocks)})

Your largest positions are ${top.map((h) => `${h.name} (${pct(h.value)})`).join(", ")}.${DISCLAIMER}`,
      signal,
    );
    yield { type: "done" };
    return;
  }

  yield* typeOut(
    `I can explain what's behind something you've noticed, check your portfolio, set up triggers that watch for news, or write a research report. Try "I see a lot of Teslas on the road, why?" or "Write a report on EV subsidies."${DISCLAIMER}`,
    signal,
  );
  yield { type: "done" };
}

async function* resumeScript(threadId: string, req: ResumeRequest, signal?: AbortSignal): AsyncGenerator<ChatEvent> {
  const thread = state.threads[threadId];
  if (!thread || !thread.pending.length) {
    yield { type: "error", message: "There are no trigger proposals waiting in this conversation." };
    yield { type: "done" };
    return;
  }
  await sleep(300, signal);
  const created: Trigger[] = [];
  for (const d of req.decisions) {
    const proposal = thread.pending.find((p) => p.proposal_id === d.proposal_id);
    if (!proposal || d.action === "reject") continue;
    const spec: TriggerSpec = d.spec ?? proposal.spec;
    yield* tool(`c-${d.proposal_id}`, "create_trigger", `Creating "${spec.name}"`, signal);
    const trig: Trigger = {
      ...clone(spec),
      id: newId("t"),
      status: "active",
      pinned: false,
      created_at: new Date().toISOString(),
      last_checked_at: null,
      last_level: null,
      last_severity: null,
    };
    state.triggers.unshift(trig);
    state.evaluations[trig.id] = [makeEval(Date.now(), 8 + Math.random() * 10)];
    syncTriggerLast(trig);
    created.push(clone(trig));
  }
  thread.pending = [];
  if (created.length) yield { type: "triggers_created", triggers: created };
  const n = created.length;
  const text = n
    ? `Done. I'm watching ${n} trigger${n === 1 ? "" : "s"} now: ${created.map((t) => `**${t.name}**`).join(", ")}. You'll get a text for normal alerts and a call for critical ones.

Want a deeper report on Tesla's US position and the risks to it?`
    : "No triggers created. Ask me again any time you want something watched.";
  yield* typeOut(text, signal);
  yield { type: "done" };
}

/* ------------------------------------------------------------------ */
/* API                                                                 */
/* ------------------------------------------------------------------ */

export const mockApi: FinanceApi = {
  async getPortfolio() {
    seedOnce();
    await latency();
    tickPrices();
    return valued();
  },
  async getNetWorthHistory(range) {
    seedOnce();
    await latency();
    return history(range);
  },

  async createHolding(input) {
    seedOnce();
    await latency();
    const h = holdingFromInput(input);
    state.holdings.push(h);
    return clone(h);
  },
  async updateHolding(id, patch) {
    seedOnce();
    await latency();
    const i = state.holdings.findIndex((h) => h.id === id);
    if (i === -1) throw new ApiError(404, "That holding no longer exists.");
    const h = holdingFromInput(patch, state.holdings[i]);
    state.holdings[i] = h;
    return clone(h);
  },
  async deleteHolding(id) {
    seedOnce();
    await latency();
    state.holdings = state.holdings.filter((h) => h.id !== id);
  },
  async importHoldings(file): Promise<ImportResult> {
    seedOnce();
    await latency();
    const rows = parseCsv(await file.text());
    if (!rows.length) return { imported: 0, errors: [{ row: 1, message: "The file is empty." }] };
    const header = rows[0].map((h) => h.trim().toLowerCase());
    const col = (name: string) => header.indexOf(name);
    if (col("asset_class") === -1 || col("name") === -1) {
      return { imported: 0, errors: [{ row: 1, message: "The header row needs at least asset_class and name columns." }] };
    }
    const num = (v: string | undefined) => (v && v.trim() !== "" ? Number(v) : null);
    const str = (v: string | undefined) => (v && v.trim() !== "" ? v.trim() : null);
    const errors: ImportResult["errors"] = [];
    let imported = 0;
    rows.slice(1).forEach((r, i) => {
      try {
        const ac = (r[col("asset_class")] ?? "").trim().toLowerCase() as AssetClass;
        if (!["cash", "cd", "stock"].includes(ac)) throw new ApiError(422, `asset_class must be cash, cd or stock (got "${ac}").`);
        const h = holdingFromInput({
          asset_class: ac,
          name: str(r[col("name")]) ?? "",
          ticker: str(r[col("ticker")]),
          quantity: num(r[col("quantity")]),
          cost_basis: num(r[col("cost_basis")]),
          principal: num(r[col("principal")]),
          apy: num(r[col("apy")]),
          start_date: str(r[col("start_date")]),
          maturity_date: str(r[col("maturity_date")]),
        });
        state.holdings.push(h);
        imported++;
      } catch (e) {
        errors.push({ row: i + 2, message: e instanceof Error ? e.message : "Invalid row." });
      }
    });
    return { imported, errors };
  },

  async listTriggers() {
    seedOnce();
    await latency();
    tickEvaluations();
    return clone(state.triggers);
  },
  async updateTrigger(id, patch: TriggerPatch) {
    seedOnce();
    await latency();
    const t = state.triggers.find((x) => x.id === id);
    if (!t) throw new ApiError(404, "That trigger no longer exists.");
    Object.assign(t, patch);
    return clone(t);
  },
  async deleteTrigger(id) {
    seedOnce();
    await latency();
    state.triggers = state.triggers.filter((t) => t.id !== id);
    delete state.evaluations[id];
  },
  async getEvaluations(id, since) {
    seedOnce();
    await latency();
    tickEvaluations();
    const from = Date.parse(since);
    return clone((state.evaluations[id] ?? []).filter((e) => Date.parse(e.ts) >= from));
  },

  async listAlerts(status) {
    seedOnce();
    await latency();
    const list = state.alerts.map(deliveryOf).sort((a, b) => b.ts.localeCompare(a.ts));
    return clone(status === "open" ? list.filter((a) => !a.acked_at) : list);
  },
  async ackAlert(id) {
    seedOnce();
    await latency();
    const a = state.alerts.find((x) => x.id === id);
    if (!a) throw new ApiError(404, "That alert no longer exists.");
    a.acked_at = a.acked_at ?? new Date().toISOString();
    return clone(deliveryOf(a));
  },

  async searchReports(q) {
    seedOnce();
    await latency();
    Object.values(state.jobs).forEach(advanceJob);
    return clone(searchReports(q));
  },
  async getReport(id) {
    seedOnce();
    await latency();
    Object.values(state.jobs).forEach(advanceJob);
    const r = state.reports.find((x) => x.id === id);
    if (!r) throw new ApiError(404, "That report doesn't exist.");
    const similar = state.reports.filter((x) => x.id !== id).slice(0, 3).map(summaryOf);
    return clone({ ...r, similar });
  },
  async startResearch(topic) {
    seedOnce();
    await latency();
    const job = { job_id: newId("job"), topic: topic.trim() || "Untitled research", status: "queued" as const, report_id: null, error: null, created: Date.now() };
    state.jobs[job.job_id] = job;
    const { created: _created, ...pub } = job;
    void _created;
    return clone(pub);
  },
  async getResearchJob(jobId) {
    seedOnce();
    await latency();
    const job = state.jobs[jobId];
    if (!job) throw new ApiError(404, "That research job doesn't exist.");
    advanceJob(job);
    const { created: _created, ...pub } = job;
    void _created;
    return clone(pub);
  },

  streamChat(req, signal) {
    seedOnce();
    return chatScript(req, signal);
  },
  resumeChat(threadId, req, signal) {
    seedOnce();
    return resumeScript(threadId, req, signal);
  },

  async injectSignal(req: InjectSignalRequest): Promise<InjectSignalResponse> {
    seedOnce();
    await latency();
    const t = state.triggers.find((x) => x.id === req.trigger_id);
    if (!t) throw new ApiError(404, "Pick a trigger that still exists.");
    const p = valued();
    const weight = p.holdings.filter((h) => h.ticker && t.tickers.includes(h.ticker)).reduce((s, h) => s + (h.weight ?? 0), 0);
    const exposure = Math.min(1, weight / 0.1);
    const move = Math.abs(req.price_change_pct ?? 0);
    const magnitude = req.magnitude ?? Math.min(1, Math.max(0.35, move / 0.1));
    const credibility = ["sec_edgar", "federal_register", "nhtsa", "price", "fred"].includes(req.source) ? 1 : 0.8;
    const severe = /(sec|investigation|charged|subpoena|lawsuit|fraud)/i.test(req.title) || move >= 0.05;
    const urgency = severe ? 1 : 0.4;
    const adjustment = severe ? 5 : 0;
    let severity = 100 * (0.35 * magnitude + 0.25 * exposure + 0.2 * credibility + 0.2 * urgency) + adjustment;
    severity = Math.max(0, Math.min(100, severity));
    let level: EvaluationLevel = severity >= 75 ? "critical" : severity >= 40 ? "normal" : "ok";
    // Hard rule: critical needs M >= 0.6, a critical-capable trigger, and exposure >= 0.05 or a pinned trigger.
    let capped = false;
    if (level === "critical" && !(magnitude >= 0.6 && t.critical_capable && (exposure >= 0.05 || t.pinned))) {
      level = "normal";
      capped = true;
    }
    const evaluation: Evaluation = {
      ts: new Date().toISOString(),
      severity: Math.round(severity),
      level,
      magnitude: round2(magnitude),
      exposure: round2(exposure),
      credibility,
      urgency,
      adjustment,
    };
    (state.evaluations[t.id] ??= []).push(evaluation);
    syncTriggerLast(t);
    let alert: Alert | null = null;
    if (level !== "ok") {
      const movePart = req.price_change_pct != null ? ` ${t.tickers[0] ?? ""} is ${req.price_change_pct > 0 ? "up" : "down"} ${(move * 100).toFixed(1)}%.` : "";
      alert = {
        id: newId("a"),
        trigger_id: t.id,
        trigger_name: t.name,
        ts: evaluation.ts,
        level,
        severity: evaluation.severity,
        summary: `${req.title}.${movePart}`.replace(/\.\./g, ".").slice(0, 280),
        rationale:
          level === "critical"
            ? `Large, credible event with immediate price impact. Exposure is ${(weight * 100).toFixed(1)}% of net worth.`
            : capped
              ? `Scored as critical, but held at normal because ${t.critical_capable ? "the exposure or magnitude is too small for a call" : "this trigger isn't allowed to call"}. Exposure is ${(weight * 100).toFixed(1)}% of net worth.`
              : `Relevant to the trigger but not urgent. Exposure is ${(weight * 100).toFixed(1)}% of net worth.`,
        breakdown: { magnitude: evaluation.magnitude, exposure: evaluation.exposure, credibility, urgency, adjustment },
        evidence: [{ title: req.title, url: req.url || "https://example.com/injected-event", publisher: "Injected for the demo" }],
        channel: level === "critical" ? "call" : "text",
        delivery_status: "pending",
        attempts: 1,
        acked_at: null,
      };
      state.alerts.unshift(alert);
    }
    return clone({ evaluation, alert });
  },
};
