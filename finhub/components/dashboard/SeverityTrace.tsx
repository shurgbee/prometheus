"use client";

import { useMemo, useRef, useState } from "react";
import type { Evaluation } from "@/lib/api";
import { dateTime } from "@/lib/format";

const W = 1000; // viewBox width; the SVG stretches to its container
const H = 64;
const PAD_Y = 6;
const DAY = 86_400_000;

const y = (severity: number) => PAD_Y + (1 - Math.max(0, Math.min(100, severity)) / 100) * (H - PAD_Y * 2);

const LEVEL_COLOR = { ok: "#8F8780", normal: "#FAB219", critical: "#D03B3B" } as const;

/**
 * 24-hour severity trace for one trigger, drawn like a seismograph.
 * Thresholds: 40 (text) and 75 (call). Hover shows the nearest evaluation.
 */
export function SeverityTrace({ evaluations, label }: { evaluations: Evaluation[]; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  // Window end is fixed per render of new data, so the trace doesn't drift between polls.
  const end = useMemo(() => {
    const latest = evaluations.reduce((m, e) => Math.max(m, Date.parse(e.ts) || 0), 0);
    return Math.max(latest, Date.now());
  }, [evaluations]);
  const start = end - DAY;

  const pts = useMemo(
    () =>
      evaluations
        .map((e) => ({ e, t: Date.parse(e.ts) }))
        .filter((p) => p.t >= start && p.t <= end)
        .sort((a, b) => a.t - b.t)
        .map((p) => ({ ...p, x: ((p.t - start) / DAY) * W, y: y(p.e.severity) })),
    [evaluations, start, end],
  );

  const path = pts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join("");
  const flagged = pts.filter((p) => p.e.level !== "ok");
  const lastPt = pts[pts.length - 1];
  const hovered = hover != null ? pts[hover] : null;

  function onMove(clientX: number) {
    const el = ref.current;
    if (!el || !pts.length) return;
    const rect = el.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * W;
    let best = 0;
    for (let i = 1; i < pts.length; i++) if (Math.abs(pts[i].x - x) < Math.abs(pts[best].x - x)) best = i;
    setHover(best);
  }

  const peak = pts.reduce((m, p) => Math.max(m, p.e.severity), 0);

  return (
    <div
      ref={ref}
      className="relative h-16 w-full select-none"
      onMouseMove={(e) => onMove(e.clientX)}
      onMouseLeave={() => setHover(null)}
      role="img"
      aria-label={`${label}: ${pts.length} checks in the last 24 hours, peak severity ${peak}.`}
    >
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible">
        {/* Threshold bands: above 75 calls, 40–75 texts. */}
        <rect x={0} y={y(100)} width={W} height={y(75) - y(100)} fill="#D03B3B" opacity={0.06} />
        <rect x={0} y={y(75)} width={W} height={y(40) - y(75)} fill="#FAB219" opacity={0.035} />
        <line x1={0} x2={W} y1={y(75)} y2={y(75)} stroke="#D03B3B" strokeOpacity={0.45} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        <line x1={0} x2={W} y1={y(40)} y2={y(40)} stroke="#FAB219" strokeOpacity={0.35} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        <line x1={0} x2={W} y1={y(0)} y2={y(0)} stroke="rgba(237,233,228,0.12)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        {path && (
          <path d={path} fill="none" stroke="#B6AEA6" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        )}
        {hovered && (
          <line x1={hovered.x} x2={hovered.x} y1={0} y2={H} stroke="rgba(237,233,228,0.35)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        )}
      </svg>
      {/* Dots are HTML so they stay round while the SVG stretches. */}
      {flagged.map((p) => (
        <Dot key={p.e.ts} xPct={(p.x / W) * 100} yPx={p.y} color={LEVEL_COLOR[p.e.level]} />
      ))}
      {lastPt && lastPt.e.level === "ok" && <Dot xPct={(lastPt.x / W) * 100} yPx={lastPt.y} color="#EDE9E4" small />}
      <span aria-hidden className="pointer-events-none absolute -right-8 text-[10px] leading-none text-ink-3" style={{ top: y(75) - 5 }}>
        call
      </span>
      <span aria-hidden className="pointer-events-none absolute -right-8 text-[10px] leading-none text-ink-3" style={{ top: y(40) - 5 }}>
        text
      </span>
      {!pts.length && (
        <span className="absolute inset-0 flex items-center justify-center text-xs text-ink-3">No checks in the last 24 hours</span>
      )}
      {hovered && (
        <div
          className="pointer-events-none absolute bottom-full z-10 mb-1 -translate-x-1/2 whitespace-nowrap rounded border border-line-strong bg-overlay px-2 py-1 text-xs shadow-lg"
          style={{ left: `${Math.min(92, Math.max(8, (hovered.x / W) * 100))}%` }}
        >
          <span className="font-semibold text-ink num">{hovered.e.severity}</span>
          <span className="text-ink-3"> severity, {hovered.e.level === "ok" ? "OK" : `${hovered.e.level} alert`}, {dateTime(hovered.e.ts)}</span>
        </div>
      )}
    </div>
  );
}

function Dot({ xPct, yPx, color, small }: { xPct: number; yPx: number; color: string; small?: boolean }) {
  const size = small ? 6 : 8;
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute rounded-full"
      style={{
        left: `calc(${xPct}% - ${size / 2}px)`,
        top: yPx - size / 2,
        width: size,
        height: size,
        background: color,
        boxShadow: "0 0 0 2px #14110F",
      }}
    />
  );
}
