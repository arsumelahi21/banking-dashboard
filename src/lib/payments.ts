import { dayKey } from "@/lib/metrics";
import { parseDollarsToCents, type Cents } from "@/lib/money";

/** Payments at or above this need a one-time code. The server decides; the UI only reflects it. */
export const VERIFICATION_THRESHOLD_CENTS: Cents = 10_000_00;
export const MEMO_MAX_LENGTH = 140;
const MAX_SCHEDULE_DAYS = 365;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type RawPaymentInput = {
  idempotencyKey?: string;
  fromAccountId?: string;
  toAccountId?: string;
  recipientId?: string;
  method?: string;
  amount?: string;
  memo?: string;
  scheduledFor?: string;
};

export type PaymentRequest = {
  idempotencyKey: string;
  fromAccountId: string;
  amountCents: Cents;
  memo?: string;
  /** A future day (YYYY-MM-DD), or undefined to send now. */
  scheduledFor?: string;
} & ({ toAccountId: string; recipientId?: undefined; method?: undefined } | { recipientId: string; method: "ach" | "wire"; toAccountId?: undefined });

export type PaymentField = "from" | "to" | "method" | "amount" | "memo" | "date" | "form";
export type ParseResult = { ok: true; value: PaymentRequest } | { ok: false; field: PaymentField; message: string };

const fail = (field: PaymentField, message: string): ParseResult => ({ ok: false, field, message });

/** Runs on the server for every step, however the request was made. Never trusts the form. */
export function parsePaymentInput(raw: RawPaymentInput, now = new Date()): ParseResult {
  // Server actions accept whatever a request sends, whatever the types here say.
  if (typeof raw !== "object" || raw === null) return fail("form", "Please reload the page and try again.");
  for (const value of Object.values(raw)) {
    if (value !== undefined && typeof value !== "string") return fail("form", "Please reload the page and try again.");
  }

  const idempotencyKey = raw.idempotencyKey;
  const fromAccountId = raw.fromAccountId?.toLowerCase();
  const toAccountId = raw.toAccountId?.toLowerCase();
  const recipientId = raw.recipientId?.toLowerCase();
  const method = raw.method;

  if (!idempotencyKey || !UUID.test(idempotencyKey)) return fail("form", "Please reload the page and try again.");
  if (!fromAccountId || !UUID.test(fromAccountId)) return fail("from", "Choose an account to pay from.");

  const hasAccount = Boolean(toAccountId);
  const hasRecipient = Boolean(recipientId);
  if (hasAccount === hasRecipient) return fail("to", "Choose where to send the money.");
  if (hasAccount && !UUID.test(toAccountId!)) return fail("to", "Choose where to send the money.");
  if (hasRecipient && !UUID.test(recipientId!)) return fail("to", "Choose where to send the money.");
  if (toAccountId && toAccountId === fromAccountId) return fail("to", "Choose a different account to send to.");
  if (hasRecipient && method !== "ach" && method !== "wire") return fail("method", "Choose how to send this payment.");

  const amountCents = parseDollarsToCents(raw.amount ?? "");
  if (amountCents === null) return fail("amount", "Enter an amount like 1,250.00.");
  if (amountCents === 0) return fail("amount", "Enter an amount above $0.00.");

  const memo = raw.memo?.trim() || undefined;
  if (memo && memo.length > MEMO_MAX_LENGTH) return fail("memo", `Memos can be up to ${MEMO_MAX_LENGTH} characters.`);

  let scheduledFor: string | undefined;
  if (raw.scheduledFor) {
    scheduledFor = raw.scheduledFor;
    const date = new Date(`${scheduledFor}T00:00:00Z`);
    const valid = /^\d{4}-\d{2}-\d{2}$/.test(scheduledFor) && !Number.isNaN(date.getTime()) && date.toISOString().startsWith(scheduledFor);
    if (!valid) return fail("date", "Choose a valid date.");
    if (scheduledFor <= dayKey(now)) return fail("date", "Choose a date after today, or send it now.");
    if (scheduledFor > dayKey(new Date(now.getTime() + MAX_SCHEDULE_DAYS * 24 * 60 * 60 * 1000))) {
      return fail("date", "Choose a date within the next year.");
    }
  }

  const base = { idempotencyKey, fromAccountId, amountCents, memo, scheduledFor };
  return {
    ok: true,
    value: toAccountId
      ? { ...base, toAccountId }
      : { ...base, recipientId: recipientId!, method: method as "ach" | "wire" },
  };
}

export const methodDescriptions = {
  ach: { label: "ACH", detail: "Free. Arrives in 1–2 business days." },
  wire: { label: "Wire", detail: "Arrives the same day." },
} as const;
