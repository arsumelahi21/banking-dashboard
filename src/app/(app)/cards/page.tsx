import { CreditCard, Snowflake } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { cn } from "@/lib/cn";
import { formatMoney } from "@/lib/money";
import { requireSession } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { listCards, type CardRow } from "@/server/queries/cards";
import { CardControls } from "./card-controls";

export const metadata: Metadata = { title: "Cards" };

function usageTone(percent: number) {
  if (percent >= 100) return { bar: "bg-danger", label: "At limit" };
  if (percent >= 80) return { bar: "bg-warning", label: "Near limit" };
  return { bar: "bg-chart-in", label: null };
}

function CardPanel({ card }: { card: CardRow }) {
  const frozen = card.status === "frozen";
  const percent = Math.round((card.spentCents / card.monthlyLimitCents) * 100);
  const tone = usageTone(percent);
  const remaining = Math.max(0, card.monthlyLimitCents - card.spentCents);

  return (
    <Card className="flex flex-col gap-5 p-5">
      <div
        className={cn(
          "flex h-36 flex-col justify-between rounded-lg p-4",
          frozen ? "border border-dashed border-border-strong bg-surface-2 text-fg-muted" : "bg-accent text-accent-fg",
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <h2 className="font-display text-2xl leading-none">{card.label}</h2>
          {frozen ? (
            <span className="flex items-center gap-1 text-xs font-medium text-fg">
              <Snowflake className="size-3.5" aria-hidden />
              Frozen
            </span>
          ) : null}
        </div>
        <div className="flex items-end justify-between gap-2 text-sm">
          <span className="truncate">{card.holderName}</span>
          <span className="font-mono tabular-nums">•• {card.numberLast4}</span>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-sm text-fg-muted">Spent this month</p>
          <p className="text-sm text-fg tabular-nums">
            <span className="font-medium">{formatMoney(card.spentCents)}</span>
            <span className="text-fg-muted"> of {formatMoney(card.monthlyLimitCents)}</span>
          </p>
        </div>
        <div
          role="progressbar"
          aria-label={`${card.label} card monthly limit used`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.min(percent, 100)}
          className="h-1.5 overflow-hidden rounded-full bg-surface-2"
        >
          <div className={cn("h-full rounded-full", tone.bar)} style={{ width: `${Math.min(percent, 100)}%` }} />
        </div>
        <div className="flex items-center justify-between gap-3 text-xs text-fg-muted">
          <span className="tabular-nums">{formatMoney(remaining)} left</span>
          {tone.label ? <Badge tone={percent >= 100 ? "danger" : "warning"}>{tone.label}</Badge> : null}
          <Link href={`/transactions?card=${card.id}`} aria-label={`View transactions for ${card.label} card`} className="rounded underline-offset-2 hover:text-fg hover:underline">
            View transactions
          </Link>
        </div>
      </div>

      <CardControls card={{ id: card.id, label: card.label, status: card.status, monthlyLimitCents: card.monthlyLimitCents }} />
    </Card>
  );
}

export default async function CardsPage() {
  const session = await requireSession();
  const cards = await listCards(getDb(), session.orgId);
  const totalSpent = cards.reduce((sum, card) => sum + card.spentCents, 0);
  const frozenCount = cards.filter((card) => card.status === "frozen").length;

  return (
    <>
      <PageHeader title="Cards" description="Manage company cards and monthly spending limits." />

      {cards.length === 0 ? (
        <Card>
          <EmptyState icon={CreditCard} title="No cards yet" description="Your team's cards will appear here." />
        </Card>
      ) : (
        <>
          <p role="status" className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-fg-muted">
            <span>
              <span className="font-medium text-fg tabular-nums">{formatMoney(totalSpent)}</span> spent this month
            </span>
            <span>
              {cards.length} cards{frozenCount > 0 ? `, ${frozenCount} frozen` : ""}
            </span>
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            {cards.map((card) => (
              <CardPanel key={card.id} card={card} />
            ))}
          </div>
          <p className="text-xs text-fg-subtle">Only the last four digits are ever stored. Full card numbers never enter this system.</p>
        </>
      )}
    </>
  );
}
