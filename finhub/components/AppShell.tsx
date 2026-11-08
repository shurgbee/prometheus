"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { TopBar } from "./TopBar";
import { DemoDrawer } from "./DemoDrawer";

export function AppShell({ children }: { children: React.ReactNode }) {
  const [demoOpen, setDemoOpen] = useState(false);
  // The advisor fills the viewport and scrolls inside its thread; every other page scrolls normally.
  const fullHeight = usePathname().startsWith("/advisor");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDemoOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className={clsx("bg-canvas", fullHeight ? "flex h-dvh flex-col" : "min-h-screen")}>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-50 focus:rounded focus:bg-raised focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <TopBar onOpenDemo={() => setDemoOpen(true)} />

      <main
        id="main"
        className={clsx(
          "mx-auto w-full min-w-0 max-w-[1480px] px-3 pt-2 sm:px-4",
          fullHeight ? "min-h-0 flex-1 pb-3" : "pb-12",
        )}
      >
        {children}
      </main>

      <DemoDrawer open={demoOpen} onClose={() => setDemoOpen(false)} />
    </div>
  );
}
