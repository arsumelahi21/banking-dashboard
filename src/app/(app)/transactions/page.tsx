import { List } from "lucide-react";
import type { Metadata } from "next";
import { PageHeader } from "@/components/shell/page-header";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";

export const metadata: Metadata = { title: "Transactions" };

export default function TransactionsPage() {
  return (
    <>
      <PageHeader title="Transactions" description="Search and review all account activity." />
      <Card>
        <EmptyState icon={List} title="No transactions yet" description="Account activity will appear here." />
      </Card>
    </>
  );
}
