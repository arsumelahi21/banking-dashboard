"use client";

import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { MonthlySpendChart } from "@/components/charts/monthly-spend-chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/cn";
import { formatDay, formatMonth } from "@/lib/format";
import { summarizeSpend, type SpendRow } from "@/lib/insights";
import { RANGES, type RangeKey } from "@/lib/metrics";
import { formatMoney } from "@/lib/money";
import { serializeTransactionFilters } from "@/lib/transaction-filters";

const ALL = "all";

/** Real spending never reads as 0%, however small its share. */
const percent = (ratio: number) => (ratio > 0 && ratio < 0.01 ? "<1%" : `${Math.round(ratio * 100)}%`);

type Props = {
  rows: SpendRow[];
  /** All months available, oldest first, ending with the current one. */
  months: string[];
};

function Stat({ label, value, hint }: { label: string; value: string; hint: React.ReactNode }) {
  return (
    <Card className="flex min-w-0 flex-col gap-1 p-5">
      <h2 className="text-sm text-fg-muted">{label}</h2>
      <p className="truncate text-2xl font-semibold tracking-tight text-fg">{value}</p>
      <p className="text-xs text-fg-muted">{hint}</p>
    </Card>
  );
}

/** Filters one dataset on the client, so every figure agrees and nothing reloads. */
export function InsightsDashboard({ rows, months }: Props) {
  const [rangeKey, setRangeKey] = useState<RangeKey>("6m");
  const [category, setCategory] = useState<string>(ALL);
  const range = RANGES.find((option) => option.key === rangeKey)!;

  const visibleMonths = months.slice(-range.months);
  const previousMonths = months.slice(-range.months * 2, -range.months);
  const selected = category === ALL ? undefined : category;
  const summary = summarizeSpend(rows, { months: visibleMonths, previousMonths, category: selected });

  const firstMonth = visibleMonths[0]!;
  const since = formatDay(firstMonth);
  const currentMonth = formatMonth(months.at(-1)!);
  const largest = summary.categories[0];
  const average = Math.round(summary.totalCents / visibleMonths.length);
  const selectedRank = selected ? summary.categories.find((item) => item.name === selected) : undefined;
  const title = selected ? `${selected} spending` : "Total spending";
  const ChangeIcon = (summary.changeRatio ?? 0) >= 0 ? ArrowUpRight : ArrowDownRight;

  const transactionsLink = (filters: { category?: string; q?: string }) =>
    `/transactions?${serializeTransactionFilters({ ...filters, direction: "out", status: "posted", from: `${firstMonth}-01`, page: 1 })}`;

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <div role="group" aria-label="Time range" className="inline-flex rounded-lg border border-border-strong bg-surface p-0.5">
          {RANGES.map((option) => (
            <button
              key={option.key}
              type="button"
              aria-pressed={option.key === rangeKey}
              aria-label={`${option.label}: last ${option.months} months`}
              onClick={() => setRangeKey(option.key)}
              className={cn(
                "cursor-pointer rounded-md px-3 py-1 text-sm transition-colors",
                option.key === rangeKey ? "bg-accent-soft font-medium text-accent-soft-fg" : "text-fg-muted hover:text-fg",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
        <Select
          aria-label="Category"
          value={category}
          onValueChange={setCategory}
          options={[{ value: ALL, label: "All categories" }, ...summary.categories.map((item) => ({ value: item.name, label: item.name }))]}
          className="w-52"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Stat
          label={title}
          value={formatMoney(summary.totalCents)}
          hint={
            summary.changeRatio !== null ? (
              <span className="flex flex-wrap items-center gap-1">
                <ChangeIcon className="size-3.5" aria-hidden />
                {percent(Math.abs(summary.changeRatio))} {summary.changeRatio >= 0 ? "more" : "less"} than the previous {range.months} months
              </span>
            ) : (
              `Since ${since}`
            )
          }
        />
        <Stat label="Monthly average" value={formatMoney(average)} hint={`Over ${range.months} months, including ${currentMonth} to date`} />
        {selectedRank ? (
          <Stat label="Share of all spending" value={percent(selectedRank.share)} hint={`${selected}, since ${since}`} />
        ) : (
          <Stat label="Largest category" value={largest?.name ?? "None"} hint={largest ? `${percent(largest.share)} of spending since ${since}` : "No spending in this period"} />
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="min-w-0 lg:col-span-3">
          <CardHeader>
            <CardTitle>{title} by month</CardTitle>
            <p className="text-xs text-fg-muted">{currentMonth} is month to date</p>
          </CardHeader>
          <CardContent>
            <MonthlySpendChart data={summary.months} title={title} />
          </CardContent>
        </Card>

        <Card className="min-w-0 lg:col-span-2">
          <CardHeader>
            <CardTitle>Top merchants</CardTitle>
          </CardHeader>
          <CardContent>
            {summary.merchants.length === 0 ? (
              <p className="text-sm text-fg-muted">No spending in this period.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {summary.merchants.map((merchant) => (
                  <li key={merchant.name} className="relative flex items-center justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
                    <Link
                      href={transactionsLink({ q: merchant.name })}
                      prefetch={false}
                      className="min-w-0 truncate rounded text-sm text-fg after:absolute after:inset-0 after:content-[''] hover:underline"
                    >
                      {merchant.name}
                    </Link>
                    <span className="text-sm text-fg tabular-nums">{formatMoney(merchant.cents)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Spending by category</CardTitle>
          <p className="text-xs text-fg-muted">Select a category to focus the page on it</p>
        </CardHeader>
        <CardContent>
          {summary.categories.length === 0 ? (
            <p className="text-sm text-fg-muted">No spending in this period.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {summary.categories.map((item) => {
                const isSelected = item.name === category;
                const widest = summary.categories[0]!.cents;
                return (
                  <li key={item.name}>
                    <button
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() => setCategory(isSelected ? ALL : item.name)}
                      className={cn(
                        "grid w-full cursor-pointer grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-surface-2 sm:grid-cols-[minmax(6rem,9rem)_1fr_auto]",
                        isSelected && "bg-surface-2",
                      )}
                    >
                      <span className={cn("truncate text-sm", isSelected ? "font-medium text-fg" : "text-fg-muted")}>{item.name}</span>
                      {/* On a phone the bar takes its own full-width row, so it stays readable. */}
                      <span aria-hidden data-testid="category-bar" className="order-last col-span-2 h-3 min-w-0 sm:order-none sm:col-span-1">
                        <span
                          className={cn("block h-full rounded-r bg-chart-in transition-opacity", selected && !isSelected && "opacity-40")}
                          style={{ width: `${Math.max((item.cents / widest) * 100, 0.5)}%` }}
                        />
                      </span>
                      <span className="text-right text-sm text-fg tabular-nums">
                        {formatMoney(item.cents)} <span className="text-xs text-fg-muted">{percent(item.share)}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {selected ? (
            <Link href={transactionsLink({ category: selected })} prefetch={false} className="mt-3 inline-block rounded text-xs text-fg-muted underline hover:text-fg">
              View {selected} transactions
            </Link>
          ) : null}
        </CardContent>
      </Card>
    </>
  );
}
