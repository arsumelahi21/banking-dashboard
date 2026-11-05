import { ArrowLeftRight, LayoutDashboard } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { Money } from "@/components/ui/money";
import { formatDay } from "@/lib/format";
import { requireSession } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { getOverview, type Overview } from "@/server/queries/overview";
import { OverviewDashboard } from "./dashboard";

export const metadata: Metadata = { title: "Overview" };

const statusBadges = {
  pending: { label: "Pending", tone: "neutral" },
  failed: { label: "Failed", tone: "danger" },
  posted: null,
} as const;

function AccountsCard({ accounts, totalCents, availableCents }: Pick<Overview, "accounts" | "totalCents" | "availableCents">) {
  return (
    <Card className="flex flex-col">
      <CardHeader>
        <CardTitle>Accounts</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col">
        <ul className="flex flex-col divide-y divide-border">
          {accounts.map((account) => {
            const share = totalCents > 0 ? Math.round((account.balanceCents / totalCents) * 100) : 0;
            return (
              <li key={account.id} className="flex flex-col gap-2 py-4 first:pt-0">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-fg">{account.name}</p>
                    <p className="text-xs text-fg-muted">
                      <span className="capitalize">{account.kind}</span> ••{account.numberLast4}
                    </p>
                  </div>
                  <div className="text-right">
                    <Money cents={account.balanceCents} className="text-sm font-medium text-fg" />
                    {account.availableCents !== account.balanceCents ? (
                      <p className="text-xs text-fg-muted">
                        <Money cents={account.availableCents} /> available
                      </p>
                    ) : null}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div aria-hidden className="h-1 flex-1 overflow-hidden rounded-full bg-surface-2">
                    <div className="h-full rounded-full bg-chart-in" style={{ width: `${share}%` }} />
                  </div>
                  <p className="w-20 text-right text-xs text-fg-muted tabular-nums">{share}% of cash</p>
                </div>
              </li>
            );
          })}
        </ul>
        <div className="mt-auto flex items-baseline justify-between gap-4 border-t border-border pt-4">
          <p className="text-sm text-fg-muted">Available now</p>
          <Money cents={availableCents} className="text-sm font-medium text-fg" />
        </div>
      </CardContent>
    </Card>
  );
}

function ActivityCard({ recent }: Pick<Overview, "recent">) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent activity</CardTitle>
        <Link href="/transactions" className="rounded text-xs text-fg-muted hover:text-fg">
          View all
        </Link>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col divide-y divide-border">
          {recent.map((item) => {
            const badge = statusBadges[item.status];
            return (
              <li key={item.id} className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-fg">{item.counterparty}</p>
                  <p className="truncate text-xs text-fg-muted">{formatDay(item.occurredAt)}
                    {item.description !== item.counterparty ? ` · ${item.description}` : null}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Money cents={item.amountCents} signed={item.signed} className="text-sm text-fg" />
                  {badge ? <Badge tone={badge.tone}>{badge.label}</Badge> : null}
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

export default async function OverviewPage() {
  const session = await requireSession();
  const overview = await getOverview(getDb(), session.orgId);

  return (
    <>
      <PageHeader
        title="Overview"
        description={`${session.orgName}'s cash position across every account.`}
        actions={
          <Button asChild>
            <Link href="/payments">
              <ArrowLeftRight aria-hidden />
              Move money
            </Link>
          </Button>
        }
      />
      {overview.accounts.length === 0 ? (
        <Card>
          <EmptyState icon={LayoutDashboard} title="No accounts yet" description="Balances and cash flow will appear here." />
        </Card>
      ) : (
        <OverviewDashboard
          totalCents={overview.totalCents}
          availableCents={overview.availableCents}
          months={overview.months}
          daily={overview.daily}
          runway={overview.runway}
          accountsSlot={<AccountsCard accounts={overview.accounts} totalCents={overview.totalCents} availableCents={overview.availableCents} />}
          activitySlot={<ActivityCard recent={overview.recent} />}
        />
      )}
    </>
  );
}
