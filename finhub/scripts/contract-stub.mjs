#!/usr/bin/env node
/**
 * Tiny reference server that speaks the API contract (API_CONTRACT.md).
 * It exists so the frontend can be tested in real-HTTP mode before the FastAPI
 * backend is ready, and so the backend team can see example responses,
 * including the chat SSE format. It is NOT the backend.
 *
 *   node scripts/contract-stub.mjs            # listens on :8000
 *   PORT=8010 node scripts/contract-stub.mjs
 */
import http from "node:http";
import { randomUUID } from "node:crypto";

const PORT = Number(process.env.PORT || 8000);
const now = () => new Date().toISOString();
const DAY = 86_400_000;

const holdings = [
  { id: "h1", asset_class: "cash", name: "High-yield savings", ticker: null, quantity: null, cost_basis: null, principal: 32400, apy: 0.04, start_date: null, maturity_date: null },
  { id: "h2", asset_class: "cd", name: "12-month CD", ticker: null, quantity: null, cost_basis: null, principal: 25000, apy: 0.046, start_date: "2026-03-02", maturity_date: "2027-03-02" },
  { id: "h3", asset_class: "stock", name: "Tesla", ticker: "TSLA", quantity: 40, cost_basis: 205, principal: null, apy: null, start_date: null, maturity_date: null },
  { id: "h4", asset_class: "stock", name: "Apple", ticker: "AAPL", quantity: 60, cost_basis: 182, principal: null, apy: null, start_date: null, maturity_date: null },
];
const prices = { TSLA: [251.9, 248.4], AAPL: [228.1, 229.3] }; // [prev close, latest]
const triggers = [];
const evaluations = {};
const alerts = [];
const reports = [
  {
    id: "r1",
    title: "EV policy: what incentives and tariffs mean for automakers",
    topic: "EV policy",
    summary: "How EV incentives, subsidies and tariffs shape demand.",
    tickers: ["TSLA"],
    created_at: now(),
    body_md: "## Summary\n\nEV subsidies shift purchase timing.",
    sources: [{ url: "https://example.com/a", publisher: "Example", published_at: "2026-10-28", excerpt: "Example excerpt." }],
    similar: [],
  },
];
const jobs = {};
const threads = {};

function portfolio() {
  const rows = holdings.map((h) => {
    if (h.asset_class === "stock") {
      const [prev, price] = prices[h.ticker] ?? [h.cost_basis, h.cost_basis];
      const value = h.quantity * price;
      const cost = h.quantity * (h.cost_basis ?? 0);
      return { ...h, price, value, day_change: h.quantity * (price - prev), day_change_pct: (price - prev) / prev, gain: value - cost, gain_pct: cost ? (value - cost) / cost : null, weight: 0 };
    }
    if (h.asset_class === "cd") {
      const d = Math.floor((Date.now() - Date.parse(h.start_date)) / DAY);
      const value = h.principal * Math.pow(1 + h.apy / 365, Math.max(0, d));
      return { ...h, price: null, value, day_change: null, day_change_pct: null, gain: value - h.principal, gain_pct: (value - h.principal) / h.principal, weight: 0 };
    }
    return { ...h, price: null, value: h.principal, day_change: null, day_change_pct: null, gain: null, gain_pct: null, weight: 0 };
  });
  const total = rows.reduce((s, r) => s + r.value, 0);
  rows.forEach((r) => (r.weight = r.value / total));
  const sum = (c) => rows.filter((r) => r.asset_class === c).reduce((s, r) => s + r.value, 0);
  const dayChange = rows.reduce((s, r) => s + (r.day_change ?? 0), 0);
  return { as_of: now(), market_open: false, total, day_change: dayChange, day_change_pct: dayChange / (total - dayChange), allocation: { cash: sum("cash"), cd: sum("cd"), stocks: sum("stock") }, holdings: rows };
}

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
  res.end(body === undefined ? "" : JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const text = Buffer.concat(chunks).toString("utf8");
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Write SSE frames. CRLF line endings and split writes on purpose, to prove the client copes. */
async function sse(res, events) {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  res.write(": stream open\r\n\r\n");
  for (const ev of events) {
    const { type, ...data } = ev;
    const frame = `event: ${type}\r\ndata: ${JSON.stringify(data)}\r\n\r\n`;
    const mid = Math.floor(frame.length / 2);
    res.write(frame.slice(0, mid));
    await sleep(15);
    res.write(frame.slice(mid));
    await sleep(25);
  }
  res.end();
}

const PROPOSAL = {
  name: "Tesla – leadership & legal",
  entity: "Tesla",
  tickers: ["TSLA"],
  hypothesis: "Investigations or legal action involving Tesla or Elon Musk move TSLA",
  signals: [{ source: "news", query: "Tesla OR Musk investigation", detector: "text_event", poll: "5m" }],
  critical_capable: true,
  cooldown: { normal: "6h", critical: "1h" },
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;
  const m = req.method;
  if (m === "OPTIONS") {
    res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "*" });
    return res.end();
  }
  try {
    if (m === "GET" && p === "/api/portfolio") return json(res, 200, portfolio());
    if (m === "GET" && p === "/api/networth/history") {
      const range = url.searchParams.get("range") || "3M";
      const days = { "1M": 30, "3M": 90, "1Y": 365, ALL: 730 }[range] ?? 90;
      const pf = portfolio();
      const points = Array.from({ length: days }, (_, i) => {
        const d = new Date(Date.now() - (days - 1 - i) * DAY);
        const f = 1 - (days - 1 - i) * 0.0004;
        return { ts: d.toISOString().slice(0, 10), total: pf.total * f, cash: pf.allocation.cash, cd: pf.allocation.cd, stocks: pf.allocation.stocks * f };
      });
      return json(res, 200, { range, points });
    }
    if (m === "POST" && p === "/api/holdings") {
      const body = await readBody(req);
      const h = { id: randomUUID(), ...body };
      holdings.push(h);
      return json(res, 201, h);
    }
    let mm;
    if ((mm = p.match(/^\/api\/holdings\/([^/]+)$/))) {
      const i = holdings.findIndex((h) => h.id === mm[1]);
      if (i === -1) return json(res, 404, { detail: "Holding not found" });
      if (m === "PATCH") {
        holdings[i] = { ...holdings[i], ...(await readBody(req)) };
        return json(res, 200, holdings[i]);
      }
      if (m === "DELETE") {
        holdings.splice(i, 1);
        res.writeHead(204);
        return res.end();
      }
    }
    if (m === "POST" && p === "/api/holdings/import") {
      for await (const _ of req) void _; // multipart body ignored by the stub
      return json(res, 200, { imported: 0, errors: [{ row: 2, message: "The stub doesn't parse CSV files." }] });
    }
    if (m === "GET" && p === "/api/triggers") return json(res, 200, triggers);
    if ((mm = p.match(/^\/api\/triggers\/([^/]+)\/evaluations$/))) {
      const since = Date.parse(url.searchParams.get("since") || 0);
      return json(res, 200, (evaluations[mm[1]] ?? []).filter((e) => Date.parse(e.ts) >= since));
    }
    if ((mm = p.match(/^\/api\/triggers\/([^/]+)$/))) {
      const t = triggers.find((x) => x.id === mm[1]);
      if (!t) return json(res, 404, { detail: "Trigger not found" });
      if (m === "PATCH") return json(res, 200, Object.assign(t, await readBody(req)));
      if (m === "DELETE") {
        triggers.splice(triggers.indexOf(t), 1);
        res.writeHead(204);
        return res.end();
      }
    }
    if (m === "GET" && p === "/api/alerts") {
      const status = url.searchParams.get("status") || "open";
      return json(res, 200, status === "open" ? alerts.filter((a) => !a.acked_at) : alerts);
    }
    if ((mm = p.match(/^\/api\/alerts\/([^/]+)\/ack$/)) && m === "POST") {
      const a = alerts.find((x) => x.id === mm[1]);
      if (!a) return json(res, 404, { detail: "Alert not found" });
      a.acked_at ??= now();
      return json(res, 200, a);
    }
    if (m === "GET" && p === "/api/reports") {
      const q = (url.searchParams.get("q") || "").toLowerCase();
      const summaries = reports.map(({ body_md, sources, similar, ...s }) => s);
      if (!q) return json(res, 200, { results: summaries.map((r) => ({ report: r, passage: null, score: null })), similar: [] });
      const hits = summaries.filter((r) => `${r.title} ${r.summary}`.toLowerCase().includes(q.split(" ")[0]));
      return json(res, 200, { results: hits.map((r) => ({ report: r, passage: r.summary, score: 0.8 })), similar: [] });
    }
    if ((mm = p.match(/^\/api\/reports\/([^/]+)$/))) {
      const r = reports.find((x) => x.id === mm[1]);
      return r ? json(res, 200, r) : json(res, 404, { detail: "Report not found" });
    }
    if (m === "POST" && p === "/api/research") {
      const body = await readBody(req);
      const job = { job_id: randomUUID(), topic: body.topic || "Untitled", status: "queued", report_id: null, error: null, created: Date.now() };
      jobs[job.job_id] = job;
      const { created, ...pub } = job;
      return json(res, 202, pub);
    }
    if ((mm = p.match(/^\/api\/research\/([^/]+)$/))) {
      const job = jobs[mm[1]];
      if (!job) return json(res, 404, { detail: "Job not found" });
      if (Date.now() - job.created > 3000 && job.status !== "done") {
        const r = { ...reports[0], id: randomUUID(), title: job.topic, created_at: now() };
        reports.unshift(r);
        Object.assign(job, { status: "done", report_id: r.id });
      } else if (job.status === "queued") job.status = "running";
      const { created, ...pub } = job;
      return json(res, 200, pub);
    }
    if (m === "POST" && p === "/api/chat") {
      const body = await readBody(req);
      const threadId = body.thread_id || randomUUID();
      const proposalId = randomUUID();
      threads[threadId] = { proposals: { [proposalId]: PROPOSAL } };
      const events = [];
      if (!body.thread_id) events.push({ type: "thread", thread_id: threadId });
      events.push({ type: "tool", id: "t1", name: "get_portfolio", status: "running", label: "Reading your portfolio" });
      events.push({ type: "tool", id: "t1", name: "get_portfolio", status: "done" });
      for (const word of `You asked: "${body.message}". Here is a streamed answer with **markdown** and émojis-free unicode: café, ±, 漢字.`.split(/(?<= )/)) {
        events.push({ type: "token", text: word });
      }
      events.push({ type: "sources", items: [{ title: "Example source", url: "https://example.com", publisher: "Example" }] });
      events.push({ type: "proposals", proposals: [{ proposal_id: proposalId, spec: PROPOSAL }] });
      events.push({ type: "done" });
      return sse(res, events);
    }
    if ((mm = p.match(/^\/api\/chat\/([^/]+)\/resume$/)) && m === "POST") {
      const body = await readBody(req);
      const thread = threads[mm[1]];
      if (!thread) return json(res, 404, { detail: "Thread not found" });
      const created = [];
      for (const d of body.decisions || []) {
        if (d.action !== "approve") continue;
        const spec = d.spec || thread.proposals[d.proposal_id];
        const t = { ...spec, id: randomUUID(), status: "active", pinned: false, created_at: now(), last_checked_at: now(), last_level: "ok", last_severity: 12 };
        triggers.unshift(t);
        evaluations[t.id] = [{ ts: now(), severity: 12, level: "ok", magnitude: 0.1, exposure: 0.4, credibility: 0.8, urgency: 0.1, adjustment: 0 }];
        created.push(t);
      }
      return sse(res, [
        ...(created.length ? [{ type: "triggers_created", triggers: created }] : []),
        { type: "token", text: created.length ? `Watching ${created.length} trigger(s).` : "No triggers created." },
        { type: "done" },
      ]);
    }
    if (m === "POST" && p === "/api/dev/inject-signal") {
      const body = await readBody(req);
      const t = triggers.find((x) => x.id === body.trigger_id);
      if (!t) return json(res, 404, { detail: "Trigger not found" });
      const severity = body.price_change_pct && body.price_change_pct <= -0.05 ? 87 : 54;
      const level = severity >= 75 ? "critical" : "normal";
      const evaluation = { ts: now(), severity, level, magnitude: 0.9, exposure: 0.41, credibility: 1, urgency: 1, adjustment: 5 };
      (evaluations[t.id] ??= []).push(evaluation);
      Object.assign(t, { last_checked_at: evaluation.ts, last_level: level, last_severity: severity });
      const alert = { id: randomUUID(), trigger_id: t.id, trigger_name: t.name, ts: evaluation.ts, level, severity, summary: body.title, rationale: "Stub rationale.", breakdown: { magnitude: 0.9, exposure: 0.41, credibility: 1, urgency: 1, adjustment: 5 }, evidence: [{ title: body.title, url: body.url || "https://example.com", publisher: "Stub" }], channel: level === "critical" ? "call" : "text", delivery_status: "sent", attempts: 1, acked_at: null };
      alerts.unshift(alert);
      return json(res, 200, { evaluation, alert });
    }
    return json(res, 404, { detail: `No route for ${m} ${p}` });
  } catch (e) {
    return json(res, 500, { detail: String(e) });
  }
});

server.listen(PORT, () => console.log(`contract stub listening on http://localhost:${PORT}`));
