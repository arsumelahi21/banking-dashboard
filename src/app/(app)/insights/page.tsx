import { ChartNoAxesColumn } from "lucide-react";
import type { Metadata } from "next";
import { PageHeader } from "@/components/shell/page-header";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { monthKey, startOfMonth } from "@/lib/metrics";
import { requireSession } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { getSpendRows } from "@/server/queries/insights";
import { InsightsDashboard } from "./insights-dashboard";

export const metadata: Metadata = { title: "Insights" };

const MONTHS = 12;

function lastMonths(): string[] {
  const now = new Date();
  return Array.from({ length: MONTHS }, (_, index) => monthKey(startOfMonth(now, MONTHS - 1 - index)));
}

export default async function InsightsPage() {
  const session = await requireSession();
  const rows = await getSpendRows(getDb(), session.orgId);

  return (
    <>
      <PageHeader title="Insights" description="Understand where your money goes. Settled spending only." />
      {rows.length === 0 ? (
        <Card>
          <EmptyState icon={ChartNoAxesColumn} title="Nothing to show yet" description="Spending breakdowns will appear here." />
        </Card>
      ) : (
        <InsightsDashboard rows={rows} months={lastMonths()} />
      )}
    </>
  );
}
