"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parsePaymentInput, type PaymentField, type RawPaymentInput } from "@/lib/payments";
import { consumeRateLimit } from "@/server/auth/rate-limit";
import { requireSession } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { LedgerError } from "@/server/ledger/ledger";
import {
  addRecipient,
  cancelScheduledPayment,
  PaymentError,
  previewPayment,
  runScheduledPayment,
  submitPayment,
  type PaymentErrorCode,
  type PaymentPreview,
  type SubmitResult,
} from "./service";

type Failure = { ok: false; field: PaymentField; code?: PaymentErrorCode; message: string };

const errorDetails: Record<PaymentErrorCode, { field: PaymentField; message: string }> = {
  INVALID_AMOUNT: { field: "amount", message: "Enter an amount we can process." },
  SAME_ACCOUNT: { field: "to", message: "Choose a different account to send to." },
  ACCOUNT_NOT_FOUND: { field: "from", message: "That account wasn't found." },
  RECIPIENT_NOT_FOUND: { field: "to", message: "That recipient wasn't found." },
  INSUFFICIENT_FUNDS: { field: "amount", message: "This is more than the available balance in that account." },
  IDEMPOTENCY_CONFLICT: { field: "form", message: "The details changed. Please review the payment again." },
  VERIFICATION_REQUIRED: { field: "form", message: "This payment needs a verification code." },
  CODE_INVALID: { field: "form", message: "That code isn't right. Check it and try again." },
  CODE_EXPIRED: { field: "form", message: "That code has expired. Please request a new one." },
  CODE_LOCKED: { field: "form", message: "Too many incorrect codes. Please request a new one." },
};

function toFailure(error: unknown): Failure {
  if (error instanceof PaymentError || error instanceof LedgerError) {
    return { ok: false, code: error.code, ...errorDetails[error.code] };
  }
  // Anything unexpected is logged here and stays out of the response.
  console.error("Payment failed unexpectedly", error);
  return { ok: false, field: "form", message: "We couldn't complete that. It's safe to try again; it won't send twice." };
}

const TOO_MANY: Failure = { ok: false, field: "form", message: "Too many attempts. Please wait a few minutes and try again." };

export type PreviewResponse = { ok: true; preview: PaymentPreview } | Failure;

export async function previewPaymentAction(raw: RawPaymentInput): Promise<PreviewResponse> {
  const session = await requireSession();
  const db = getDb();
  if (!(await consumeRateLimit(db, `payment:preview:${session.userId}`, { limit: 40, windowSeconds: 600 }))) return TOO_MANY;

  const parsed = parsePaymentInput(raw);
  if (!parsed.ok) return parsed;

  try {
    const preview = await previewPayment(db, { orgId: session.orgId, userId: session.userId }, parsed.value);
    return { ok: true, preview };
  } catch (error) {
    return toFailure(error);
  }
}

export type SubmitResponse = { ok: true; result: SubmitResult } | Failure;

export async function submitPaymentAction(
  raw: RawPaymentInput,
  verification: { challengeId?: string; code?: string },
): Promise<SubmitResponse> {
  const session = await requireSession();
  const db = getDb();
  if (!(await consumeRateLimit(db, `payment:submit:${session.userId}`, { limit: 40, windowSeconds: 600 }))) return TOO_MANY;

  const parsed = parsePaymentInput(raw);
  if (!parsed.ok) return parsed;

  const code = verification.code?.replace(/\s/g, "");
  if (code !== undefined && !/^\d{6}$/.test(code)) {
    return { ok: false, field: "form", code: "CODE_INVALID", message: errorDetails.CODE_INVALID.message };
  }
  const challengeId = z.uuid().safeParse(verification.challengeId).data;

  try {
    const result = await submitPayment(db, { orgId: session.orgId, userId: session.userId }, parsed.value, { challengeId, code });
    revalidatePath("/", "layout");
    return { ok: true, result };
  } catch (error) {
    return toFailure(error);
  }
}

const idSchema = z.uuid();

export async function cancelScheduledAction(id: string): Promise<{ ok: boolean; message?: string }> {
  const session = await requireSession();
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return { ok: false, message: "That payment wasn't found." };

  const canceled = await cancelScheduledPayment(getDb(), { orgId: session.orgId, userId: session.userId }, parsed.data);
  revalidatePath("/payments");
  return canceled ? { ok: true } : { ok: false, message: "This payment has already run or been canceled." };
}

export async function sendScheduledNowAction(id: string): Promise<{ ok: boolean; message?: string }> {
  const session = await requireSession();
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return { ok: false, message: "That payment wasn't found." };

  const outcome = await runScheduledPayment(getDb(), session.orgId, parsed.data, session.userId);
  revalidatePath("/", "layout");
  if (outcome === "completed") return { ok: true };
  return {
    ok: false,
    message: outcome === "failed" ? "This payment couldn't be sent. Check the available balance." : "This payment has already run or been canceled.",
  };
}

const recipientSchema = z.object({
  name: z.string().trim().min(2, "Enter the recipient's name.").max(80, "Use 80 characters or fewer."),
  bankName: z.string().trim().min(2, "Enter the bank's name.").max(80, "Use 80 characters or fewer."),
  accountNumber: z.string().trim().regex(/^\d{4,17}$/, "Enter 4 to 17 digits, with no spaces."),
});

export type RecipientFormState = {
  status: "idle" | "saved" | "error";
  errors?: { name?: string; bankName?: string; accountNumber?: string; form?: string };
};

export async function addRecipientAction(_previous: RecipientFormState, formData: FormData): Promise<RecipientFormState> {
  const session = await requireSession();
  const db = getDb();
  if (!(await consumeRateLimit(db, `recipient:add:${session.userId}`, { limit: 20, windowSeconds: 3600 }))) {
    return { status: "error", errors: { form: TOO_MANY.message } };
  }

  const parsed = recipientSchema.safeParse({
    name: formData.get("name"),
    bankName: formData.get("bankName"),
    accountNumber: formData.get("accountNumber"),
  });
  if (!parsed.success) {
    const fields = z.flattenError(parsed.error).fieldErrors;
    return {
      status: "error",
      errors: { name: fields.name?.[0], bankName: fields.bankName?.[0], accountNumber: fields.accountNumber?.[0] },
    };
  }

  await addRecipient(db, { orgId: session.orgId, userId: session.userId }, parsed.data);
  revalidatePath("/payments");
  return { status: "saved" };
}
