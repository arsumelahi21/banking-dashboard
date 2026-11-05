"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatFullMonth, formatMonth } from "@/lib/format";
import type { MonthSpend } from "@/lib/insights";
import { formatMoney } from "@/lib/money";
import { ChartTable, ChartTooltipCard } from "./chart-parts";

const axisTick = { fill: "var(--fg-muted)", fontSize: 12 };

/** One series, so the card's title names it and no legend is needed. */
export function MonthlySpendChart({ data, title }: { data: MonthSpend[]; title: string }) {
  return (
    <>
      <div className="h-64 w-full" role="img" aria-label={`${title} by month. Values are in the table below.`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="24%">
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis
              dataKey="month"
              tickFormatter={(value: string) => formatMonth(value)}
              tick={axisTick}
              tickLine={false}
              axisLine={{ stroke: "var(--border)" }}
              tickMargin={8}
              interval="preserveStartEnd"
              minTickGap={16}
            />
            <YAxis
              tickFormatter={(value: number) => formatMoney(Math.round(value), { compact: true })}
              tick={axisTick}
              tickLine={false}
              axisLine={false}
              width={56}
            />
            <Tooltip
              cursor={{ fill: "var(--surface-2)" }}
              isAnimationActive={false}
              content={({ active, payload }) => {
                const month = payload?.[0]?.payload as MonthSpend | undefined;
                if (!active || !month) return null;
                return (
                  <ChartTooltipCard
                    title={formatFullMonth(month.month)}
                    rows={[{ label: title, value: formatMoney(month.cents), color: "var(--chart-in)" }]}
                  />
                );
              }}
            />
            <Bar dataKey="cents" name={title} fill="var(--chart-in)" radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ChartTable
        caption={`${title} by month`}
        headers={["Month", "Amount"]}
        rows={[...data].reverse().map((month) => ({ key: month.month, cells: [formatFullMonth(month.month), formatMoney(month.cents)] }))}
      />
    </>
  );
}
