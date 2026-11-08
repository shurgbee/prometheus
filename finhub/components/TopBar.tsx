"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import clsx from "clsx";
import { Zap } from "lucide-react";
import { USE_MOCKS } from "@/lib/api";
import { usePortfolio } from "@/lib/hooks";
import { clockLabel, isMarketOpen } from "@/lib/market";

const NAV = [
  { href: "/", label: "Overview" },
  { href: "/reports", label: "Reports" },
  { href: "/holdings", label: "Holdings" },
  { href: "/advisor", label: "Advisor" },
];

export function TopBar({ onOpenDemo }: { onOpenDemo: () => void }) {
  const pathname = usePathname();
  const { data: portfolio } = usePortfolio();
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(id);
  }, []);

  const open = portfolio?.market_open ?? (now ? isMarketOpen(now) : false);

  return (
    <header className="sticky top-0 z-30 bg-canvas/90 backdrop-blur md:h-[57px]">
      <div className="mx-auto flex max-w-[1480px] flex-wrap items-center gap-x-3 px-4 sm:px-5 md:h-14 md:flex-nowrap md:gap-6">
        <Link href="/" className="flex h-14 shrink-0 items-center font-dot text-xl font-black tracking-wide text-ink md:h-auto" aria-label="Prometheus home">
          prometheus
        </Link>

        <nav aria-label="Main" className="order-last -mx-1 flex w-full min-w-0 items-center gap-0.5 pb-2 md:order-none md:mx-0 md:w-auto md:shrink-0 md:gap-1 md:pb-0">
          {NAV.map((item) => {
            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={clsx(
                  "whitespace-nowrap rounded-pill px-2.5 py-1.5 text-sm transition-colors sm:px-3",
                  active ? "bg-accent-strong text-white" : "text-ink-2 hover:text-ink",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-2 md:gap-3">
          {(USE_MOCKS || portfolio?.demo) && (
            <span
              className="rounded-pill border border-line-strong px-2 py-0.5 text-2xs text-ink-3"
              title="Prices and delivery are simulated; no real phone messages are sent."
            >
              Demo data
            </span>
          )}
          {now && (
            <span className="hidden items-center gap-2 whitespace-nowrap text-xs text-ink-3 lg:flex">
              <span
                aria-hidden
                className={clsx("h-1.5 w-1.5 rounded-full", open ? "bg-up" : "bg-ink-3")}
              />
              {open ? "Market open" : "Market closed"}
            </span>
          )}
          <span className="hidden whitespace-nowrap border-l border-line-strong pl-3 font-dot text-sm font-black text-ink-2 lg:inline" suppressHydrationWarning>
            {now ? clockLabel(now) : " "}
          </span>
          {(USE_MOCKS || portfolio?.dev_injection_enabled) && <button onClick={onOpenDemo} className="btn-quiet" title="Send a test event through a trigger">
            <Zap size={15} aria-hidden />
            <span className="hidden xl:inline">Demo events</span>
          </button>}
        </div>
      </div>
    </header>
  );
}
