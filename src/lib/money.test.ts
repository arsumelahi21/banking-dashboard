import { describe, expect, it } from "vitest";
import { centsToDollarString, formatMoney, parseDollarsToCents } from "./money";

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

describe("parseDollarsToCents", () => {
  it.each([
    ["10", 1000],
    ["10.5", 1050],
    ["10.05", 1005],
    ["0.07", 7],
    ["$1,234.56", 123456],
    [" 19.99 ", 1999],
    ["0", 0],
    // These go wrong with floating point: 1.15 * 100 is 114.99999999999999.
    ["1.15", 115],
    ["4.35", 435],
    ["1.10", 110],
  ])("reads %s as %i cents", (input, cents) => {
    expect(parseDollarsToCents(input)).toBe(cents);
  });

  it.each(["", "abc", "-5", "1.234", "1e5", "1.2.3", "NaN", "Infinity", "12345678901234", "0x10"])("rejects %j", (input) => {
    expect(parseDollarsToCents(input)).toBeNull();
  });
});

describe("centsToDollarString", () => {
  it("round-trips with parsing", () => {
    for (const cents of [0, 5, 115, 1050, 123456]) {
      expect(parseDollarsToCents(centsToDollarString(cents))).toBe(cents);
    }
  });
});
