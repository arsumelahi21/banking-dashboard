"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatFullDay, formatMonth } from "@/lib/format";
import type { DailyBalance } from "@/lib/metrics";
import { formatMoney } from "@/lib/money";
import { ChartTable, ChartTooltipCard } from "./chart-parts";

const axisTick = { fill: "var(--fg-muted)", fontSize: 12 };

/** Labels the first day of each month, so ticks line up with the calendar at every range. */
function monthTicks(data: readonly DailyBalance[], every: number): string[] {
  const firsts = data.filter((day) => day.date.endsWith("-01")).map((day) => day.date);
  return firsts.filter((_, index) => index % every === 0);
}

export function CashBalanceChart({ data }: { data: DailyBalance[] }) {
  const firstOfMonths = data.filter((day) => day.date.endsWith("-01")).length;

  return (
    <>
      {/* Height includes the axis band, so labels are never clipped. */}
      <div className="h-64 w-full" role="img" aria-label={`Total cash from ${formatFullDay(data[0]!.date)} to ${formatFullDay(data.at(-1)!.date)}. Values are in the table below.`}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis
              dataKey="date"
              ticks={monthTicks(data, firstOfMonths > 6 ? 2 : 1)}
              tickFormatter={(value: string) => formatMonth(value)}
              tick={axisTick}
              tickLine={false}
              axisLine={{ stroke: "var(--border)" }}
              tickMargin={8}
            />
            <YAxis
              // Cash charts start at zero, so a small change can't look like a dramatic one.
              domain={[0, "auto"]}
              tickFormatter={(value: number) => formatMoney(Math.round(value), { compact: true })}
              tick={axisTick}
              tickLine={false}
              axisLine={false}
              width={56}
            />
            <Tooltip
              cursor={{ stroke: "var(--border-strong)", strokeWidth: 1 }}
              isAnimationActive={false}
              content={({ active, payload }) => {
                const day = payload?.[0]?.payload as DailyBalance | undefined;
                if (!active || !day) return null;
                return (
                  <ChartTooltipCard
                    title={formatFullDay(day.date)}
                    rows={[{ label: "Total cash", value: formatMoney(day.balanceCents), color: "var(--chart-in)" }]}
                  />
                );
              }}
            />
            <Area
              type="monotone"
              dataKey="balanceCents"
              name="Total cash"
              stroke="var(--chart-in)"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              fill="var(--chart-in)"
              fillOpacity={0.1}
              dot={false}
              activeDot={{ r: 4, fill: "var(--chart-in)", stroke: "var(--surface)", strokeWidth: 2 }}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <ChartTable
        caption="Total cash by day"
        headers={["Date", "Total cash"]}
        rows={[...data].reverse().map((day) => ({
          key: day.date,
          cells: [formatFullDay(day.date), formatMoney(day.balanceCents)],
        }))}
      />
    </>
  );
}
