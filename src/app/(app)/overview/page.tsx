import { LayoutDashboard } from "lucide-react";
import type { Metadata } from "next";
import { PageHeader } from "@/components/shell/page-header";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";

export const metadata: Metadata = { title: "Overview" };

export default function OverviewPage() {
  return (
    <>
      <PageHeader title="Overview" description="Your cash position across every account." />
      <Card>
        <EmptyState icon={LayoutDashboard} title="No accounts yet" description="Balances and cash flow will appear here." />
      </Card>
    </>
  );
}
