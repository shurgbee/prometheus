const usd0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const usd2 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const compact = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 });
const num = new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 });

export function money(n: number | null | undefined, opts: { cents?: boolean; compact?: boolean } = {}): string {
  if (n == null || Number.isNaN(n)) return "—";
  if (opts.compact) return compact.format(n);
  return (opts.cents ? usd2 : usd0).format(n);
}

/** Signed money, e.g. "+$1,204" / "−$88". Uses a true minus sign. */
export function signedMoney(n: number | null | undefined, opts: { cents?: boolean } = {}): string {
  if (n == null || Number.isNaN(n)) return "—";
  const abs = money(Math.abs(n), opts);
  if (n > 0) return `+${abs}`;
  if (n < 0) return `−${abs}`;
  return abs;
}

/** Fraction to percent, e.g. 0.0123 → "1.23%". */
export function pct(f: number | null | undefined, digits = 2): string {
  if (f == null || Number.isNaN(f)) return "—";
  return `${(f * 100).toFixed(digits)}%`;
}

export function signedPct(f: number | null | undefined, digits = 2): string {
  if (f == null || Number.isNaN(f)) return "—";
  const s = `${Math.abs(f * 100).toFixed(digits)}%`;
  if (f > 0) return `+${s}`;
  if (f < 0) return `−${s}`;
  return s;
}

export function quantity(n: number | null | undefined): string {
  if (n == null) return "—";
  return num.format(n);
}

export function direction(n: number | null | undefined): "up" | "down" | "flat" {
  if (n == null || n === 0 || Number.isNaN(n)) return "flat";
  return n > 0 ? "up" : "down";
}

/** "just now", "4 min ago", "3 h ago", "Nov 5". */
export function relativeTime(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "never";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const s = Math.round((now - t) / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d} d ago`;
  return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  // Date-only strings are calendar dates: render them in UTC so they don't shift a day.
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(iso);
  const d = new Date(dateOnly ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", ...(dateOnly ? { timeZone: "UTC" } : {}) });
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** Whole days from today (local) until a "YYYY-MM-DD" date. Negative if past. */
export function daysUntil(dateOnly: string | null | undefined, now: Date = new Date()): number | null {
  if (!dateOnly) return null;
  const target = Date.parse(`${dateOnly}T00:00:00Z`);
  if (Number.isNaN(target)) return null;
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target - today) / 86_400_000);
}

/** Split "$248,310.42" into whole and cents for the hero figure. */
export function splitMoney(n: number): { whole: string; cents: string } {
  const s = usd2.format(n);
  const i = s.lastIndexOf(".");
  return i === -1 ? { whole: s, cents: "" } : { whole: s.slice(0, i), cents: s.slice(i) };
}
