import { describe, expect, it } from "vitest";
import { countActiveFilters, parseTransactionFilters, serializeTransactionFilters } from "./transaction-filters";

const UUID = "3f2b8c1e-9a4d-4c7e-8f10-2d6a5b7c9e01";

describe("parseTransactionFilters", () => {
  it("reads valid values", () => {
    expect(
      parseTransactionFilters({
        q: "  figma ",
        status: "pending",
        type: "card",
        direction: "out",
        category: "Software",
        account: UUID,
        from: "2026-01-01",
        to: "2026-02-28",
        min: "10.50",
        max: "1,000",
        page: "3",
        tx: UUID,
      }),
    ).toEqual({
      q: "figma",
      status: "pending",
      method: "card",
      direction: "out",
      category: "Software",
      accountId: UUID,
      from: "2026-01-01",
      to: "2026-02-28",
      minCents: 1050,
      maxCents: 100000,
      page: 3,
      tx: UUID,
    });
  });

  it("drops invalid values instead of passing them to a query", () => {
    const filters = parseTransactionFilters({
      status: "stolen",
      type: "'; drop table transactions;--",
      direction: "sideways",
      account: "1 or 1=1",
      from: "yesterday",
      to: "2026-13-45",
      min: "-5",
      max: "abc",
      page: "-2",
      tx: "../../etc/passwd",
    });
    expect(filters).toEqual({ page: 1 });
  });

  it("rejects calendar dates that don't exist", () => {
    expect(parseTransactionFilters({ from: "2026-02-31" }).from).toBeUndefined();
    expect(parseTransactionFilters({ from: "2028-02-29" }).from).toBe("2028-02-29");
  });

  it("corrects reversed date and amount ranges", () => {
    const filters = parseTransactionFilters({ from: "2026-03-01", to: "2026-01-01", min: "50", max: "10" });
    expect(filters).toMatchObject({ from: "2026-01-01", to: "2026-03-01", minCents: 1000, maxCents: 5000 });
  });

  it.each(["0", "1.5", "abc", "999999999", ""])("falls back to page 1 for %s where invalid", (page) => {
    const parsed = parseTransactionFilters({ page }).page;
    expect(parsed).toBe(1);
  });

  it("limits search length and uses the first of repeated parameters", () => {
    expect(parseTransactionFilters({ q: "x".repeat(500) }).q).toHaveLength(100);
    expect(parseTransactionFilters({ q: ["first", "second"] }).q).toBe("first");
  });
});

describe("serializeTransactionFilters", () => {
  it("round-trips through the URL", () => {
    const filters = parseTransactionFilters({
      q: "a&b=c d",
      status: "failed",
      type: "wire",
      from: "2026-01-01",
      min: "12.05",
      page: "2",
      category: "Bank fees",
    });
    const params = Object.fromEntries(new URLSearchParams(serializeTransactionFilters(filters)));
    expect(parseTransactionFilters(params)).toEqual(filters);
  });

  it("keeps a zero minimum and omits the default page", () => {
    expect(serializeTransactionFilters({ minCents: 0, page: 1 })).toBe("min=0.00");
  });
});

describe("countActiveFilters", () => {
  it("counts narrowing filters but not search or page", () => {
    expect(countActiveFilters({ q: "x", page: 4 })).toBe(0);
    expect(countActiveFilters({ page: 1, status: "failed", minCents: 0 })).toBe(2);
  });
});
