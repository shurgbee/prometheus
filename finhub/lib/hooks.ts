"use client";

import useSWR, { mutate as globalMutate } from "swr";
import { api } from "./api";
import type { Alert, Evaluation, HistoryRange, NetWorthHistory, Portfolio, Report, ReportSearchResponse, Trigger } from "./api";

/** SWR keys, exported so other components can refresh data after a change. */
export const keys = {
  portfolio: ["portfolio"] as const,
  history: (range: HistoryRange) => ["history", range] as const,
  triggers: ["triggers"] as const,
  evaluations: (id: string) => ["evaluations", id] as const,
  alerts: (status: "open" | "all") => ["alerts", status] as const,
  reports: (q: string) => ["reports", q] as const,
  report: (id: string) => ["report", id] as const,
};

/** Refresh every cached list whose key starts with `name` (e.g. "alerts", "reports"). */
export function refresh(name: "portfolio" | "history" | "triggers" | "evaluations" | "alerts" | "reports" | "report") {
  return globalMutate((key) => Array.isArray(key) && key[0] === name);
}

const DAY = 86_400_000;

export function usePortfolio() {
  return useSWR<Portfolio>(keys.portfolio, () => api.getPortfolio(), {
    // Spec: 60 s refresh during market hours, otherwise on load (and on focus).
    refreshInterval: (latest) => (latest?.market_open ? 60_000 : 0),
    keepPreviousData: true,
  });
}

export function useNetWorthHistory(range: HistoryRange) {
  return useSWR<NetWorthHistory>(keys.history(range), () => api.getNetWorthHistory(range), {
    keepPreviousData: true,
  });
}

export function useTriggers() {
  return useSWR<Trigger[]>(keys.triggers, () => api.listTriggers(), { refreshInterval: 30_000 });
}

export function useEvaluations(triggerId: string) {
  return useSWR<Evaluation[]>(
    keys.evaluations(triggerId),
    () => api.getEvaluations(triggerId, new Date(Date.now() - DAY).toISOString()),
    { refreshInterval: 30_000 },
  );
}

export function useAlerts(status: "open" | "all") {
  // Spec (MVP): the alert feed polls every 5 s instead of using SSE.
  return useSWR<Alert[]>(keys.alerts(status), () => api.listAlerts(status), { refreshInterval: 5_000 });
}

export function useReports(q: string) {
  return useSWR<ReportSearchResponse>(keys.reports(q), () => api.searchReports(q), { keepPreviousData: true });
}

export function useReport(id: string | null) {
  return useSWR<Report>(id ? keys.report(id) : null, () => api.getReport(id as string));
}
