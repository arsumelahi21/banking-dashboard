import { describe, expect, it } from "vitest";
import { buildDailyBalances, computeRunway, fillMonths, startOfMonth, summarizeFlows, viewRange } from "./metrics";

const flow = (month: string, inCents: number, outCents: number) => ({ month, inCents, outCents });

describe("startOfMonth", () => {
  it("crosses year boundaries", () => {
    expect(startOfMonth(new Date("2026-02-15T12:00:00Z"), 3).toISOString()).toBe("2025-11-01T00:00:00.000Z");
  });

  it("isn't thrown off by the last day of a long month", () => {
    expect(startOfMonth(new Date("2026-03-31T12:00:00Z"), 1).toISOString()).toBe("2026-02-01T00:00:00.000Z");
  });
});

describe("fillMonths", () => {
  it("returns the requested months, oldest first, filling gaps with zero", () => {
    const rows = fillMonths([flow("2026-01", 5, 2)], new Date("2026-02-10T00:00:00Z"), 3);
    expect(rows).toEqual([flow("2025-12", 0, 0), flow("2026-01", 5, 2), flow("2026-02", 0, 0)]);
  });
});

describe("buildDailyBalances", () => {
  const start = new Date("2026-03-01T00:00:00Z");
  const end = new Date("2026-03-03T18:00:00Z");

  it("includes earlier activity in the opening balance", () => {
    const rows = [
      { date: "2026-01-15", netCents: 1000 },
      { date: "2026-03-02", netCents: -250 },
    ];
    expect(buildDailyBalances(rows, start, end)).toEqual([
      { date: "2026-03-01", balanceCents: 1000 },
      { date: "2026-03-02", balanceCents: 750 },
      { date: "2026-03-03", balanceCents: 750 },
    ]);
  });

  it("works with no activity", () => {
    expect(buildDailyBalances([], start, start)).toEqual([{ date: "2026-03-01", balanceCents: 0 }]);
  });

  it("spans a leap day", () => {
    const days = buildDailyBalances([], new Date("2028-02-28T00:00:00Z"), new Date("2028-03-01T00:00:00Z"));
    expect(days.map((day) => day.date)).toEqual(["2028-02-28", "2028-02-29", "2028-03-01"]);
  });
});

describe("summarizeFlows", () => {
  it("adds up in, out and net", () => {
    expect(summarizeFlows([flow("a", 100, 30), flow("b", 50, 80)])).toEqual({ inCents: 150, outCents: 110, netCents: 40 });
  });
});

describe("viewRange", () => {
  const months = [flow("2026-01", 100, 0), flow("2026-02", 50, 20), flow("2026-03", 10, 30)];
  const daily = [
    { date: "2026-01-31", balanceCents: 100 },
    { date: "2026-02-01", balanceCents: 130 },
    { date: "2026-03-01", balanceCents: 110 },
  ];

  it("opens on the close of the day before the range, so first-day activity counts", () => {
    const view = viewRange(months, daily, 2);
    expect(view.openingCents).toBe(100);
    expect(view.daily.map((day) => day.date)).toEqual(["2026-02-01", "2026-03-01"]);
    expect(view.flows).toEqual({ inCents: 60, outCents: 50, netCents: 10 });
    expect(daily.at(-1)!.balanceCents - view.openingCents).toBe(view.flows.netCents);
  });

  it("opens at zero when there's no earlier history", () => {
    expect(viewRange(months, daily.slice(1), 3).openingCents).toBe(0);
  });
});

describe("computeRunway", () => {
  it("divides cash by the average burn of the last three months", () => {
    const months = [flow("a", 999, 0), flow("b", 100, 200), flow("c", 100, 300), flow("d", 100, 400)];
    expect(computeRunway(4000, months)).toEqual({ kind: "burning", averageBurnCents: 200, months: 20 });
  });

  it("reports cash-flow positive instead of an infinite runway", () => {
    expect(computeRunway(4000, [flow("a", 500, 200)])).toEqual({ kind: "positive", averageNetCents: 300 });
    expect(computeRunway(4000, [flow("a", 200, 200)])).toEqual({ kind: "positive", averageNetCents: 0 });
  });

  it("is unknown without activity, rather than claiming a healthy result", () => {
    expect(computeRunway(4000, [])).toEqual({ kind: "unknown" });
    expect(computeRunway(4000, [flow("a", 0, 0)])).toEqual({ kind: "unknown" });
  });

  it("never reports negative runway", () => {
    expect(computeRunway(-500, [flow("a", 0, 100)])).toMatchObject({ months: 0 });
  });
});
