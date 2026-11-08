"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { X } from "lucide-react";
import { api, type InjectSignalRequest, type InjectSignalResponse, type SignalSource } from "@/lib/api";
import { refresh, usePortfolio, useTriggers } from "@/lib/hooks";
import { LevelBadge } from "./ui";

type Preset = { id: string; label: string; source: SignalSource; title: string; url: string; priceChange: string; magnitude: string; urgency: number };

// The two events from the spec's demo script.
const PRESETS: Preset[] = [
  {
    id: "normal",
    label: "Minor recall (normal)",
    source: "nhtsa",
    title: "DEMO: synthetic minor seat-belt chime recall; not a real event",
    url: "https://www.nhtsa.gov/recalls",
    priceChange: "",
    magnitude: "0.45", urgency: .2,
  },
  {
    id: "critical",
    label: "SEC action and 8% drop (critical)",
    source: "sec_edgar",
    title: "DEMO: synthetic SEC investigation and TSLA decline; not a real event",
    url: "https://www.sec.gov/edgar/search/",
    priceChange: "-8",
    magnitude: "0.9", urgency: 1,
  },
];

const SOURCES: SignalSource[] = ["news", "price", "sec_edgar", "nhtsa"];

export function DemoDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: allTriggers } = useTriggers();
  const triggers = useMemo(() => allTriggers?.filter((t) => t.status === "active"), [allTriggers]);
  const { data: portfolio } = usePortfolio();
  const [usedTriggers, setUsedTriggers] = useState<string[]>([]);
  const [triggerId, setTriggerId] = useState("");
  const [picked, setPicked] = useState(false);
  const [form, setForm] = useState<Preset>(PRESETS[0]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<InjectSignalResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) closeBtn.current?.focus();
  }, [open]);

  // Until the presenter picks one, default to a trigger that can call (Tesla first), else the first trigger.
  useEffect(() => {
    if (!triggers?.length) return;
    const stillThere = triggers.some((t) => t.id === triggerId);
    if (picked && stillThere) return;
    const eligible = triggers.filter((t) => !usedTriggers.includes(t.id));
    const choices = eligible.length ? eligible : triggers;
    const best =
      choices.find((t) => t.status === "active" && t.critical_capable && t.tickers.includes("TSLA")) ??
      choices.find((t) => t.status === "active" && t.critical_capable) ??
      choices[0];
    if (best.id !== triggerId) setTriggerId(best.id);
    if (!stillThere) setPicked(false);
  }, [triggers, triggerId, picked, usedTriggers]);

  async function send() {
    setBusy(true);
    setError(null);
    setResult(null);
    const move = form.priceChange.trim() === "" ? null : Number(form.priceChange) / 100;
    const magnitude = form.magnitude.trim() === "" ? null : Number(form.magnitude);
    if ((move != null && Number.isNaN(move)) || (magnitude != null && (Number.isNaN(magnitude) || magnitude < 0 || magnitude > 1))) {
      setError("Price move must be a number, and magnitude a number from 0 to 1.");
      setBusy(false);
      return;
    }
    const req: InjectSignalRequest = {
      trigger_id: triggerId,
      source: form.source,
      title: form.title.trim(),
      url: form.url.trim(),
      urgency: form.urgency,
      price_change_pct: move,
      magnitude,
    };
    try {
      const res = await api.injectSignal(req);
      setResult(res);
      if (res.alert) setUsedTriggers((ids) => [...ids, triggerId]);
      await Promise.all([refresh("alerts"), refresh("triggers"), refresh("evaluations")]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't send the event.");
    } finally {
      setBusy(false);
    }
  }

  const set = (patch: Partial<Preset>) => setForm((f) => ({ ...f, ...patch }));

  return (
    <>
      {open && <button aria-label="Close demo events" className="fixed inset-0 z-40 bg-black/50" onClick={onClose} />}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="demo-title"
        className={clsx(
          "fixed inset-y-0 left-0 z-50 flex w-full flex-col border-r border-line bg-surface transition-[transform,visibility] duration-300 sm:w-[420px]",
          open ? "visible translate-x-0" : "invisible -translate-x-full",
        )}
      >
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-line px-5">
          <h2 id="demo-title" className="font-display font-semibold text-xl text-ink">
            Demo events
          </h2>
          <button ref={closeBtn} className="btn-quiet" onClick={onClose} aria-label="Close demo events">
            <X size={16} aria-hidden />
          </button>
        </div>
        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
          <p className="text-sm text-ink-2">
            {portfolio?.demo ? "Synthetic events exercise scoring and the alert feed. Demo mode sends no texts or calls." : "Synthetic events can send real texts or calls through the configured notifier."}
            {" "}Use a different watch for each event; cooldowns suppress repeats.
          </p>

          {!triggers?.length ? (
            <p className="rounded border border-dashed border-line-strong px-3 py-3 text-sm text-ink-2">
              There are no triggers yet. Approve some in the advisor chat first.
            </p>
          ) : (
            <>
              <div className="space-y-1.5">
                <label htmlFor="demo-trigger" className="label">
                  Trigger
                </label>
                <select id="demo-trigger" className="field" value={triggerId} onChange={(e) => {
                    setTriggerId(e.target.value);
                    setPicked(true);
                  }}>
                  {triggers.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                      {t.critical_capable ? "" : " (can't call)"}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <p className="label">Preset</p>
                <div className="flex flex-wrap gap-2">
                  {PRESETS.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => { setForm(p); setPicked(false); }}
                      className={clsx(
                        "rounded-pill border px-3 py-1.5 text-xs transition-colors",
                        form.id === p.id ? "border-accent text-ink" : "border-line-strong text-ink-2 hover:text-ink",
                      )}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="demo-title-input" className="label">
                  Headline
                </label>
                <textarea
                  id="demo-title-input"
                  className="field min-h-[64px] resize-y"
                  maxLength={700}
                  value={form.title}
                  onChange={(e) => set({ title: e.target.value, id: "custom" })}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label htmlFor="demo-source" className="label">
                    Source
                  </label>
                  <select id="demo-source" className="field" value={form.source} onChange={(e) => set({ source: e.target.value, id: "custom" })}>
                    {SOURCES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="demo-move" className="label">
                    Price move (%)
                  </label>
                  <input
                    id="demo-move"
                    inputMode="decimal"
                    className="field"
                    placeholder="e.g. -8"
                    value={form.priceChange}
                    onChange={(e) => set({ priceChange: e.target.value, id: "custom" })}
                  />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="demo-mag" className="label">
                    Magnitude (0 to 1)
                  </label>
                  <input
                    id="demo-mag"
                    inputMode="decimal"
                    className="field"
                    placeholder="optional"
                    value={form.magnitude}
                    onChange={(e) => set({ magnitude: e.target.value, id: "custom" })}
                  />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="demo-url" className="label">
                    Evidence link
                  </label>
                  <input id="demo-url" className="field" placeholder="https://" value={form.url} onChange={(e) => set({ url: e.target.value, id: "custom" })} />
                </div>
              </div>

              <button className="btn-primary w-full py-2" onClick={send} disabled={busy || !triggerId || !form.title.trim() || !/^https?:\/\//.test(form.url)}>
                {busy ? "Sending event" : "Send event"}
              </button>
            </>
          )}

          {error && (
            <p role="alert" className="rounded border border-dashed border-down/50 px-3 py-2 text-sm text-ink-2">
              {error}
            </p>
          )}

          {result && (
            <div className="space-y-2 rounded border border-line bg-plane/50 px-3 py-3" aria-live="polite">
              <div className="flex items-center justify-between">
                <LevelBadge level={result.evaluation.level} />
                <span className="text-sm text-ink num">Severity {result.evaluation.severity}</span>
              </div>
              <p className="text-sm text-ink-2">
                {result.alert
                  ? (portfolio?.demo || result.alert.demo)
                    ? "Demo alert created. No text or call will be sent."
                    : "Alert queued for the notifier. Check the alert feed for delivery status."
                  : result.suppressed_reason === "cooldown"
                    ? "The trigger's cooldown suppressed this alert. Choose a different watch for the next event."
                    : "No alert was created: the score was below 40 or delivery was suppressed."}
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
