/** FastAPI wire formats. Components use the normalized view models in types.ts. */
import type { Holding, ReportSummary, SignalSpec, TriggerSpec } from "./types";

export interface BackendHolding extends Holding {
  value: number | null;
  price?: number | null;
  weight: number | null;
  gain?: number | null;
  gain_percent?: number | null;
  day_change?: number | null;
  day_change_percent?: number | null;
  stale?: boolean;
}
export interface BackendPortfolio {
  as_of: string;
  market_open: boolean;
  total: number | null;
  day_change: number | null;
  day_change_percent: number | null;
  allocation: { cash: number; cd: number; stocks: number };
  holdings: BackendHolding[];
  complete: boolean;
  warnings: string[];
  demo: boolean;
  dev_injection_enabled: boolean;
}
export interface BackendTrigger {
  id: string;
  spec: TriggerSpec & { pinned?: boolean; signals: SignalSpec[] };
  status: "active" | "paused";
  created_at: string;
  last_checked_at: string | null;
  level: "OK" | "Normal" | "Critical";
  last_severity?: number | null;
}
export interface BackendEvaluation {
  ts: string;
  magnitude: number;
  exposure: number;
  credibility: number;
  urgency: number;
  adjustment: number;
  severity: number;
  level: "OK" | "Normal" | "Critical";
  suppressed_reason?: string | null;
}
export interface BackendAlert {
  id: string;
  trigger_id: string;
  trigger_name: string;
  created_at: string;
  level: "Normal" | "Critical";
  severity: number;
  summary: string;
  rationale: string | null;
  breakdown: import("./types").SeverityBreakdown | null;
  evidence: import("./types").Evidence[];
  channel: "pending" | "text" | "call";
  delivery_status: import("./types").DeliveryStatus;
  attempts: number;
  acked_at: string | null;
  demo: boolean;
}
export interface BackendJob {
  id: string;
  topic: string;
  status: "queued" | "running" | "completed" | "failed";
  report_id: string | null;
  error: string | null;
}
export interface BackendSearch {
  reports?: ReportSummary[];
  matches?: (ReportSummary & { passage: string; score: number })[];
  similar?: ReportSummary[];
}
export interface BackendFrame {
  type: string;
  [key: string]: unknown;
}
export interface ThreadState {
  thread_id: string;
  history: { role: "user" | "assistant"; content: string }[];
  proposals: import("./types").TriggerProposal[];
  awaiting_approval: boolean;
  retryable: boolean;
  research_job?: BackendJob | null;
}
