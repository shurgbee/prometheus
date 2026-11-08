"use client";

import { Activity } from "lucide-react";
import { useAlerts, useTriggers } from "@/lib/hooks";
import { ErrorNote, Skeleton, Strip, TileHeader } from "@/components/ui";

function Stat({ value, label, swatch, align }: { value: number; label: string; swatch?: string; align?: "right" }) {
  return (
    <div className={align === "right" ? "text-right" : undefined}>
      <p className="text-sm font-semibold text-ink num">{value}</p>
      <p className={`flex items-center gap-1.5 text-xs text-ink-3 ${align === "right" ? "justify-end" : ""}`}>
        {swatch && <span aria-hidden className={`h-2 w-2 rounded-[2px] ${swatch}`} />}
        {label}
      </p>
    </div>
  );
}

export function Signals() {
  const alerts = useAlerts("open");
  const triggers = useTriggers();
  const open = alerts.data ?? [];
  const critical = open.filter((a) => a.level === "critical").length;
  const normal = open.length - critical;
  const watching = (triggers.data ?? []).filter((t) => t.status !== "paused").length;
  const paused = (triggers.data ?? []).length - watching;
  const failed = (alerts.error && !alerts.data) || (triggers.error && !triggers.data);
  const loading = !alerts.data || !triggers.data;

  return (
    <section aria-labelledby="signals-title" className="tile flex h-full flex-col">
      <TileHeader id="signals-title" title="Signals" icon={Activity} />
      {failed ? (
        <ErrorNote
          error={alerts.error ?? triggers.error}
          what="signals"
          onRetry={() => {
            alerts.mutate();
            triggers.mutate();
          }}
        />
      ) : loading ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <div className="flex flex-1 flex-col justify-between gap-4">
          <div className="text-center">
            <p className="text-[52px] font-medium leading-none tracking-[-0.02em] text-ink num">{open.length}</p>
            <p className="mt-1 text-xs text-ink-3">Open alert{open.length === 1 ? "" : "s"}</p>
          </div>
          <div className="space-y-3">
            <div className="flex justify-between gap-4">
              <Stat value={critical} label="Critical" swatch="bg-brand" />
              <Stat value={normal} label="Normal" swatch="bg-ink" align="right" />
            </div>
            <Strip
              label={`${critical} critical and ${normal} normal open alerts`}
              segments={[
                { value: critical, className: "bg-brand" },
                { value: normal, className: "bg-ink" },
              ]}
            />
            <div className="flex justify-between gap-4 border-t border-line pt-3">
              <Stat value={watching} label="Watching" />
              <Stat value={paused} label="Paused" align="right" />
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
