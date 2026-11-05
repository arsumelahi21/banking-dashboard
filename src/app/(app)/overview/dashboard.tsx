"use client";

import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { useState, type ReactNode } from "react";
import { CashBalanceChart } from "@/components/charts/cash-balance-chart";
import { CashFlowChart } from "@/components/charts/cash-flow-chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Money } from "@/components/ui/money";
import { cn } from "@/lib/cn";
import { formatDay, formatMonth } from "@/lib/format";
import { RANGES, viewRange, type DailyBalance, type MonthFlow, type RangeKey, type Runway } from "@/lib/metrics";
import { formatMoney } from "@/lib/money";

type DashboardProps = {
  totalCents: number;
  availableCents: number;
  months: MonthFlow[];
  daily: DailyBalance[];
  runway: Runway;
  accountsSlot: ReactNode;
  activitySlot: ReactNode;
};

function Stat({ label, value, hint }: { label: string; value: ReactNode; hint: ReactNode }) {
  return (
    <Card className="flex flex-col gap-1 p-5">
      <h2 className="text-sm text-fg-muted">{label}</h2>
      <p className="text-2xl font-semibold tracking-tight text-fg">{value}</p>
      <p className="text-xs text-fg-muted">{hint}</p>
    </Card>
  );
}

function runwayStat(runway: Runway) {
  switch (runway.kind) {
    case "burning":
      return {
        value: `${Math.floor(runway.months)} months`,
        hint: `At ${formatMoney(runway.averageBurnCents)} average monthly burn`,
      };
    case "positive":
      return {
        value: "Not burning",
        hint: `Cash-flow positive, averaging ${formatMoney(runway.averageNetCents, { signed: true })} a month`,
      };
    case "unknown":
      return { value: "Not enough data", hint: "Needs a full month of activity" };
  }
}

/**
 * The range applies to everything below it and is filtered here from one dataset,
 * so the charts and totals always agree and changing it never reloads the page.
 */
export function OverviewDashboard({ totalCents, availableCents, months, daily, runway, accountsSlot, activitySlot }: DashboardProps) {
  const [rangeKey, setRangeKey] = useState<RangeKey>("12m");
  const range = RANGES.find((option) => option.key === rangeKey)!;

  const view = viewRange(months, daily, range.months);
  const flows = view.flows;

  const change = totalCents - view.openingCents;
  const ChangeIcon = change > 0 ? ArrowUpRight : change < 0 ? ArrowDownRight : Minus;
  const pendingCents = totalCents - availableCents;
  const runwayDisplay = runwayStat(runway);
  const since = formatDay(view.firstMonth);
  const currentMonth = formatMonth(months.at(-1)!.month);

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
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="min-w-0 lg:col-span-2">
          <CardHeader className="items-start">
            <div className="flex flex-col gap-1">
              <CardTitle className="font-normal text-fg-muted">Total cash</CardTitle>
              <Money cents={totalCents} display className="text-4xl text-fg sm:text-5xl" />
              <p className="flex flex-wrap items-center gap-x-1 text-sm text-fg-muted">
                <ChangeIcon className="size-4" aria-hidden />
                <span className="text-fg">
                  {change === 0 ? "No change" : formatMoney(change, { signed: true })}
                </span>
                <span>since {since}</span>
                {pendingCents > 0 ? <span>· {formatMoney(pendingCents)} pending</span> : null}
              </p>
            </div>
          </CardHeader>
          <CardContent>
            <CashBalanceChart data={view.daily} />
          </CardContent>
        </Card>

        {accountsSlot}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Money in" value={formatMoney(flows.inCents)} hint={`Since ${since}`} />
        <Stat label="Money out" value={formatMoney(flows.outCents)} hint={`Since ${since}`} />
        <Stat label="Net cash flow" value={formatMoney(flows.netCents, { signed: true })} hint={`Since ${since}`} />
        <Stat label="Runway" value={runwayDisplay.value} hint={runwayDisplay.hint} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="min-w-0 lg:col-span-2">
          <CardHeader>
            <CardTitle>Cash flow by month</CardTitle>
            <p className="text-xs text-fg-muted">{currentMonth} is month to date</p>
          </CardHeader>
          <CardContent>
            <CashFlowChart data={view.months} />
          </CardContent>
        </Card>

        {activitySlot}
      </div>
    </>
  );
}
