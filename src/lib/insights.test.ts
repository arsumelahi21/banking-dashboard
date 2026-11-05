import { describe, expect, it } from "vitest";
import { summarizeSpend, type SpendRow } from "./insights";

const row = (month: string, category: string, counterparty: string, cents: number): SpendRow => ({ month, category, counterparty, cents });

const rows = [
  row("2026-01", "Rent", "Landlord", 1000),
  row("2026-02", "Rent", "Landlord", 1000),
  row("2026-02", "Software", "Figma", 300),
  row("2026-03", "Rent", "Landlord", 1000),
  row("2026-03", "Software", "Figma", 300),
  row("2026-03", "Software", "Slack", 200),
];

describe("summarizeSpend", () => {
  it("totals only the requested months", () => {
    expect(summarizeSpend(rows, { months: ["2026-03"] }).totalCents).toBe(1500);
    expect(summarizeSpend(rows, { months: ["2026-02", "2026-03"] }).totalCents).toBe(2800);
  });

  it("ranks categories and merchants from largest, with shares of the total", () => {
    const summary = summarizeSpend(rows, { months: ["2026-03"] });
    expect(summary.categories.map((item) => item.name)).toEqual(["Rent", "Software"]);
    expect(summary.categories[0]!.share).toBeCloseTo(1000 / 1500);
    expect(summary.categories.reduce((sum, item) => sum + item.cents, 0)).toBe(summary.totalCents);
    expect(summary.merchants.map((item) => item.name)).toEqual(["Landlord", "Figma", "Slack"]);
  });

  it("scopes figures to a category, but keeps every category available to choose", () => {
    const summary = summarizeSpend(rows, { months: ["2026-03"], category: "Software" });
    expect(summary.totalCents).toBe(500);
    expect(summary.merchants.map((item) => item.name)).toEqual(["Figma", "Slack"]);
    expect(summary.months).toEqual([{ month: "2026-03", cents: 500 }]);
    expect(summary.categories.map((item) => item.name)).toEqual(["Rent", "Software"]);
  });

  it("fills quiet months with zero, in order", () => {
    const summary = summarizeSpend(rows, { months: ["2026-03", "2026-04"], category: "Rent" });
    expect(summary.months).toEqual([
      { month: "2026-03", cents: 1000 },
      { month: "2026-04", cents: 0 },
    ]);
  });

  it("compares with the period before", () => {
    const summary = summarizeSpend(rows, { months: ["2026-03"], previousMonths: ["2026-02"] });
    expect(summary.previousCents).toBe(1300);
    expect(summary.changeRatio).toBeCloseTo(200 / 1300);
  });

  it("gives no comparison without a full earlier period, or from zero", () => {
    expect(summarizeSpend(rows, { months: ["2026-03"] }).changeRatio).toBeNull();
    expect(summarizeSpend(rows, { months: ["2026-02", "2026-03"], previousMonths: ["2026-01"] }).previousCents).toBeNull();
    expect(summarizeSpend(rows, { months: ["2026-01"], previousMonths: ["2025-12"] }).changeRatio).toBeNull();
  });

  it("is safe with no data", () => {
    const summary = summarizeSpend([], { months: ["2026-03"] });
    expect(summary).toMatchObject({ totalCents: 0, categories: [], merchants: [], changeRatio: null });
  });

  it("limits the merchant list", () => {
    const many = Array.from({ length: 12 }, (_, index) => row("2026-03", "Software", `Vendor ${index}`, 100 + index));
    expect(summarizeSpend(many, { months: ["2026-03"] }).merchants).toHaveLength(8);
  });
});
