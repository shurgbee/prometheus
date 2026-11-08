import type { AlertPayload } from "./store.ts";

const MAX_SUMMARY = 600;

/**
 * Builds the alert text, e.g.
 *   [NORMAL] Tesla – leadership & legal (58)
 *   One-sentence summary.
 *   https://dashboard.example/?alert=…
 */
export function formatAlertText(alert: AlertPayload): string {
  const level = alert.level.trim().toUpperCase() || "ALERT";
  const score = typeof alert.severity === "number" && Number.isFinite(alert.severity)
    ? ` (${Math.round(alert.severity)})` : "";
  let summary = alert.summary.trim().replace(/\s+/g, " ");
  if (summary.length > MAX_SUMMARY) summary = `${summary.slice(0, MAX_SUMMARY - 1).trimEnd()}…`;
  return [`[${level}] ${alert.title.trim()}${score}`, summary, alert.url.trim()].filter(Boolean).join("\n");
}
