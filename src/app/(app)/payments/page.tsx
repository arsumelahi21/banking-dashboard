import { ArrowLeftRight, CalendarClock, Plus, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { TransactionStatusBadge } from "@/components/transaction-status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { Money } from "@/components/ui/money";
import { formatDay, formatFullDay } from "@/lib/format";
import { methodLabels } from "@/lib/transaction-filters";
import { requireSession } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { processDuePayments } from "@/server/payments/service";
import { listRecipients, listScheduledPayments, type ScheduledPaymentRow } from "@/server/queries/payments";
import { listRecentPayments } from "@/server/queries/transactions";
import { AddRecipient, ScheduledActions } from "./client-parts";

export const metadata: Metadata = { title: "Payments" };

const scheduledStatus = {
  completed: { label: "Sent", tone: "positive" },
  failed: { label: "Failed", tone: "danger" },
  canceled: { label: "Canceled", tone: "neutral" },
} as const;

function ScheduledRow({ payment }: { payment: ScheduledPaymentRow }) {
  const isUpcoming = payment.status === "scheduled";
  const badge = payment.status === "scheduled" ? null : scheduledStatus[payment.status];

  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0 flex-1 basis-48">
        <p className="truncate text-sm font-medium text-fg">{payment.toName}</p>
        <p className="truncate text-xs text-fg-muted">
          {formatFullDay(payment.scheduledFor)} · from {payment.fromName}
          {payment.memo ? ` · ${payment.memo}` : null}
        </p>
        {payment.failureReason ? <p className="text-xs text-danger">{payment.failureReason}</p> : null}
      </div>
      <div className="flex items-center gap-3">
        <Money cents={payment.amountCents} className="text-sm text-fg" />
        {badge ? <Badge tone={badge.tone}>{badge.label}</Badge> : null}
        {isUpcoming ? <ScheduledActions id={payment.id} toName={payment.toName} amountCents={payment.amountCents} /> : null}
      </div>
    </li>
  );
}

export default async function PaymentsPage() {
  const session = await requireSession();
  const db = getDb();
  // A failure here must never stop someone from seeing their payments.
  await processDuePayments(db, session.orgId).catch((error) => console.error("Processing due payments failed", error));

  const [scheduled, recipients, recent] = await Promise.all([
    listScheduledPayments(db, session.orgId),
    listRecipients(db, session.orgId),
    listRecentPayments(db, session.orgId),
  ]);

  return (
    <>
      <PageHeader
        title="Payments"
        description="Move money, pay recipients and manage what's scheduled."
        actions={
          <Button asChild>
            <Link href="/payments/new">
              <Plus aria-hidden />
              New payment
            </Link>
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Scheduled</CardTitle>
            </CardHeader>
            <CardContent>
              {scheduled.length === 0 ? (
                <EmptyState icon={CalendarClock} title="Nothing scheduled" description="Payments you set up for later will appear here." />
              ) : (
                <ul className="flex flex-col divide-y divide-border">
                  {scheduled.map((payment) => (
                    <ScheduledRow key={payment.id} payment={payment} />
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recent payments</CardTitle>
              <Link href="/transactions" className="rounded text-xs text-fg-muted hover:text-fg">
                View all
              </Link>
            </CardHeader>
            <CardContent>
              {recent.length === 0 ? (
                <EmptyState icon={ArrowLeftRight} title="No payments yet" description="Transfers and payments will appear here." />
              ) : (
                <ul className="flex flex-col divide-y divide-border">
                  {recent.map((item) => (
                    <li key={item.id} className="relative flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
                      <div className="min-w-0">
                        <Link
                          href={`/transactions?tx=${item.id}`}
                          prefetch={false}
                          className="block truncate rounded text-sm font-medium text-fg after:absolute after:inset-0 after:content-[''] hover:underline"
                        >
                          {item.counterparty}
                        </Link>
                        <p className="truncate text-xs text-fg-muted">
                          {formatDay(item.occurredAt)} · {methodLabels[item.method]}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <Money cents={item.amountCents} signed={item.signed} className="text-sm text-fg" />
                        <TransactionStatusBadge status={item.status} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Recipients</CardTitle>
            <AddRecipient />
          </CardHeader>
          <CardContent>
            {recipients.length === 0 ? (
              <EmptyState icon={Users} title="No recipients yet" description="Add someone you pay regularly." />
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {recipients.map((recipient) => (
                  <li key={recipient.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-fg">{recipient.name}</p>
                      <p className="truncate text-xs text-fg-muted">
                        {recipient.bankName} ••{recipient.numberLast4}
                      </p>
                    </div>
                    <Button asChild variant="ghost" size="sm">
                      <Link href={`/payments/new?recipient=${recipient.id}`} aria-label={`Pay ${recipient.name}`}>
                        Pay
                      </Link>
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
