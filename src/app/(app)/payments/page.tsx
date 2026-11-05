import { ArrowLeftRight } from "lucide-react";
import type { Metadata } from "next";
import { PageHeader } from "@/components/shell/page-header";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";

export const metadata: Metadata = { title: "Payments" };

export default function PaymentsPage() {
  return (
    <>
      <PageHeader title="Payments" description="Move money between accounts and pay recipients." />
      <Card>
        <EmptyState icon={ArrowLeftRight} title="No payments yet" description="Transfers and scheduled payments will appear here." />
      </Card>
    </>
  );
}
