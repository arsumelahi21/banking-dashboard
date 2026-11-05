import { CreditCard } from "lucide-react";
import type { Metadata } from "next";
import { PageHeader } from "@/components/shell/page-header";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";

export const metadata: Metadata = { title: "Cards" };

export default function CardsPage() {
  return (
    <>
      <PageHeader title="Cards" description="Manage company cards and spending limits." />
      <Card>
        <EmptyState icon={CreditCard} title="No cards yet" description="Your team's cards will appear here." />
      </Card>
    </>
  );
}
