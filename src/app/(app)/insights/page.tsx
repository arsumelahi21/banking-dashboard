import { ChartNoAxesColumn } from "lucide-react";
import type { Metadata } from "next";
import { PageHeader } from "@/components/shell/page-header";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";

export const metadata: Metadata = { title: "Insights" };

export default function InsightsPage() {
  return (
    <>
      <PageHeader title="Insights" description="Understand where your money goes." />
      <Card>
        <EmptyState icon={ChartNoAxesColumn} title="Nothing to show yet" description="Spending breakdowns will appear here." />
      </Card>
    </>
  );
}
