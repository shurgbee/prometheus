import Link from "next/link";
import { MessageCircle } from "lucide-react";
import { Allocation, NetWorth } from "@/components/dashboard/NetWorth";
import { NetWorthHistory } from "@/components/dashboard/NetWorthHistory";
import { Signals } from "@/components/dashboard/Signals";
import { Watching } from "@/components/dashboard/Watching";
import { AlertFeed } from "@/components/dashboard/AlertFeed";
import { RecentReports } from "@/components/dashboard/RecentReports";
import { HoldingsTable } from "@/components/dashboard/HoldingsTable";
import { CdLadder } from "@/components/dashboard/CdLadder";

const WIDE = "col-span-12 min-w-0 md:col-span-8";
const NARROW = "col-span-12 min-w-0 md:col-span-4";
const HALF_WIDE = "col-span-12 min-w-0 md:col-span-7";
const HALF_NARROW = "col-span-12 min-w-0 md:col-span-5";

export default function OverviewPage() {
  return (
    <div className="pb-12">
      <h1 className="page-title mb-5 mt-4 px-1">Overview</h1>
      <div className="grid grid-cols-12 gap-3">
        <div className={HALF_WIDE}><NetWorth /></div>
        <div className={HALF_NARROW}><Allocation /></div>
        <div className={WIDE}><NetWorthHistory /></div>
        <div className={NARROW}><Signals /></div>
        <div className={HALF_WIDE}><Watching /></div>
        <div className={HALF_NARROW}><AlertFeed /></div>
        <div className="col-span-12 min-w-0"><HoldingsTable /></div>
        <div className={HALF_WIDE}><CdLadder /></div>
        <div className={HALF_NARROW}><RecentReports /></div>
      </div>
      <Link
        href="/advisor"
        className="btn-primary fixed bottom-5 right-5 z-20 h-12 px-5 text-base shadow-lg shadow-black/50 sm:bottom-6 sm:right-6"
      >
        <MessageCircle size={18} aria-hidden />
        Chat
      </Link>
    </div>
  );
}
