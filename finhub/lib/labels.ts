import type { Alert, SignalSpec } from "./api";

const SOURCE_LABELS: Record<string, string> = {
  price: "Price",
  news: "News",
  event: "Event",
  sec_edgar: "SEC filings",
  federal_register: "Federal Register",
  nhtsa: "NHTSA recalls",
  fred: "FRED",
  congress: "Congress.gov",
  bls: "BLS",
};

export function signalLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

/** "5m" → "every 5 min", "1h" → "every hour". */
export function pollLabel(poll: string): string {
  const m = /^(\d+)\s*([smhd])$/i.exec(poll.trim());
  if (!m) return poll;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  const names: Record<string, [string, string]> = { s: ["second", "sec"], m: ["minute", "min"], h: ["hour", "h"], d: ["day", "days"] };
  if (unit === "m" && n % 60 === 0) return n === 60 ? "every hour" : `every ${n / 60} h`;
  if (n === 1) return `every ${names[unit][0]}`;
  return `every ${n} ${names[unit][1]}`;
}

export function signalSummary(s: SignalSpec): string {
  const level = s.params?.level;
  if (s.detector === "price_level" && typeof level === "number") {
    const move = s.params?.direction === "below" ? "Falls to" : "Rises to";
    return `${move} $${level.toLocaleString("en-US")}, ${pollLabel(s.poll)}`;
  }
  if (s.detector === "event_occurs") return `Checks news ${pollLabel(s.poll)}, alerts once`;
  return `${signalLabel(s.source)}, ${pollLabel(s.poll)}`;
}

export function deliveryLabel(a: Pick<Alert, "channel" | "delivery_status" | "demo">): string {
  if (a.demo || a.delivery_status === "demo_recorded") return "Demo only; no phone delivery";
  const labels: Partial<Record<Alert["delivery_status"], string>> = {
    pending: "Queued for delivery", sending: "Sending to notifier", accepted: "Accepted by notifier",
    calling: "Calling", missed: "Call missed", retry: "Retrying delivery", retrying: "Retrying delivery",
    acknowledged: "Acknowledged", text_fallback: "Detail text sent", cancelled: "Delivery cancelled",
  };
  if (labels[a.delivery_status]) return labels[a.delivery_status]!;
  if (a.delivery_status === "sent") return a.channel === "call" ? "Call placed" : "Text sent";
  if (a.delivery_status === "delivered") return a.channel === "call" ? "Call answered" : "Text delivered";
  if (a.delivery_status === "failed") return "Delivery failed";
  return a.delivery_status;
}
