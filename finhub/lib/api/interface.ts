import type {
  Alert,
  ChatEvent,
  ChatRequest,
  Evaluation,
  HistoryRange,
  Holding,
  HoldingInput,
  ImportResult,
  InjectSignalRequest,
  InjectSignalResponse,
  NetWorthHistory,
  Portfolio,
  Report,
  ReportSearchResponse,
  ResearchJob,
  ResumeRequest,
  Trigger,
  TriggerPatch,
} from "./types";

/** Everything the UI needs from the backend. Implemented by httpApi and mockApi. */
export interface FinanceApi {
  getPortfolio(): Promise<Portfolio>;
  getNetWorthHistory(range: HistoryRange): Promise<NetWorthHistory>;

  createHolding(input: HoldingInput): Promise<Holding>;
  updateHolding(id: string, patch: Partial<HoldingInput>): Promise<Holding>;
  deleteHolding(id: string): Promise<void>;
  importHoldings(file: File): Promise<ImportResult>;

  listTriggers(): Promise<Trigger[]>;
  updateTrigger(id: string, patch: TriggerPatch): Promise<Trigger>;
  deleteTrigger(id: string): Promise<void>;
  getEvaluations(id: string, since: string): Promise<Evaluation[]>;

  listAlerts(status: "open" | "all"): Promise<Alert[]>;
  ackAlert(id: string): Promise<Alert>;

  searchReports(q?: string): Promise<ReportSearchResponse>;
  getReport(id: string): Promise<Report>;
  startResearch(topic: string): Promise<ResearchJob>;
  getResearchJob(jobId: string): Promise<ResearchJob>;

  streamChat(req: ChatRequest, signal?: AbortSignal): AsyncIterable<ChatEvent>;
  resumeChat(threadId: string, req: ResumeRequest, signal?: AbortSignal): AsyncIterable<ChatEvent>;

  getChatState?(id: string): Promise<import("./backend").ThreadState>;
  retryChat?(id: string, signal?: AbortSignal): AsyncIterable<ChatEvent>;

  injectSignal(req: InjectSignalRequest): Promise<InjectSignalResponse>;
}
