import "server-only";
import { and, eq } from "drizzle-orm";
import type { Db } from "@/server/db/client";
import { auditLog, transactions } from "@/server/db/schema";

/**
 * The organization is part of the update, so another customer's id changes nothing.
 * Returns false when no transaction matched, whichever reason that was.
 */
export async function setTransactionMemo(
  db: Db,
  actor: { orgId: string; userId: string },
  transactionId: string,
  memo: string,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .update(transactions)
      .set({ memo: memo || null })
      .where(and(eq(transactions.id, transactionId), eq(transactions.orgId, actor.orgId)))
      .returning({ id: transactions.id });
    if (rows.length === 0) return false;

    await tx.insert(auditLog).values({
      orgId: actor.orgId,
      actorUserId: actor.userId,
      action: "transaction.memo_updated",
      targetId: transactionId,
    });
    return true;
  });
}
