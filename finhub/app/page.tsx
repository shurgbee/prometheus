import { NetWorth } from "@/components/dashboard/NetWorth";
import { NetWorthHistory } from "@/components/dashboard/NetWorthHistory";
import { Watching } from "@/components/dashboard/Watching";
import { AlertFeed } from "@/components/dashboard/AlertFeed";
import { RecentReports } from "@/components/dashboard/RecentReports";
import { HoldingsTable } from "@/components/dashboard/HoldingsTable";
import { CdLadder } from "@/components/dashboard/CdLadder";

export default function OverviewPage() {
  return (
    <div className="space-y-14">
      <NetWorth />
      <NetWorthHistory />
      <Watching />
      <div className="grid gap-14 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <AlertFeed />
        <RecentReports />
      </div>
      <HoldingsTable />
      <CdLadder />
    </div>
  );
}
