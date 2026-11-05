import { describe, expect, it } from "vitest";
import { generateActivity, type AccountKey } from "./generate";

// Spread across the year so month-length and period edge cases are exercised.
const dates = ["2026-11-06T12:00:00Z", "2026-03-01T00:30:00Z", "2028-02-29T23:00:00Z", "2027-01-31T08:00:00Z"];

describe.each(dates)("generateActivity at %s", (iso) => {
  const now = new Date(iso);
  const activity = generateActivity(now);

  it("produces a realistic volume of activity", () => {
    expect(activity.length).toBeGreaterThan(500);
    expect(activity.length).toBeLessThan(1500);
  });

  it("balances every transaction, in whole cents", () => {
    for (const item of activity) {
      expect(item.lines.reduce((sum, line) => sum + line.amountCents, 0)).toBe(0);
      for (const line of item.lines) {
        expect(Number.isSafeInteger(line.amountCents)).toBe(true);
        expect(line.amountCents).not.toBe(0);
      }
    }
  });

  it("contains nothing in the future and is in date order", () => {
    let previous = 0;
    for (const item of activity) {
      expect(item.occurredAt.getTime()).toBeLessThanOrEqual(now.getTime());
      expect(item.occurredAt.getTime()).toBeGreaterThanOrEqual(previous);
      previous = item.occurredAt.getTime();
    }
  });

  it("never overdraws an account at any point in history", () => {
    const balances: Record<AccountKey, number> = { operating: 0, payroll: 0, reserve: 0, external: 0 };
    for (const item of activity) {
      if (item.status !== "posted") continue;
      for (const line of item.lines) balances[line.account] += line.amountCents;
      expect(balances.operating, item.description).toBeGreaterThanOrEqual(0);
      expect(balances.payroll, item.description).toBeGreaterThanOrEqual(0);
      expect(balances.reserve, item.description).toBeGreaterThanOrEqual(0);
    }
  });

  it("keeps a working balance in every account, not an implausible zero", () => {
    const balances: Record<AccountKey, number> = { operating: 0, payroll: 0, reserve: 0, external: 0 };
    for (const item of activity) {
      if (item.status !== "posted") continue;
      for (const line of item.lines) balances[line.account] += line.amountCents;
    }
    expect(balances.operating).toBeGreaterThan(10_000_000);
    expect(balances.payroll).toBeGreaterThan(1_000_000);
    expect(balances.reserve).toBeGreaterThan(10_000_000);
  });

  it("leaves only recent activity pending", () => {
    for (const item of activity.filter((entry) => entry.status === "pending")) {
      expect(now.getTime() - item.occurredAt.getTime()).toBeLessThan(2 * 24 * 60 * 60 * 1000);
    }
  });
});

describe("generateActivity", () => {
  it("is deterministic", () => {
    const now = new Date("2026-11-06T12:00:00Z");
    expect(generateActivity(now)).toEqual(generateActivity(now));
  });
});
