"use client";

import clsx from "clsx";
import { ArrowDownRight, ArrowUpRight, BellRing, CircleCheck, Phone, RotateCw } from "lucide-react";
import type { EvaluationLevel } from "@/lib/api";
import { direction, signedMoney, signedPct } from "@/lib/format";

export function SectionHeader({
  title,
  action,
  id,
}: {
  title: string;
  action?: React.ReactNode;
  id?: string;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
      <h2 id={id} className="section-title min-w-0">
        {title}
      </h2>
      {action}
    </div>
  );
}

/** Signed change in money and/or percent, colored by direction, with an arrow so color isn't the only cue. */
export function Delta({
  amount,
  fraction,
  className,
  suffix,
}: {
  amount?: number | null;
  fraction?: number | null;
  className?: string;
  suffix?: string;
}) {
  const dir = direction(amount ?? fraction);
  const Icon = dir === "down" ? ArrowDownRight : ArrowUpRight;
  const parts: string[] = [];
  if (amount != null) parts.push(signedMoney(amount));
  if (fraction != null) parts.push(amount != null ? `(${signedPct(fraction)})` : signedPct(fraction));
  if (!parts.length) return <span className={clsx("text-ink-3", className)}>—</span>;
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-0.5 num",
        dir === "up" && "text-up",
        dir === "down" && "text-down",
        dir === "flat" && "text-ink-2",
        className,
      )}
    >
      {dir !== "flat" && <Icon size={14} aria-hidden className="shrink-0" />}
      <span>
        {parts.join(" ")}
        {suffix ? <span className="text-ink-3"> {suffix}</span> : null}
      </span>
    </span>
  );
}

const LEVEL = {
  ok: { label: "OK", Icon: CircleCheck, dot: "bg-ink-3", text: "text-ink-2" },
  normal: { label: "Normal alert", Icon: BellRing, dot: "bg-status-normal", text: "text-ink" },
  critical: { label: "Critical alert", Icon: Phone, dot: "bg-status-critical", text: "text-ink" },
} as const;

/** Level badge: icon + label + colored dot, never color alone. */
export function LevelBadge({ level, compact }: { level: EvaluationLevel | null; compact?: boolean }) {
  if (!level) return <span className="text-xs text-ink-3">Not checked yet</span>;
  const { label, Icon, dot, text } = LEVEL[level];
  return (
    <span className={clsx("inline-flex items-center gap-1.5 text-xs", text)}>
      <span aria-hidden className={clsx("h-1.5 w-1.5 rounded-full", dot)} />
      {!compact && <Icon size={13} aria-hidden className="text-ink-3" />}
      {compact && level !== "ok" ? label.replace(" alert", "") : label}
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={clsx("animate-pulse rounded bg-raised", className)} />;
}

export function ErrorNote({ error, onRetry, what }: { error: unknown; onRetry?: () => void; what: string }) {
  const message = error instanceof Error ? error.message : "Unknown error";
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded border border-line-strong px-3 py-2.5 text-sm">
      <span className="text-ink-2">
        Couldn&apos;t load {what}: <span className="text-ink">{message}</span>
      </span>
      {onRetry && (
        <button onClick={onRetry} className="btn-quiet ml-auto">
          <RotateCw size={14} aria-hidden /> Try again
        </button>
      )}
    </div>
  );
}

export function EmptyState({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="rounded border border-edge bg-surface px-4 py-6 text-sm text-ink-2">
      <div className="max-w-prose">{children}</div>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="bg-surface inline-flex rounded-pill border border-edge p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={clsx(
            "rounded-pill px-2.5 py-1 text-xs transition-colors",
            value === o.value ? "bg-raised text-ink" : "text-ink-3 hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Ticker({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-sm border border-line px-1.5 py-px text-2xs font-semibold tracking-wide text-ink-2">
      {children}
    </span>
  );
}
