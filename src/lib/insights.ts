import type { Cents } from "@/lib/money";

/** Money out for one merchant, category and month. The one dataset behind every figure. */
export type SpendRow = { month: string; category: string; counterparty: string; cents: Cents };
export type RankedSpend = { name: string; cents: Cents; share: number };
export type MonthSpend = { month: string; cents: Cents };

const TOP_MERCHANTS = 8;

function rank(rows: readonly SpendRow[], key: "category" | "counterparty", total: Cents): RankedSpend[] {
  const totals = new Map<string, Cents>();
  for (const row of rows) totals.set(row[key], (totals.get(row[key]) ?? 0) + row.cents);
  return [...totals]
    .map(([name, cents]) => ({ name, cents, share: total > 0 ? cents / total : 0 }))
    .sort((a, b) => b.cents - a.cents || a.name.localeCompare(b.name));
}

/**
 * Everything on the page comes from this, so the total, the rankings and the chart
 * always agree. `months` lists the range oldest first, and `previousMonths` the
 * same length of time before it, when that history exists.
 */
export function summarizeSpend(
  rows: readonly SpendRow[],
  { months, previousMonths, category }: { months: readonly string[]; previousMonths?: readonly string[]; category?: string },
) {
  const scoped = category ? rows.filter((row) => row.category === category) : rows;
  const inRange = new Set(months);
  const visible = scoped.filter((row) => inRange.has(row.month));
  const totalCents = visible.reduce((sum, row) => sum + row.cents, 0);

  // Always from the full range, so choosing a category doesn't remove the others from the menu.
  const allInRange = rows.filter((row) => inRange.has(row.month));
  const allTotal = allInRange.reduce((sum, row) => sum + row.cents, 0);

  const byMonth = new Map<string, Cents>();
  for (const row of visible) byMonth.set(row.month, (byMonth.get(row.month) ?? 0) + row.cents);

  let previousCents: Cents | null = null;
  if (previousMonths && previousMonths.length === months.length) {
    const previous = new Set(previousMonths);
    previousCents = scoped.filter((row) => previous.has(row.month)).reduce((sum, row) => sum + row.cents, 0);
  }

  return {
    totalCents,
    previousCents,
    changeRatio: previousCents ? (totalCents - previousCents) / previousCents : null,
    categories: rank(allInRange, "category", allTotal),
    merchants: rank(visible, "counterparty", totalCents).slice(0, TOP_MERCHANTS),
    months: months.map((month) => ({ month, cents: byMonth.get(month) ?? 0 })),
  };
}
