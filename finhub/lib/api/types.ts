/**
 * Component view models shared by the HTTP adapter and optional browser mocks.
 * backend.ts describes FastAPI wire shapes; API_CONTRACT.md documents the adaptations.
 *
 * Conventions
 * - All money values are USD numbers (not strings, not cents).
 * - All percentages and rates are FRACTIONS: 0.0123 means 1.23%. APY 0.045 means 4.5%.
 * - All timestamps are ISO 8601 strings with timezone (e.g. "2026-11-07T19:30:00Z").
 * - Dates without time are "YYYY-MM-DD".
 * - IDs are strings.
 */

export type AssetClass = "cash" | "cd" | "stock";

export interface Holding {
  id: string;
  asset_class: AssetClass;
  /** Display name, e.g. "Ally savings", "Marcus 12-mo CD", "Tesla". */
  name: string;
  /** Stocks only. Uppercase ticker, e.g. "TSLA". null for cash and CDs. */
  ticker: string | null;
  /** Stocks only. Number of shares. */
  quantity: number | null;
  /** Stocks only. Total cost of the stock position in USD (quantity × average purchase price). */
  cost_basis: number | null;
  /** Cash: current balance. CD: amount deposited. null for stocks. */
  principal: number | null;
  /** CDs only (optional for cash). Fraction, e.g. 0.045. */
  apy: number | null;
  /** CDs only. "YYYY-MM-DD". */
  start_date: string | null;
  /** CDs only. "YYYY-MM-DD". */
  maturity_date: string | null;
}

/** Body for POST /api/holdings and PATCH /api/holdings/{id} (partial on PATCH). */
export type HoldingInput = Omit<Holding, "id">;

export interface ValuedHolding extends Holding {
  /** Stocks: latest price per share. null for cash and CDs. */
  price: number | null;
  /** Current value in USD. Stocks: quantity x price. Cash: principal. CDs: accrued value. */
  value: number | null;
  /** Change in value since the previous close, USD. null when unknown (cash, CDs). */
  day_change: number | null;
  /** Fraction. null when unknown. */
  day_change_pct: number | null;
  /** Stocks: value - cost_basis. CDs: value - principal. Cash: null. */
  gain: number | null;
  /** Fraction of cost. null for cash. */
  gain_pct: number | null;
  /** Fraction of total net worth, 0..1. */
  weight: number | null;
}

export interface Portfolio {
  as_of: string;
  /** Whether the US stock market is open right now. Drives the 60 s refresh. */
  market_open: boolean;
  total: number | null;
  day_change: number | null;
  /** Fraction. */
  day_change_pct: number | null;
  allocation: {
    cash: number;
    cd: number;
    stocks: number;
  };
  holdings: ValuedHolding[];
  demo?: boolean;
  complete?: boolean;
  warnings?: string[];
  dev_injection_enabled?: boolean;
}

export type HistoryRange = "1M" | "3M" | "1Y" | "ALL";

export interface NetWorthPoint {
  /** "YYYY-MM-DD" (one point per day). */
  ts: string;
  total: number;
  cash: number;
  cd: number;
  stocks: number;
}

export interface NetWorthHistory {
  range: HistoryRange;
  points: NetWorthPoint[];
}

export interface ImportResult {
  imported: number;
  errors: { row: number; message: string }[];
}

/* ------------------------------------------------------------------ */
/* Triggers                                                            */
/* ------------------------------------------------------------------ */

export type SignalSource = "price" | "news" | "sec_edgar" | "federal_register" | "nhtsa" | "fred" | string;

export interface SignalSpec {
  source: SignalSource;
  query: string;
  /** e.g. "text_event", "return_zscore", "daily_change", "volume_ratio". */
  detector: string;
  params?: Record<string, number | string | boolean | string[]>;
  /** Poll interval, e.g. "1m", "5m", "15m". */
  poll: string;
}

/** What the agent proposes and the user approves (spec: "Trigger spec"). */
export interface TriggerSpec {
  name: string;
  entity: string;
  tickers: string[];
  hypothesis: string;
  signals: SignalSpec[];
  critical_capable: boolean;
  cooldown: { normal: string; critical: string };
}

export type AlertLevel = "normal" | "critical";
export type EvaluationLevel = "ok" | AlertLevel;

export interface Trigger extends TriggerSpec {
  id: string;
  status: "active" | "paused";
  pinned: boolean;
  created_at: string;
  last_checked_at: string | null;
  last_level: EvaluationLevel | null;
  last_severity: number | null;
}

/** PATCH /api/triggers/{id}. All fields optional. */
export type TriggerPatch = Partial<Pick<Trigger, "status" | "name" | "critical_capable" | "pinned">>;

export interface SeverityBreakdown {
  /** Each 0..1. */
  magnitude: number;
  exposure: number;
  credibility: number;
  urgency: number;
  /** Triage adjustment in points, -15..+15. */
  adjustment: number;
}

export interface Evaluation extends SeverityBreakdown {
  ts: string;
  /** Final score 0..100. */
  severity: number;
  level: EvaluationLevel;
}

/* ------------------------------------------------------------------ */
/* Alerts                                                              */
/* ------------------------------------------------------------------ */

export interface Evidence {
  title: string;
  url: string;
  publisher?: string | null;
}

export type DeliveryStatus = "pending" | "sending" | "accepted" | "sent" | "delivered" | "retry" | "retrying" | "failed" | "calling" | "missed" | "acknowledged" | "text_fallback" | "cancelled" | "demo_recorded";

export interface Alert {
  id: string;
  trigger_id: string;
  trigger_name: string;
  ts: string;
  level: AlertLevel;
  severity: number;
  /** <= 280 chars, written by the triage model. */
  summary: string;
  rationale: string | null;
  breakdown: SeverityBreakdown | null;
  evidence: Evidence[];
  /** "text" for normal alerts, "call" for critical (a detail text follows the call). */
  channel: "pending" | "text" | "call";
  demo?: boolean;
  delivery_status: DeliveryStatus;
  attempts: number;
  acked_at: string | null;
}

/* ------------------------------------------------------------------ */
/* Reports and research                                                */
/* ------------------------------------------------------------------ */

export interface ReportSummary {
  id: string;
  title: string;
  topic: string;
  summary: string;
  tickers: string[];
  created_at: string;
}

export interface ReportSource {
  url: string;
  publisher: string | null;
  published_at: string | null;
  excerpt: string | null;
}

export interface Report extends ReportSummary {
  body_md: string;
  sources: ReportSource[];
  similar: ReportSummary[];
}

export interface ReportSearchHit {
  report: ReportSummary;
  /** Best-matching passage for the query, or null when no query was given. */
  passage: string | null;
  /** Relevance score, higher is better. null when no query was given. */
  score: number | null;
}

/** GET /api/reports?q=. Without q: all reports newest first, similar = []. */
export interface ReportSearchResponse {
  results: ReportSearchHit[];
  similar: ReportSummary[];
}

export type ResearchStatus = "queued" | "running" | "done" | "failed";

export interface ResearchJob {
  job_id: string;
  topic: string;
  status: ResearchStatus;
  report_id: string | null;
  error: string | null;
}

/* ------------------------------------------------------------------ */
/* Chat (Server-Sent Events)                                           */
/* ------------------------------------------------------------------ */

export interface ChatSource {
  title: string;
  url: string;
  publisher?: string | null;
}

export interface TriggerProposal {
  proposal_id: string;
  spec: TriggerSpec;
}

/**
 * One SSE frame = `event: <type>` + `data: <json>` + blank line.
 * The `type` below is the SSE `event:` name; the rest of the object is the JSON in `data:`.
 */
export type ChatEvent =
  | { type: "thread"; thread_id: string }
  | { type: "token"; text: string }
  | { type: "tool"; id: string; name: string; status: "running" | "done" | "error"; label?: string | null }
  | { type: "sources"; items: ChatSource[] }
  | { type: "proposals"; proposals: TriggerProposal[] }
  | { type: "triggers_created"; triggers: Trigger[] }
  | { type: "research"; job_id: string; topic: string }
  | { type: "error"; message: string }
  | { type: "done" };

export interface ChatRequest {
  /** null starts a new thread; the backend replies with a `thread` event first. */
  thread_id: string | null;
  message: string;
}

export interface ProposalDecision {
  proposal_id: string;
  action: "approve" | "edit" | "reject";
  /** Present when the user edited the proposal before approving. */
  spec?: TriggerSpec;
}

export interface ResumeRequest {
  decisions: ProposalDecision[];
}

/* ------------------------------------------------------------------ */
/* Demo                                                                */
/* ------------------------------------------------------------------ */

export interface InjectSignalRequest {
  trigger_id: string;
  source: SignalSource;
  title: string;
  url?: string | null;
  /** Optional override for the detector magnitude, 0..1. */
  magnitude?: number | null;
  /** Optional synthetic price move, fraction (e.g. -0.08). */
  price_change_pct?: number | null;
  urgency?: number;
  external_id?: string;
}

export interface InjectSignalResponse {
  evaluation: Evaluation;
  /** null when the score stayed below 40 (OK) or the cooldown suppressed it. */
  alert: Alert | null;
  suppressed_reason?: string | null;
}
