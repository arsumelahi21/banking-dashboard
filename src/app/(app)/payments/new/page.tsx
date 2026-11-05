import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { dayKey } from "@/lib/metrics";
import { requireSession } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { getPaymentOptions } from "@/server/queries/payments";
import { PaymentFlow } from "./payment-flow";

export const metadata: Metadata = { title: "New payment" };

const DAY_MS = 24 * 60 * 60 * 1000;

function scheduleLimits() {
  const now = Date.now();
  return { minDate: dayKey(new Date(now + DAY_MS)), maxDate: dayKey(new Date(now + 365 * DAY_MS)) };
}

export default async function NewPaymentPage({ searchParams }: PageProps<"/payments/new">) {
  const session = await requireSession();
  const { recipient } = await searchParams;
  const { accounts, recipients } = await getPaymentOptions(getDb(), session.orgId);

  return (
    <>
      <Link href="/payments" className="flex w-fit items-center gap-1 rounded text-sm text-fg-muted hover:text-fg">
        <ArrowLeft className="size-4" aria-hidden />
        Payments
      </Link>
      <PageHeader title="New payment" description="Move money between your accounts or pay a recipient." />
      <PaymentFlow
        accounts={accounts}
        recipients={recipients}
        // Only preselects a recipient that really is in this organization's list.
        initialRecipientId={recipients.find((row) => row.id === recipient)?.id}
        {...scheduleLimits()}
      />
    </>
  );
}
