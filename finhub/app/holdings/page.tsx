"use client";

import { useRef, useState } from "react";
import { Download, Pencil, Trash2, Upload } from "lucide-react";
import { api, type ImportResult, type ValuedHolding } from "@/lib/api";
import { refresh, usePortfolio } from "@/lib/hooks";
import { money, pct, quantity, shortDate } from "@/lib/format";
import { EmptyState, ErrorNote, SectionHeader, Skeleton } from "@/components/ui";
import { HoldingForm } from "@/components/holdings/HoldingForm";

const TEMPLATE = `asset_class,name,ticker,quantity,cost_basis,principal,apy,start_date,maturity_date
stock,Tesla,TSLA,40,8200,,,,
cash,High-yield savings,,,,32400,0.04,,
cd,12-month CD,,,,25000,0.046,2026-03-02,2027-03-02
`;

const GROUPS = [
  { key: "stock", label: "Stocks" },
  { key: "cash", label: "Cash" },
  { key: "cd", label: "CDs" },
] as const;

async function afterChange() {
  await Promise.all([refresh("portfolio"), refresh("history")]);
}

export default function HoldingsPage() {
  const { data, error, isLoading, mutate } = usePortfolio();

  return (
    <div className="space-y-8">
      <header className="mt-4 px-1">
        <h1 className="page-title">Holdings</h1>
      </header>

      <section aria-labelledby="list-title">
        <SectionHeader id="list-title" title="Your holdings" />
        {error && !data ? (
          <ErrorNote error={error} what="holdings" onRetry={() => mutate()} />
        ) : isLoading && !data ? (
          <Skeleton className="h-64 w-full" />
        ) : !data?.holdings.length ? (
          <EmptyState>No holdings yet.</EmptyState>
        ) : (
          <div className="space-y-8">
            {GROUPS.map((g) => {
              const rows = data.holdings.filter((h) => h.asset_class === g.key).sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
              if (!rows.length) return null;
              return (
                <div key={g.key}>
                  <h3 className="mb-2 text-sm font-semibold text-ink-2">{g.label}</h3>
                  <ul className="divide-y divide-line overflow-hidden rounded-lg border border-edge bg-surface [&>li]:px-4">
                    {rows.map((h) => (
                      <HoldingRow key={h.id} holding={h} />
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <section aria-labelledby="add-title">
          <SectionHeader id="add-title" title="Add a holding" />
          <div className="rounded-lg border border-edge bg-surface p-4">
            <HoldingForm
              submitLabel="Add holding"
              onSubmit={async (input) => {
                await api.createHolding(input);
                await afterChange();
              }}
            />
          </div>
        </section>
        <CsvImport />
      </div>
    </div>
  );
}

function describe(h: ValuedHolding): string {
  if (h.asset_class === "stock") return `${quantity(h.quantity)} shares${h.cost_basis != null ? `, ${money(h.cost_basis, { cents: true })} total cost` : ""}`;
  if (h.asset_class === "cd") return `${money(h.principal)} at ${pct(h.apy, 2)} APY, matures ${shortDate(h.maturity_date)}`;
  return h.apy ? `${pct(h.apy, 2)} APY` : "Balance";
}

function HoldingRow({ holding: h }: { holding: ValuedHolding }) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await api.deleteHolding(h.id);
      await afterChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't delete the holding.");
      setBusy(false);
      setConfirming(false);
    }
  }

  if (editing) {
    return (
      <li className="py-4">
        <p className="mb-3 text-sm font-semibold text-ink">Edit {h.name}</p>
        <HoldingForm
          initial={h}
          submitLabel="Save changes"
          onCancel={() => setEditing(false)}
          onSubmit={async (input) => {
            await api.updateHolding(h.id, input);
            await afterChange();
            setEditing(false);
          }}
        />
      </li>
    );
  }

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm text-ink">
          {h.ticker && <span className="mr-2 font-semibold">{h.ticker}</span>}
          {h.name}
        </p>
        <p className="text-xs text-ink-3 num">{describe(h)}</p>
      </div>
      <p className="w-28 text-right text-sm text-ink num">{money(h.value)}</p>
      <div className="flex items-center gap-1">
        {confirming ? (
          <>
            <span className="text-xs text-ink-2">Delete {h.name}?</span>
            <button className="btn-quiet text-down" onClick={remove} disabled={busy}>
              Delete
            </button>
            <button className="btn-quiet" onClick={() => setConfirming(false)}>
              Keep
            </button>
          </>
        ) : (
          <>
            <button className="btn-quiet" onClick={() => setEditing(true)} aria-label={`Edit ${h.name}`}>
              <Pencil size={14} aria-hidden /> Edit
            </button>
            <button className="btn-quiet" onClick={() => setConfirming(true)} aria-label={`Delete ${h.name}`}>
              <Trash2 size={14} aria-hidden />
            </button>
          </>
        )}
      </div>
      {error && (
        <p role="alert" className="w-full text-xs text-down">
          {error}
        </p>
      )}
    </li>
  );
}

function CsvImport() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function upload() {
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await api.importHoldings(file);
      setResult(res);
      await afterChange();
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't import the file.");
    } finally {
      setBusy(false);
    }
  }

  function downloadTemplate() {
    const url = URL.createObjectURL(new Blob([TEMPLATE], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "holdings-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section aria-labelledby="import-title">
      <SectionHeader id="import-title" title="Import a CSV" />
      <div className="space-y-3 rounded-lg border border-edge bg-surface p-4">
        <p className="text-sm text-ink-2">
          One row per holding. APY is a fraction (0.046 for 4.6%), dates are YYYY-MM-DD, and cost basis is the total stock position cost (shares × average purchase price).
        </p>
        <button type="button" className="btn-ghost" onClick={downloadTemplate}>
          <Download size={14} aria-hidden /> Download template
        </button>
        <div className="space-y-1">
          <label htmlFor="csv-file" className="label">
            CSV file
          </label>
          <input
            id="csv-file"
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setResult(null);
              setError(null);
            }}
            className="block w-full text-sm text-ink-2 file:mr-3 file:rounded-pill file:border file:border-line-strong file:bg-raised file:px-3 file:py-1.5 file:text-sm file:text-ink hover:file:bg-overlay"
          />
        </div>
        <button type="button" className="btn-primary" disabled={!file || busy} onClick={upload}>
          <Upload size={14} aria-hidden /> {busy ? "Importing" : "Import holdings"}
        </button>
        {error && (
          <p role="alert" className="text-sm text-down">
            {error}
          </p>
        )}
        {result && (
          <div className="text-sm" aria-live="polite">
            <p className="text-ink">
              Imported {result.imported} holding{result.imported === 1 ? "" : "s"}.
            </p>
            {result.errors.length > 0 && (
              <ul className="mt-1 space-y-0.5 text-xs text-ink-2">
                {result.errors.map((e) => (
                  <li key={e.row}>
                    Row {e.row}: {e.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
