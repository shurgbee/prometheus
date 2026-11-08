"use client";

import Link from "next/link";
import { ArrowUpRight, Briefcase } from "lucide-react";
import type { ValuedHolding } from "@/lib/api";
import { usePortfolio } from "@/lib/hooks";
import { money, pct, quantity } from "@/lib/format";
import { Delta, ErrorNote, Skeleton, TileHeader } from "@/components/ui";

export function HoldingsTable() {
  const { data, error, isLoading, mutate } = usePortfolio();
  const stocks = (data?.holdings ?? []).filter((h) => h.asset_class === "stock").sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  const cash = (data?.holdings ?? []).filter((h) => h.asset_class === "cash").sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

  return (
    <section aria-labelledby="holdings-title" className="tile">
      <TileHeader
        id="holdings-title"
        title="Holdings"
        icon={Briefcase}
        action={
          <Link href="/holdings" className="btn-quiet">
            Edit holdings <ArrowUpRight size={14} aria-hidden />
          </Link>
        }
      />
      {error && !data ? (
        <ErrorNote error={error} what="holdings" onRetry={() => mutate()} />
      ) : isLoading && !data ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <div className="-mx-5 overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <caption className="sr-only">Stock and cash holdings</caption>
            <thead>
              <tr className="border-b border-line text-left text-xs text-ink-3">
                <th scope="col" className="px-5 py-2.5 font-normal">Name</th>
                <th scope="col" className="px-3 py-2.5 text-right font-normal">Shares</th>
                <th scope="col" className="px-3 py-2.5 text-right font-normal">Cost basis</th>
                <th scope="col" className="px-3 py-2.5 text-right font-normal">Price</th>
                <th scope="col" className="px-3 py-2.5 text-right font-normal">Value</th>
                <th scope="col" className="px-3 py-2.5 text-right font-normal">Today</th>
                <th scope="col" className="px-3 py-2.5 text-right font-normal">Gain</th>
                <th scope="col" className="px-5 py-2.5 text-right font-normal">Weight</th>
              </tr>
            </thead>
            <tbody className="num">
              <GroupRow label="Stocks" rows={stocks} />
              {stocks.map((h) => (
                <tr key={h.id} className="border-b border-line last:border-0 hover:bg-plane">
                  <th scope="row" className="px-5 py-2.5 text-left font-normal">
                    <span className="font-semibold text-ink">{h.ticker}</span>
                    <span className="ml-2 text-ink-3">{h.name}</span>
                  </th>
                  <td className="px-3 py-2.5 text-right text-ink-2">{quantity(h.quantity)}</td>
                  <td className="px-3 py-2.5 text-right text-ink-2">{money(h.cost_basis, { cents: true })}</td>
                  <td className="px-3 py-2.5 text-right text-ink-2">{money(h.price, { cents: true })}</td>
                  <td className="px-3 py-2.5 text-right text-ink">{money(h.value)}</td>
                  <td className="px-3 py-2.5 text-right">
                    <Delta fraction={h.day_change_pct} className="justify-end" />
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <Delta amount={h.gain} className="justify-end" />
                    <div className="text-2xs text-ink-3">{h.gain_pct != null ? pct(h.gain_pct, 1) : ""}</div>
                  </td>
                  <td className="px-5 py-2.5 text-right text-ink-2">{pct(h.weight, 1)}</td>
                </tr>
              ))}
              {cash.length > 0 && <GroupRow label="Cash" rows={cash} />}
              {cash.map((h) => (
                <tr key={h.id} className="border-b border-line last:border-0 hover:bg-plane">
                  <th scope="row" className="px-5 py-2.5 text-left font-normal text-ink">
                    {h.name}
                    {h.apy ? <span className="ml-2 text-ink-3">{pct(h.apy, 2)} APY</span> : null}
                  </th>
                  <td className="px-3 py-2.5" colSpan={3} />
                  <td className="px-3 py-2.5 text-right text-ink">{money(h.value)}</td>
                  <td className="px-3 py-2.5" colSpan={2} />
                  <td className="px-5 py-2.5 text-right text-ink-2">{pct(h.weight, 1)}</td>
                </tr>
              ))}
              {!stocks.length && !cash.length && (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-center text-ink-3">
                    No stocks or cash yet. <Link href="/holdings" className="text-accent hover:underline">Add holdings</Link>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function GroupRow({ label, rows }: { label: string; rows: ValuedHolding[] }) {
  if (!rows.length) return null;
  const total = rows.reduce((s, r) => s + (r.value ?? 0), 0);
  return (
    <tr className="border-b border-line">
      <th scope="rowgroup" colSpan={4} className="px-5 py-1.5 text-left text-xs font-medium text-ink-2">
        {label}
      </th>
      <td className="px-3 py-1.5 text-right text-xs text-ink-2">{money(rows.some((r) => r.value == null) ? null : total)}</td>
      <td colSpan={3} />
    </tr>
  );
}
