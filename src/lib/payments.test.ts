import { describe, expect, it } from "vitest";
import { parsePaymentInput, type RawPaymentInput } from "./payments";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const KEY = "33333333-3333-4333-8333-333333333333";
const NOW = new Date("2026-11-06T12:00:00Z");

const transfer = (overrides: RawPaymentInput = {}): RawPaymentInput => ({
  idempotencyKey: KEY,
  fromAccountId: A,
  toAccountId: B,
  amount: "100",
  ...overrides,
});
const fieldOf = (raw: RawPaymentInput) => {
  const result = parsePaymentInput(raw, NOW);
  return result.ok ? "ok" : result.field;
};

describe("parsePaymentInput", () => {
  it("accepts a transfer and converts the amount to cents", () => {
    expect(parsePaymentInput(transfer({ amount: "1,250.50", memo: "  rent  " }), NOW)).toEqual({
      ok: true,
      value: { idempotencyKey: KEY, fromAccountId: A, toAccountId: B, amountCents: 125050, memo: "rent", scheduledFor: undefined },
    });
  });

  it("accepts a recipient payment with a method", () => {
    const result = parsePaymentInput(transfer({ toAccountId: undefined, recipientId: B, method: "wire" }), NOW);
    expect(result).toMatchObject({ ok: true, value: { recipientId: B, method: "wire" } });
  });

  it.each([
    ["no key", { idempotencyKey: undefined }, "form"],
    ["a malformed key", { idempotencyKey: "abc" }, "form"],
    ["no source", { fromAccountId: "" }, "from"],
    ["a malformed source", { fromAccountId: "1 or 1=1" }, "from"],
    ["no destination", { toAccountId: "" }, "to"],
    ["the same account twice", { toAccountId: A }, "to"],
    ["two destinations", { recipientId: B, method: "ach" }, "to"],
    ["a recipient with no method", { toAccountId: "", recipientId: B }, "method"],
    ["a recipient with an unknown method", { toAccountId: "", recipientId: B, method: "cash" }, "method"],
    ["a zero amount", { amount: "0" }, "amount"],
    ["a zero amount with decimals", { amount: "0.00" }, "amount"],
    ["a negative amount", { amount: "-100" }, "amount"],
    ["fractions of a cent", { amount: "1.005" }, "amount"],
    ["scientific notation", { amount: "1e9" }, "amount"],
    ["no amount", { amount: "" }, "amount"],
    ["a long memo", { memo: "x".repeat(141) }, "memo"],
    ["today", { scheduledFor: "2026-11-06" }, "date"],
    ["the past", { scheduledFor: "2020-01-01" }, "date"],
    ["more than a year out", { scheduledFor: "2030-01-01" }, "date"],
    ["an impossible date", { scheduledFor: "2026-11-31" }, "date"],
    ["a non-date", { scheduledFor: "soon" }, "date"],
  ] as const)("rejects %s", (_label, overrides, field) => {
    expect(fieldOf(transfer(overrides))).toBe(field);
  });

  it("accepts tomorrow and the last allowed day", () => {
    expect(fieldOf(transfer({ scheduledFor: "2026-11-07" }))).toBe("ok");
    expect(fieldOf(transfer({ scheduledFor: "2027-11-06" }))).toBe("ok");
  });
});
