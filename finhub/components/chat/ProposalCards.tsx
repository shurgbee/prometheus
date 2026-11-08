"use client";

import { useState } from "react";
import clsx from "clsx";
import { Check, Pencil, Phone } from "lucide-react";
import type { TriggerProposal, TriggerSpec } from "@/lib/api";
import { signalSummary } from "@/lib/labels";
import { Ticker } from "@/components/ui";
import { useChat } from "./ChatContext";

interface Draft {
  include: boolean;
  spec: TriggerSpec;
  edited: boolean;
}

export function ProposalCards({ messageId, proposals, decided }: { messageId: string; proposals: TriggerProposal[]; decided: boolean }) {
  const { decide, streaming } = useChat();
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(proposals.map((p) => [p.proposal_id, { include: true, spec: p.spec, edited: false }])),
  );
  const [editing, setEditing] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);

  const chosen = proposals.filter((p) => drafts[p.proposal_id]?.include);

  function update(id: string, fn: (d: Draft) => Draft) {
    setDrafts((ds) => ({ ...ds, [id]: fn(ds[id]) }));
  }

  function submit(approveSelected: boolean) {
    const decisions = proposals.map((p) => {
      const d = drafts[p.proposal_id];
      const approve = approveSelected && d.include;
      return approve
        ? { proposal_id: p.proposal_id, action: d.edited ? "edit" as const : "approve" as const, ...(d.edited ? { spec: d.spec } : {}) }
        : { proposal_id: p.proposal_id, action: "reject" as const };
    });
    const n = decisions.filter((d) => d.action !== "reject").length;
    setSummary(n ? `You approved ${n} of ${proposals.length} suggested triggers.` : "You rejected the suggested triggers.");
    setEditing(null);
    decide(messageId, decisions);
  }

  if (decided) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-ink-3">
        <Check size={13} aria-hidden /> {summary ?? "You responded to the suggested triggers."}
      </p>
    );
  }

  return (
    <fieldset className="rounded-lg border border-line-strong bg-plane">
      <legend className="sr-only">Suggested triggers</legend>
      <div className="border-b border-line px-3.5 py-2.5">
        <p className="text-sm font-semibold text-ink">Suggested triggers</p>
        <p className="text-xs text-ink-3">Nothing is created until you approve.</p>
      </div>
      <ul className="divide-y divide-line">
        {proposals.map((p) => {
          const d = drafts[p.proposal_id];
          const id = `prop-${p.proposal_id}`;
          return (
            <li key={p.proposal_id} className={clsx("px-3.5 py-3", !d.include && "opacity-55")}>
              <div className="flex items-start gap-3">
                <input
                  id={id}
                  type="checkbox"
                  checked={d.include}
                  onChange={(e) => update(p.proposal_id, (x) => ({ ...x, include: e.target.checked }))}
                  className="mt-1 h-4 w-4 shrink-0 accent-[#7FA6F5]"
                />
                <div className="min-w-0 flex-1">
                  {editing === p.proposal_id ? (
                    <input
                      autoFocus
                      aria-label="Trigger name"
                      className="field py-1"
                      value={d.spec.name}
                      maxLength={80}
                      onChange={(e) => update(p.proposal_id, (x) => ({ ...x, edited: true, spec: { ...x.spec, name: e.target.value } }))}
                      onBlur={() => setEditing(null)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === "Escape") {
                          e.preventDefault();
                          setEditing(null);
                        }
                      }}
                    />
                  ) : (
                    <div className="flex items-start justify-between gap-2">
                      <label htmlFor={id} className="text-sm font-semibold text-ink">
                        {d.spec.name || "Untitled trigger"}
                      </label>
                      <button
                        type="button"
                        className="shrink-0 rounded p-1 text-ink-3 hover:bg-raised hover:text-ink"
                        onClick={() => setEditing(p.proposal_id)}
                        aria-label={`Rename ${d.spec.name}`}
                        title="Rename"
                      >
                        <Pencil size={12} aria-hidden />
                      </button>
                    </div>
                  )}
                  <p className="mt-0.5 text-xs text-ink-2">{d.spec.hypothesis}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    {d.spec.tickers.map((t) => (
                      <Ticker key={t}>{t}</Ticker>
                    ))}
                    {d.spec.signals.map((s, i) => (
                      <span key={i} className="rounded-pill bg-raised px-2 py-0.5 text-2xs text-ink-2">
                        {signalSummary(s)}
                      </span>
                    ))}
                  </div>
                  <label className="mt-2 inline-flex cursor-pointer items-center gap-2 text-xs text-ink-2">
                    <input
                      type="checkbox"
                      checked={d.spec.critical_capable}
                      disabled={!d.include}
                      onChange={(e) =>
                        update(p.proposal_id, (x) => ({ ...x, edited: true, spec: { ...x.spec, critical_capable: e.target.checked } }))
                      }
                      className="h-3.5 w-3.5 accent-[#7FA6F5]"
                    />
                    <Phone size={12} aria-hidden className="text-ink-3" />
                    Can call me for critical alerts
                  </label>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-3.5 py-2.5">
        <button type="button" className="btn-quiet" disabled={streaming} onClick={() => submit(false)}>
          Reject all
        </button>
        <button type="button" className="btn-primary" disabled={streaming || chosen.length === 0} onClick={() => submit(true)}>
          {chosen.length === proposals.length ? "Approve all" : `Approve ${chosen.length}`}
        </button>
      </div>
    </fieldset>
  );
}
