import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/server/db/client";
import { accounts, auditLog, cards, transactions } from "@/server/db/schema";
import { authorizeCardPurchase, getAccountBalances, LedgerError, transferBetweenAccounts } from "@/server/ledger/ledger";
import { listCards } from "@/server/queries/cards";
import { installWorkspace } from "@/server/seed/install";
import { setCardLimit, setCardStatus } from "./service";

type Workspace = { orgId: string; userId: string; cardId: string; operating: string; reserve: string };

async function createWorkspace(): Promise<Workspace> {
  const db = getDb();
  const { orgId, userId } = await db.transaction((tx) =>
    installWorkspace(tx, {
      user: { email: `test-${randomUUID()}@example.test`, name: "Test", passwordHash: null },
      expiresAt: null,
    }),
  );
  const [card] = await db.select().from(cards).where(and(eq(cards.orgId, orgId), eq(cards.label, "Travel")));
  const rows = await db.select().from(accounts).where(eq(accounts.orgId, orgId));
  return {
    orgId,
    userId,
    cardId: card!.id,
    operating: rows.find((row) => row.name === "Operating")!.id,
    reserve: rows.find((row) => row.name === "Reserve")!.id,
  };
}

const actor = (w: Workspace) => ({ orgId: w.orgId, userId: w.userId });
const purchase = (w: Workspace, amountCents: number, overrides: { idempotencyKey?: string; merchant?: string; cardId?: string } = {}) =>
  authorizeCardPurchase(getDb(), {
    orgId: w.orgId,
    actorUserId: w.userId,
    cardId: w.cardId,
    merchant: "Test Merchant",
    amountCents,
    idempotencyKey: randomUUID(),
    ...overrides,
  });
const operating = async (w: Workspace) => (await getAccountBalances(getDb(), w.orgId)).find((account) => account.id === w.operating)!;
const spentOn = async (w: Workspace) => (await listCards(getDb(), w.orgId)).find((card) => card.id === w.cardId)!.spentCents;

/** Sets the limit so exactly `roomCents` can still be spent this month. */
async function leaveRoom(w: Workspace, roomCents: number) {
  await setCardLimit(getDb(), actor(w), w.cardId, (await spentOn(w)) + roomCents);
}

describe("cards", () => {
  let a: Workspace;
  let b: Workspace;

  beforeAll(async () => {
    [a, b] = await Promise.all([createWorkspace(), createWorkspace()]);
  });

  afterAll(async () => {
    await closeDb();
  });

  it("approves a purchase, holds the funds and counts it toward the limit", async () => {
    const before = await operating(a);
    const spentBefore = await spentOn(a);
    await leaveRoom(a, 100_000);

    const result = await purchase(a, 2_500);

    expect(result.outcome).toBe("approved");
    const after = await operating(a);
    expect(after.balanceCents).toBe(before.balanceCents);
    expect(after.availableCents).toBe(before.availableCents - 2_500);
    expect(await spentOn(a)).toBe(spentBefore + 2_500);
  });

  describe("freezing", () => {
    it("declines every purchase while frozen and allows them again after", async () => {
      const w = await createWorkspace();
      await leaveRoom(w, 100_000);
      await setCardStatus(getDb(), actor(w), w.cardId, "frozen");
      const before = await operating(w);

      const declined = await purchase(w, 1_000);
      expect(declined).toMatchObject({ outcome: "declined", reason: expect.stringContaining("frozen") });
      expect(await operating(w)).toEqual(before);

      await setCardStatus(getDb(), actor(w), w.cardId, "active");
      expect((await purchase(w, 1_000)).outcome).toBe("approved");
    });

    it("records a decline as a failed transaction that moves no money", async () => {
      const w = await createWorkspace();
      await setCardStatus(getDb(), actor(w), w.cardId, "frozen");
      const spent = await spentOn(w);
      const { transactionId } = await purchase(w, 1_000, { merchant: "Declined Merchant" });

      const [row] = await getDb().select().from(transactions).where(eq(transactions.id, transactionId));
      expect(row).toMatchObject({ status: "failed", counterparty: "Declined Merchant", cardId: w.cardId });
      expect(await spentOn(w)).toBe(spent);

      const audits = await getDb().select().from(auditLog).where(eq(auditLog.targetId, transactionId));
      expect(audits[0]!.action).toBe("card.purchase_declined");
    });

    it("audits freezing and unfreezing", async () => {
      await setCardStatus(getDb(), actor(a), a.cardId, "frozen");
      await setCardStatus(getDb(), actor(a), a.cardId, "active");
      const actions = (await getDb().select().from(auditLog).where(eq(auditLog.targetId, a.cardId))).map((row) => row.action);
      expect(actions).toEqual(expect.arrayContaining(["card.frozen", "card.unfrozen"]));
    });
  });

  describe("monthly limits", () => {
    it("allows exactly up to the limit, and one cent over is declined", async () => {
      const w = await createWorkspace();
      await leaveRoom(w, 10_000);
      expect((await purchase(w, 10_001)).reason).toContain("limit");
      expect((await purchase(w, 10_000)).outcome).toBe("approved");
      expect((await purchase(w, 1)).reason).toContain("limit");
    });

    it("can't be beaten by simultaneous purchases", async () => {
      const w = await createWorkspace();
      await leaveRoom(w, 10_000);
      const spent = await spentOn(w);

      // Ten attempts at 40% of the room: exactly two can fit.
      const results = await Promise.all(Array.from({ length: 10 }, () => purchase(w, 4_000)));

      expect(results.filter((result) => result.outcome === "approved")).toHaveLength(2);
      expect(results.filter((result) => result.outcome === "declined")).toHaveLength(8);
      expect(await spentOn(w)).toBe(spent + 8_000);
    }, 30_000);

    it("records the previous and new limit in the audit log", async () => {
      const w = await createWorkspace();
      const [before] = await getDb().select().from(cards).where(eq(cards.id, w.cardId));
      await setCardLimit(getDb(), actor(w), w.cardId, 777_00);
      const [audit] = await getDb().select().from(auditLog).where(and(eq(auditLog.targetId, w.cardId), eq(auditLog.action, "card.limit_changed")));
      expect(audit!.metadata).toEqual({ previousCents: before!.monthlyLimitCents, newCents: 777_00 });
    });

    it("the database refuses a zero or negative limit", async () => {
      await expect(getDb().update(cards).set({ monthlyLimitCents: 0 }).where(eq(cards.id, a.cardId))).rejects.toThrow();
    });
  });

  it("declines when the account can't cover it, whatever the limit", async () => {
    const w = await createWorkspace();
    const { availableCents } = await operating(w);
    await transferBetweenAccounts(getDb(), {
      orgId: w.orgId,
      actorUserId: w.userId,
      fromAccountId: w.operating,
      toAccountId: w.reserve,
      amountCents: availableCents - 500,
      idempotencyKey: randomUUID(),
    });
    await leaveRoom(w, 100_000);
    expect((await purchase(w, 600)).reason).toContain("available funds");
    expect((await purchase(w, 500)).outcome).toBe("approved");
  });

  describe("retries", () => {
    it("charges once when an approved purchase is retried", async () => {
      const w = await createWorkspace();
      await leaveRoom(w, 100_000);
      const idempotencyKey = randomUUID();
      const before = await operating(w);
      const first = await purchase(w, 1_500, { idempotencyKey });
      const retry = await purchase(w, 1_500, { idempotencyKey });

      expect(retry).toMatchObject({ outcome: "approved", replayed: true, transactionId: first.transactionId });
      expect((await operating(w)).availableCents).toBe(before.availableCents - 1_500);
    });

    it("returns the original decline, even if the card has since been unfrozen", async () => {
      const w = await createWorkspace();
      await leaveRoom(w, 100_000);
      await setCardStatus(getDb(), actor(w), w.cardId, "frozen");
      const idempotencyKey = randomUUID();
      const first = await purchase(w, 1_000, { idempotencyKey });

      await setCardStatus(getDb(), actor(w), w.cardId, "active");
      const retry = await purchase(w, 1_000, { idempotencyKey });

      expect(retry).toMatchObject({ outcome: "declined", replayed: true, transactionId: first.transactionId });
      expect(retry.reason).toContain("frozen");
    });

    it("records one decline when the same request arrives twice at once", async () => {
      const w = await createWorkspace();
      await setCardStatus(getDb(), actor(w), w.cardId, "frozen");
      const idempotencyKey = randomUUID();
      const results = await Promise.all([purchase(w, 1_000, { idempotencyKey }), purchase(w, 1_000, { idempotencyKey })]);
      expect(results[0]!.transactionId).toBe(results[1]!.transactionId);
    });
  });

  describe("organization isolation", () => {
    it("can't freeze or change the limit of another organization's card", async () => {
      expect(await setCardStatus(getDb(), actor(a), b.cardId, "frozen")).toBe(false);
      expect(await setCardLimit(getDb(), actor(a), b.cardId, 1_000_00)).toBe(false);
      const [card] = await getDb().select().from(cards).where(eq(cards.id, b.cardId));
      expect(card!.status).toBe("active");
      expect(card!.monthlyLimitCents).not.toBe(1_000_00);
    });

    it("can't spend on another organization's card", async () => {
      await expect(purchase(a, 1_000, { cardId: b.cardId })).rejects.toMatchObject({ code: "CARD_NOT_FOUND" });
      await expect(purchase(a, 1_000, { cardId: b.cardId })).rejects.toBeInstanceOf(LedgerError);
    });

    it("lists only this organization's cards", async () => {
      const mine = await listCards(getDb(), a.orgId);
      expect(mine).toHaveLength(4);
      expect(mine.map((card) => card.id)).not.toContain(b.cardId);
    });
  });
});
