"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { auditLog, transactions } from "@/server/db/schema";

const MEMO_MAX_LENGTH = 280;

export type MemoFormState = { status: "idle" | "saved" | "error"; message?: string };

const memoInput = z.object({
  transactionId: z.uuid(),
  memo: z.string().trim().max(MEMO_MAX_LENGTH),
});

/** Memos are the only part of a transaction people can edit. Amounts and history can't change. */
export async function updateMemo(_previous: MemoFormState, formData: FormData): Promise<MemoFormState> {
  const session = await requireSession();

  const parsed = memoInput.safeParse({
    transactionId: formData.get("transactionId"),
    memo: formData.get("memo"),
  });
  if (!parsed.success) {
    return { status: "error", message: `Memos can be up to ${MEMO_MAX_LENGTH} characters.` };
  }
  const { transactionId, memo } = parsed.data;

  const updated = await getDb().transaction(async (tx) => {
    // The organization is part of the update, so another customer's id changes nothing.
    const rows = await tx
      .update(transactions)
      .set({ memo: memo || null })
      .where(and(eq(transactions.id, transactionId), eq(transactions.orgId, session.orgId)))
      .returning({ id: transactions.id });
    if (rows.length === 0) return false;

    await tx.insert(auditLog).values({
      orgId: session.orgId,
      actorUserId: session.userId,
      action: "transaction.memo_updated",
      targetId: transactionId,
    });
    return true;
  });

  if (!updated) return { status: "error", message: "That transaction wasn't found." };

  revalidatePath("/transactions");
  return { status: "saved" };
}
