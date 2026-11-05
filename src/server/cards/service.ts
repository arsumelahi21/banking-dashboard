import "server-only";
import { and, eq } from "drizzle-orm";
import type { Db } from "@/server/db/client";
import { auditLog, cards } from "@/server/db/schema";

type Actor = { orgId: string; userId: string };

/** Returns false for a card that doesn't exist or belongs to another organization, alike. */
export async function setCardStatus(db: Db, actor: Actor, cardId: string, status: "active" | "frozen"): Promise<boolean> {
  return db.transaction(async (tx) => {
    const updated = await tx
      .update(cards)
      .set({ status })
      .where(and(eq(cards.id, cardId), eq(cards.orgId, actor.orgId)))
      .returning({ id: cards.id });
    if (updated.length === 0) return false;

    await tx.insert(auditLog).values({
      orgId: actor.orgId,
      actorUserId: actor.userId,
      action: status === "frozen" ? "card.frozen" : "card.unfrozen",
      targetId: cardId,
    });
    return true;
  });
}

export async function setCardLimit(db: Db, actor: Actor, cardId: string, monthlyLimitCents: number): Promise<boolean> {
  return db.transaction(async (tx) => {
    // Read under a lock, so the audit trail records the true previous limit.
    const [current] = await tx
      .select({ limit: cards.monthlyLimitCents })
      .from(cards)
      .where(and(eq(cards.id, cardId), eq(cards.orgId, actor.orgId)))
      .for("update");
    if (!current) return false;

    await tx.update(cards).set({ monthlyLimitCents }).where(eq(cards.id, cardId));
    await tx.insert(auditLog).values({
      orgId: actor.orgId,
      actorUserId: actor.userId,
      action: "card.limit_changed",
      targetId: cardId,
      metadata: { previousCents: current.limit, newCents: monthlyLimitCents },
    });
    return true;
  });
}
