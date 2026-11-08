"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import { TopBar } from "./TopBar";
import { ChatPanel } from "./chat/ChatPanel";
import { DemoDrawer } from "./DemoDrawer";

export function AppShell({ children }: { children: React.ReactNode }) {
  const [chatOpen, setChatOpen] = useState(false);
  const [demoOpen, setDemoOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setChatOpen(false);
      setDemoOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="min-h-screen">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-50 focus:rounded focus:bg-raised focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <TopBar onOpenChat={() => setChatOpen(true)} onOpenDemo={() => setDemoOpen(true)} />

      <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_400px]">
        <main id="main" className="mx-auto w-full min-w-0 max-w-[1040px] px-5 pb-24 pt-8 sm:px-8">
          {children}
        </main>

        {/* One chat instance: a docked column on wide screens, a slide-over below that. */}
        <aside
          aria-label="Advisor chat"
          className={clsx(
            "fixed inset-y-0 right-0 z-40 w-full transition-[transform,visibility] duration-300 ease-out sm:w-[420px]",
            "xl:sticky xl:top-[57px] xl:z-0 xl:h-[calc(100vh-57px)] xl:w-auto xl:translate-x-0 xl:transition-none xl:visible",
            chatOpen ? "visible translate-x-0" : "invisible translate-x-full",
          )}
        >
          <ChatPanel onClose={() => setChatOpen(false)} />
        </aside>
      </div>

      {chatOpen && (
        <button
          aria-label="Close advisor chat"
          className="fixed inset-0 z-30 bg-black/50 xl:hidden"
          onClick={() => setChatOpen(false)}
        />
      )}

      <DemoDrawer open={demoOpen} onClose={() => setDemoOpen(false)} />
    </div>
  );
}
