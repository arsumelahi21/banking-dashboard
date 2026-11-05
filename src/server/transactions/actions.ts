"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { consumeRateLimit } from "@/server/auth/rate-limit";
import { requireSession } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { logError } from "@/server/log";
import { setTransactionMemo } from "./service";

const MEMO_MAX_LENGTH = 280;

export type MemoFormState = { status: "idle" | "saved" | "error"; message?: string };

const memoInput = z.object({
  transactionId: z.uuid(),
  memo: z.string().trim().max(MEMO_MAX_LENGTH),
});

/** Memos are the only part of a transaction people can edit. Amounts and history can't change. */
export async function updateMemo(_previous: MemoFormState, formData: FormData): Promise<MemoFormState> {
  const session = await requireSession();
  // Every save writes to the permanent audit log, so saves are limited like other writes.
  const allowed = await consumeRateLimit(getDb(), `memo:${session.userId}`, { limit: 60, windowSeconds: 600 });
  if (!allowed) return { status: "error", message: "Too many changes. Please wait a few minutes and try again." };

  const parsed = memoInput.safeParse({
    transactionId: formData.get("transactionId"),
    memo: formData.get("memo"),
  });
  if (!parsed.success) {
    return { status: "error", message: `Memos can be up to ${MEMO_MAX_LENGTH} characters.` };
  }
  const { transactionId, memo } = parsed.data;

  let updated: boolean;
  try {
    updated = await setTransactionMemo(getDb(), { orgId: session.orgId, userId: session.userId }, transactionId, memo);
  } catch (error) {
    logError("Saving a memo failed", error);
    return { status: "error", message: "We couldn't save that. Please try again." };
  }

  if (!updated) return { status: "error", message: "That transaction wasn't found." };

  revalidatePath("/transactions");
  return { status: "saved" };
}
