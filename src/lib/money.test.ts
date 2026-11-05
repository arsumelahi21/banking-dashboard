import { describe, expect, it } from "vitest";
import { formatMoney } from "./money";

describe("formatMoney", () => {
  it("formats cents as dollars with thousands separators", () => {
    expect(formatMoney(123456789)).toBe("$1,234,567.89");
    expect(formatMoney(5)).toBe("$0.05");
    expect(formatMoney(0)).toBe("$0.00");
  });

  it("formats negatives", () => {
    expect(formatMoney(-2550)).toBe("-$25.50");
  });

  it("shows a plus sign only when asked, and never on zero", () => {
    expect(formatMoney(2550, { signed: true })).toBe("+$25.50");
    expect(formatMoney(-2550, { signed: true })).toBe("-$25.50");
    expect(formatMoney(0, { signed: true })).toBe("$0.00");
  });

  it("shortens values in compact mode", () => {
    expect(formatMoney(125000000, { compact: true })).toBe("$1.3M");
  });

  it("rejects amounts that aren't whole cents", () => {
    expect(() => formatMoney(10.5)).toThrow(RangeError);
    expect(() => formatMoney(Number.NaN)).toThrow(RangeError);
    expect(() => formatMoney(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
  });
});
