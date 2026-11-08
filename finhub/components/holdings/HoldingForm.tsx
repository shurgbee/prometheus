"use client";

import { useState } from "react";
import type { AssetClass, Holding, HoldingInput } from "@/lib/api";
import { Segmented } from "@/components/ui";

const CLASS_OPTIONS: { value: AssetClass; label: string }[] = [
  { value: "stock", label: "Stock" },
  { value: "cash", label: "Cash" },
  { value: "cd", label: "CD" },
];

type Fields = {
  asset_class: AssetClass;
  name: string;
  ticker: string;
  quantity: string;
  cost_basis: string;
  principal: string;
  apyPct: string;
  start_date: string;
  maturity_date: string;
};

function toFields(h?: Holding): Fields {
  return {
    asset_class: h?.asset_class ?? "stock",
    name: h?.name ?? "",
    ticker: h?.ticker ?? "",
    quantity: h?.quantity != null ? String(h.quantity) : "",
    cost_basis: h?.cost_basis != null ? String(h.cost_basis) : "",
    principal: h?.principal != null ? String(h.principal) : "",
    apyPct: h?.apy != null ? String(Math.round(h.apy * 10000) / 100) : "",
    start_date: h?.start_date ?? "",
    maturity_date: h?.maturity_date ?? "",
  };
}

function parse(f: Fields): { input?: HoldingInput; error?: string } {
  // Accept "32,400", "$205.00" or " 4.6 ".
  const n = (v: string) => {
    const clean = v.replace(/[,$%\s]/g, "");
    return clean === "" ? null : Number(clean);
  };
  const name = f.name.trim();
  if (!name) return { error: "Give the holding a name." };
  const apy = n(f.apyPct);
  if (apy != null && (Number.isNaN(apy) || apy < 0 || apy > 100)) return { error: "APY must be a percentage between 0 and 100." };
  const base: HoldingInput = {
    asset_class: f.asset_class,
    name,
    ticker: null,
    quantity: null,
    cost_basis: null,
    principal: null,
    apy: null,
    start_date: null,
    maturity_date: null,
  };
  if (f.asset_class === "stock") {
    const ticker = f.ticker.trim().toUpperCase();
    const qty = n(f.quantity);
    const cost = n(f.cost_basis);
    if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(ticker)) return { error: "Enter a ticker like TSLA." };
    if (qty == null || Number.isNaN(qty) || qty <= 0) return { error: "Shares must be a number above 0." };
    if (cost == null || !Number.isFinite(cost) || cost < 0) return { error: "Enter the total cost of this stock position." };
    return { input: { ...base, ticker, quantity: qty, cost_basis: cost } };
  }
  const principal = n(f.principal);
  if (principal == null || Number.isNaN(principal) || principal < 0)
    return { error: f.asset_class === "cash" ? "Enter the balance." : "Enter the amount deposited." };
  if (f.asset_class === "cash") return { input: { ...base, principal, apy: apy != null ? apy / 100 : null } };
  if (apy == null) return { error: "Enter the CD's APY." };
  if (!f.start_date || !f.maturity_date) return { error: "Enter the start and maturity dates." };
  if (f.maturity_date <= f.start_date) return { error: "Maturity must be after the start date." };
  return { input: { ...base, principal, apy: apy / 100, start_date: f.start_date, maturity_date: f.maturity_date } };
}

export function HoldingForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: Holding;
  submitLabel: string;
  onSubmit: (input: HoldingInput) => Promise<void>;
  onCancel?: () => void;
}) {
  const [f, setF] = useState<Fields>(() => toFields(initial));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<Fields>) => setF((x) => ({ ...x, ...patch }));
  const uid = initial?.id ?? "new";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const { input, error: err } = parse(f);
    if (err || !input) return setError(err ?? "Check the fields.");
    setBusy(true);
    setError(null);
    try {
      await onSubmit(input);
      if (!initial) setF(toFields());
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : "Couldn't save the holding.");
    } finally {
      setBusy(false);
    }
  }

  const field = (key: keyof Fields, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div className="space-y-1">
      <label htmlFor={`${uid}-${key}`} className="label">
        {label}
      </label>
      <input
        id={`${uid}-${key}`}
        className="field"
        value={f[key]}
        onChange={(e) => set({ [key]: e.target.value } as Partial<Fields>)}
        {...props}
      />
    </div>
  );

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {!initial && (
        <Segmented label="Holding type" options={CLASS_OPTIONS} value={f.asset_class} onChange={(v) => set({ asset_class: v })} />
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {field("name", "Name", {
          placeholder: f.asset_class === "stock" ? "Tesla" : f.asset_class === "cash" ? "High-yield savings" : "12-month CD",
        })}
        {f.asset_class === "stock" && (
          <>
            {field("ticker", "Ticker", { placeholder: "TSLA", autoCapitalize: "characters" })}
            {field("quantity", "Shares", { inputMode: "decimal", placeholder: "40" })}
            {field("cost_basis", "Total position cost ($)", { inputMode: "decimal", placeholder: "8200.00" })}
          </>
        )}
        {f.asset_class === "cash" && (
          <>
            {field("principal", "Balance ($)", { inputMode: "decimal", placeholder: "32,400" })}
            {field("apyPct", "APY (%, optional)", { inputMode: "decimal", placeholder: "4.0" })}
          </>
        )}
        {f.asset_class === "cd" && (
          <>
            {field("principal", "Amount deposited ($)", { inputMode: "decimal", placeholder: "25,000" })}
            {field("apyPct", "APY (%)", { inputMode: "decimal", placeholder: "4.6" })}
            {field("start_date", "Start date", { type: "date" })}
            {field("maturity_date", "Maturity date", { type: "date" })}
          </>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-down">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? "Saving" : submitLabel}
        </button>
        {onCancel && (
          <button type="button" className="btn-quiet" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
