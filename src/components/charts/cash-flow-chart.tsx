"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatFullMonth, formatMonth } from "@/lib/format";
import type { MonthFlow } from "@/lib/metrics";
import { formatMoney } from "@/lib/money";
import { ChartLegend, ChartTable, ChartTooltipCard } from "./chart-parts";

const axisTick = { fill: "var(--fg-muted)", fontSize: 12 };
const IN_COLOR = "var(--chart-in)";
const OUT_COLOR = "var(--chart-out)";

export function CashFlowChart({ data }: { data: MonthFlow[] }) {
  return (
    <>
      <ChartLegend
        items={[
          { label: "Money in", color: IN_COLOR },
          { label: "Money out", color: OUT_COLOR },
        ]}
      />
      <div className="mt-3 h-64 w-full" role="img" aria-label="Money in and money out by month. Values are in the table below.">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barGap={2} barCategoryGap="24%">
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
                const month = payload?.[0]?.payload as MonthFlow | undefined;
                if (!active || !month) return null;
                return (
                  <ChartTooltipCard
                    title={formatFullMonth(month.month)}
                    rows={[
                      { label: "Money in", value: formatMoney(month.inCents), color: IN_COLOR },
                      { label: "Money out", value: formatMoney(month.outCents), color: OUT_COLOR },
                      { label: "Net", value: formatMoney(month.inCents - month.outCents, { signed: true }) },
                    ]}
                  />
                );
              }}
            />
            <Bar dataKey="inCents" name="Money in" fill={IN_COLOR} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
            <Bar dataKey="outCents" name="Money out" fill={OUT_COLOR} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ChartTable
        caption="Money in and out by month"
        headers={["Month", "Money in", "Money out", "Net"]}
        rows={[...data].reverse().map((month) => ({
          key: month.month,
          cells: [
            formatFullMonth(month.month),
            formatMoney(month.inCents),
            formatMoney(month.outCents),
            formatMoney(month.inCents - month.outCents, { signed: true }),
          ],
        }))}
      />
    </>
  );
}
