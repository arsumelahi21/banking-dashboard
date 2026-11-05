"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseDollarsToCents } from "@/lib/money";
import { consumeRateLimit } from "@/server/auth/rate-limit";
import { requireSession } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { authorizeCardPurchase, LedgerError } from "@/server/ledger/ledger";
import { setCardLimit, setCardStatus } from "./service";

const MIN_LIMIT_CENTS = 100_00;
const MAX_LIMIT_CENTS = 1_000_000_00;
const TOO_MANY = "Too many changes. Please wait a few minutes and try again.";

const idSchema = z.uuid();

async function allowed(userId: string) {
  return consumeRateLimit(getDb(), `cards:${userId}`, { limit: 60, windowSeconds: 600 });
}

export async function setCardFrozenAction(cardId: string, frozen: boolean): Promise<{ ok: boolean; message?: string }> {
  const session = await requireSession();
  const parsed = idSchema.safeParse(cardId);
  if (!parsed.success) return { ok: false, message: "That card wasn't found." };
  if (!(await allowed(session.userId))) return { ok: false, message: TOO_MANY };

  const updated = await setCardStatus(getDb(), { orgId: session.orgId, userId: session.userId }, parsed.data, frozen ? "frozen" : "active");
  revalidatePath("/cards");
  return updated ? { ok: true } : { ok: false, message: "That card wasn't found." };
}

export type LimitFormState = { status: "idle" | "saved" | "error"; message?: string };

export async function setCardLimitAction(_previous: LimitFormState, formData: FormData): Promise<LimitFormState> {
  const session = await requireSession();
  const parsed = idSchema.safeParse(formData.get("cardId"));
  if (!parsed.success) return { status: "error", message: "That card wasn't found." };
  if (!(await allowed(session.userId))) return { status: "error", message: TOO_MANY };

  const cents = parseDollarsToCents(String(formData.get("limit") ?? ""));
  if (cents === null || cents < MIN_LIMIT_CENTS || cents > MAX_LIMIT_CENTS) {
    return { status: "error", message: "Enter a limit between $100.00 and $1,000,000.00." };
  }

  const updated = await setCardLimit(getDb(), { orgId: session.orgId, userId: session.userId }, parsed.data, cents);
  revalidatePath("/cards");
  return updated ? { status: "saved" } : { status: "error", message: "That card wasn't found." };
}

const purchaseSchema = z.object({
  cardId: z.uuid(),
  idempotencyKey: z.uuid(),
  merchant: z.string().trim().min(2).max(60),
});

export type PurchaseResponse =
  | { ok: true; outcome: "approved" | "declined"; reason?: string; transactionId: string }
  | { ok: false; message: string };

/** The demo's stand-in for a merchant's card network request. Real rules, simulated merchant. */
export async function simulatePurchaseAction(input: { cardId: string; idempotencyKey: string; merchant: string; amount: string }): Promise<PurchaseResponse> {
  const session = await requireSession();
  if (!(await allowed(session.userId))) return { ok: false, message: TOO_MANY };

  const parsed = purchaseSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Enter a merchant name of 2 to 60 characters." };

  const amountCents = parseDollarsToCents(input.amount);
  if (!amountCents) return { ok: false, message: "Enter an amount like 42.50." };

  try {
    const result = await authorizeCardPurchase(getDb(), { orgId: session.orgId, actorUserId: session.userId, amountCents, ...parsed.data });
    revalidatePath("/", "layout");
    return { ok: true, outcome: result.outcome, reason: result.reason, transactionId: result.transactionId };
  } catch (error) {
    if (error instanceof LedgerError && error.code === "CARD_NOT_FOUND") return { ok: false, message: "That card wasn't found." };
    if (error instanceof LedgerError && error.code === "INVALID_AMOUNT") return { ok: false, message: "Enter an amount we can process." };
    console.error("Card purchase failed unexpectedly", error);
    return { ok: false, message: "We couldn't complete that. It's safe to try again." };
  }
}
