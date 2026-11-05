import type { Cents } from "@/lib/money";

/** Money coming in and going out of the business in one month. Excludes internal transfers. */
export type MonthFlow = { month: string; inCents: Cents; outCents: Cents };
export type DailyBalance = { date: string; balanceCents: Cents };

export const RANGES = [
  { key: "3m", label: "3M", months: 3 },
  { key: "6m", label: "6M", months: 6 },
  { key: "12m", label: "12M", months: 12 },
] as const;
export type RangeKey = (typeof RANGES)[number]["key"];

const DAY_MS = 24 * 60 * 60 * 1000;
export const monthKey = (date: Date) => date.toISOString().slice(0, 7);
export const dayKey = (date: Date) => date.toISOString().slice(0, 10);

/** The first day of the month `monthsBack` months before `date`, in UTC. */
export function startOfMonth(date: Date, monthsBack = 0): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - monthsBack, 1));
}

/** One row per month, oldest first, ending with the current month. Quiet months become zero. */
export function fillMonths(rows: readonly MonthFlow[], now: Date, count: number): MonthFlow[] {
  const byMonth = new Map(rows.map((row) => [row.month, row]));
  return Array.from({ length: count }, (_, index) => {
    const month = monthKey(startOfMonth(now, count - 1 - index));
    return byMonth.get(month) ?? { month, inCents: 0, outCents: 0 };
  });
}

/**
 * Turns all-time daily net changes into an end-of-day balance for each day from
 * `start` to `end`. Activity before `start` still counts toward the opening balance.
 */
export function buildDailyBalances(
  rows: readonly { date: string; netCents: Cents }[],
  start: Date,
  end: Date,
): DailyBalance[] {
  const startKey = dayKey(start);
  let balance = 0;
  const netByDay = new Map<string, Cents>();
  for (const { date, netCents } of rows) {
    if (date < startKey) balance += netCents;
    else netByDay.set(date, (netByDay.get(date) ?? 0) + netCents);
  }

  const days: DailyBalance[] = [];
  const endKey = dayKey(end);
  for (let time = start.getTime(); dayKey(new Date(time)) <= endKey; time += DAY_MS) {
    const date = dayKey(new Date(time));
    balance += netByDay.get(date) ?? 0;
    days.push({ date, balanceCents: balance });
  }
  return days;
}

export function summarizeFlows(months: readonly MonthFlow[]) {
  const inCents = months.reduce((sum, month) => sum + month.inCents, 0);
  const outCents = months.reduce((sum, month) => sum + month.outCents, 0);
  return { inCents, outCents, netCents: inCents - outCents };
}

/**
 * Everything the time range controls, derived together so the figures reconcile:
 * the change in cash equals net cash flow. The opening balance is the close of the
 * day before the range, because that first day's activity belongs inside the range.
 */
export function viewRange(months: readonly MonthFlow[], daily: readonly DailyBalance[], rangeMonths: number) {
  const visibleMonths = months.slice(-rangeMonths);
  const firstMonth = visibleMonths[0]?.month ?? "";
  return {
    firstMonth,
    months: visibleMonths,
    daily: daily.filter((day) => day.date.slice(0, 7) >= firstMonth),
    openingCents: daily.filter((day) => day.date.slice(0, 7) < firstMonth).at(-1)?.balanceCents ?? 0,
    flows: summarizeFlows(visibleMonths),
  };
}

export type Runway =
  | { kind: "unknown" }
  | { kind: "positive"; averageNetCents: Cents }
  | { kind: "burning"; months: number; averageBurnCents: Cents };

/**
 * How long cash lasts at the recent rate of spending, using complete months only.
 * The month in progress would understate spending, so it isn't counted.
 */
export function computeRunway(cashCents: Cents, fullMonths: readonly MonthFlow[], window = 3): Runway {
  const recent = fullMonths.slice(-window);
  if (recent.length === 0 || recent.every((month) => month.inCents === 0 && month.outCents === 0)) {
    return { kind: "unknown" };
  }

  const averageNetCents = Math.round(summarizeFlows(recent).netCents / recent.length);
  if (averageNetCents >= 0) return { kind: "positive", averageNetCents };

  const averageBurnCents = -averageNetCents;
  return { kind: "burning", averageBurnCents, months: Math.max(cashCents, 0) / averageBurnCents };
}
