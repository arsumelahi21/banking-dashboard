import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, gte, inArray, ne, sql } from "drizzle-orm";
import type { Db, Tx } from "@/server/db/client";
import { accounts, auditLog, cards, ledgerEntries, recipients, transactions } from "@/server/db/schema";

export type LedgerErrorCode =
  | "INVALID_AMOUNT"
  | "SAME_ACCOUNT"
  | "ACCOUNT_NOT_FOUND"
  | "RECIPIENT_NOT_FOUND"
  | "CARD_NOT_FOUND"
  | "CARD_FROZEN"
  | "CARD_LIMIT_EXCEEDED"
  | "INSUFFICIENT_FUNDS"
  | "IDEMPOTENCY_CONFLICT";

export class LedgerError extends Error {
  constructor(readonly code: LedgerErrorCode) {
    super(code);
    this.name = "LedgerError";
  }
}

/** Far above any demo balance. Stops absurd values before they reach arithmetic. */
const MAX_TRANSFER_CENTS = 100_000_000_00;

const postedSum = sql`coalesce(sum(${ledgerEntries.amountCents}) filter (where ${transactions.status} = 'posted'), 0)`;
const pendingOutflowSum = sql`coalesce(sum(${ledgerEntries.amountCents}) filter (where ${transactions.status} = 'pending' and ${ledgerEntries.amountCents} < 0), 0)`;

/**
 * Balances are always calculated from the ledger, never stored, so they can't
 * drift. "Available" also subtracts money already on its way out.
 */
export async function getAccountBalances(db: Db | Tx, orgId: string) {
  return db
    .select({
      id: accounts.id,
      name: accounts.name,
      kind: accounts.kind,
      numberLast4: accounts.numberLast4,
      currency: accounts.currency,
      balanceCents: sql`(${postedSum})::bigint`.mapWith(Number),
      availableCents: sql`(${postedSum} + ${pendingOutflowSum})::bigint`.mapWith(Number),
    })
    .from(accounts)
    .leftJoin(ledgerEntries, eq(ledgerEntries.accountId, accounts.id))
    .leftJoin(transactions, eq(transactions.id, ledgerEntries.transactionId))
    .where(and(eq(accounts.orgId, orgId), ne(accounts.kind, "external")))
    .groupBy(accounts.id)
    .orderBy(asc(accounts.createdAt), asc(accounts.name));
}

type MovementBase = {
  orgId: string;
  actorUserId: string | null;
  fromAccountId: string;
  amountCents: number;
  /** Generated once per user intent. Retries send the same key. */
  idempotencyKey: string;
  memo?: string;
  /**
   * Runs inside the same database transaction, only when money actually moves. If
   * it throws, the whole payment rolls back, so linked changes can't come apart.
   */
  onPosted?: (tx: Tx, transactionId: string) => Promise<void>;
};

type TransferInput = MovementBase & { toAccountId: string };
type RecipientPaymentInput = MovementBase & { recipientId: string; method: "ach" | "wire" };
type TransferResult = { transactionId: string; replayed: boolean };

type Destination =
  | { type: "account"; toAccountId: string }
  | { type: "recipient"; recipientId: string; method: "ach" | "wire" }
  | { type: "card"; cardId: string; merchant: string };

const fingerprintOf = (fromAccountId: string, destinationKey: string, amountCents: number) =>
  createHash("sha256").update(`${fromAccountId}|${destinationKey}|${amountCents}`).digest("hex");

const destinationKeyOf = (destination: Destination) => {
  switch (destination.type) {
    case "account":
      return destination.toAccountId;
    case "recipient":
      return `${destination.recipientId}|${destination.method}`;
    case "card":
      return `card:${destination.cardId}|${destination.merchant}`;
  }
};

/**
 * Net card spending this calendar month, including money still pending, because
 * that's already committed. Refunds give room back. Declined purchases don't count.
 */
export async function cardMonthSpendCents(db: Db | Tx, orgId: string, cardId: string, now = new Date()): Promise<number> {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [row] = await db
    .select({ net: sql`coalesce(sum(${ledgerEntries.amountCents}), 0)::bigint`.mapWith(Number) })
    .from(ledgerEntries)
    .innerJoin(transactions, eq(transactions.id, ledgerEntries.transactionId))
    .innerJoin(accounts, eq(accounts.id, ledgerEntries.accountId))
    .where(
      and(
        eq(ledgerEntries.orgId, orgId),
        eq(transactions.cardId, cardId),
        ne(accounts.kind, "external"),
        inArray(transactions.status, ["posted", "pending"]),
        gte(transactions.occurredAt, monthStart),
      ),
    );
  return Math.max(0, -(row?.net ?? 0));
}

function assertValidAmount(amountCents: number) {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0 || amountCents > MAX_TRANSFER_CENTS) {
    throw new LedgerError("INVALID_AMOUNT");
  }
}

/**
 * The one code path that moves money.
 *
 * Runs in one database transaction: either everything happens or nothing does.
 * Locking the owned accounts makes concurrent payments wait their turn, so two of
 * them can't both spend the same balance. Locks are taken in a fixed order so
 * opposite transfers can't deadlock.
 */
async function moveMoney(db: Db, input: MovementBase, destination: Destination): Promise<TransferResult> {
  const { orgId, actorUserId, fromAccountId, amountCents, idempotencyKey, memo, onPosted } = input;
  assertValidAmount(amountCents);

  const fingerprint = fingerprintOf(fromAccountId, destinationKeyOf(destination), amountCents);
  const ownedIds = destination.type === "account" ? [fromAccountId, destination.toAccountId] : [fromAccountId];

  return db.transaction(async (tx) => {
    const locked = await tx
      .select({ id: accounts.id, name: accounts.name })
      .from(accounts)
      .where(and(eq(accounts.orgId, orgId), ne(accounts.kind, "external"), inArray(accounts.id, ownedIds)))
      .orderBy(asc(accounts.id))
      .for("update");

    const from = locked.find((account) => account.id === fromAccountId);
    // Same error for "doesn't exist" and "belongs to someone else", to reveal nothing.
    if (!from) throw new LedgerError("ACCOUNT_NOT_FOUND");

    let creditAccountId: string;
    let details: Pick<typeof transactions.$inferInsert, "status" | "method" | "description" | "counterparty" | "category" | "cardId">;
    let card: { id: string; status: "active" | "frozen"; monthlyLimitCents: number } | undefined;

    if (destination.type === "account") {
      const to = locked.find((account) => account.id === destination.toAccountId);
      if (!to) throw new LedgerError("ACCOUNT_NOT_FOUND");
      creditAccountId = to.id;
      details = {
        status: "posted",
        method: "transfer",
        description: `Transfer to ${to.name}`,
        counterparty: `${from.name} to ${to.name}`,
        category: "Internal transfer",
      };
    } else if (destination.type === "card") {
      // Locked so concurrent purchases are counted one at a time against the limit.
      [card] = await tx
        .select({ id: cards.id, status: cards.status, monthlyLimitCents: cards.monthlyLimitCents })
        .from(cards)
        .where(and(eq(cards.orgId, orgId), eq(cards.id, destination.cardId), eq(cards.accountId, fromAccountId)))
        .for("update");
      if (!card) throw new LedgerError("CARD_NOT_FOUND");

      const [external] = await tx
        .select({ id: accounts.id })
        .from(accounts)
        .where(and(eq(accounts.orgId, orgId), eq(accounts.kind, "external")));
      if (!external) throw new LedgerError("ACCOUNT_NOT_FOUND");

      creditAccountId = external.id;
      details = {
        status: "pending",
        method: "card",
        description: destination.merchant,
        counterparty: destination.merchant,
        category: "Card purchases",
        cardId: card.id,
      };
    } else {
      const [recipient] = await tx
        .select({ name: recipients.name })
        .from(recipients)
        .where(and(eq(recipients.orgId, orgId), eq(recipients.id, destination.recipientId)));
      if (!recipient) throw new LedgerError("RECIPIENT_NOT_FOUND");

      const [external] = await tx
        .select({ id: accounts.id })
        .from(accounts)
        .where(and(eq(accounts.orgId, orgId), eq(accounts.kind, "external")));
      if (!external) throw new LedgerError("ACCOUNT_NOT_FOUND");

      creditAccountId = external.id;
      details = {
        // Wires settle the same day. ACH stays pending, holding the funds until it settles.
        status: destination.method === "wire" ? "posted" : "pending",
        method: destination.method,
        description: `Payment to ${recipient.name}`,
        counterparty: recipient.name,
        category: "Payments",
      };
    }

    const [existing] = await tx
      .select({ id: transactions.id, fingerprint: transactions.idempotencyFingerprint })
      .from(transactions)
      .where(and(eq(transactions.orgId, orgId), eq(transactions.idempotencyKey, idempotencyKey)));
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw new LedgerError("IDEMPOTENCY_CONFLICT");
      return { transactionId: existing.id, replayed: true };
    }

    if (card) {
      if (card.status === "frozen") throw new LedgerError("CARD_FROZEN");
      const spent = await cardMonthSpendCents(tx, orgId, card.id);
      if (spent + amountCents > card.monthlyLimitCents) throw new LedgerError("CARD_LIMIT_EXCEEDED");
    }

    const balances = await getAccountBalances(tx, orgId);
    const available = balances.find((account) => account.id === fromAccountId)?.availableCents ?? 0;
    if (available < amountCents) throw new LedgerError("INSUFFICIENT_FUNDS");

    const transactionId = randomUUID();
    const inserted = await tx
      .insert(transactions)
      .values({
        ...details,
        id: transactionId,
        orgId,
        memo: memo || null,
        occurredAt: new Date(),
        idempotencyKey,
        idempotencyFingerprint: fingerprint,
      })
      .onConflictDoNothing({ target: [transactions.orgId, transactions.idempotencyKey] })
      .returning({ id: transactions.id });
    // Same key used concurrently with different details, so the locks didn't overlap.
    if (inserted.length === 0) throw new LedgerError("IDEMPOTENCY_CONFLICT");

    await tx.insert(ledgerEntries).values([
      { orgId, transactionId, accountId: fromAccountId, amountCents: -amountCents },
      { orgId, transactionId, accountId: creditAccountId, amountCents },
    ]);

    await tx.insert(auditLog).values({
      orgId,
      actorUserId,
      action: { account: "transfer.created", recipient: "payment.created", card: "card.purchase_approved" }[destination.type],
      targetId: transactionId,
      metadata:
        destination.type === "account"
          ? { amountCents, fromAccountId, toAccountId: destination.toAccountId }
          : destination.type === "recipient"
            ? { amountCents, fromAccountId, recipientId: destination.recipientId, method: destination.method }
            : { amountCents, fromAccountId, cardId: destination.cardId },
    });

    await onPosted?.(tx, transactionId);

    return { transactionId, replayed: false };
  });
}

/** Moves money between two of an organization's own accounts. */
export async function transferBetweenAccounts(db: Db, { toAccountId, ...input }: TransferInput): Promise<TransferResult> {
  if (input.fromAccountId === toAccountId) {
    // Checked after the amount, so an invalid amount is always reported as such.
    assertValidAmount(input.amountCents);
    throw new LedgerError("SAME_ACCOUNT");
  }
  return moveMoney(db, input, { type: "account", toAccountId });
}

/** Sends money from an owned account to a saved recipient. */
export async function payRecipient(db: Db, { recipientId, method, ...input }: RecipientPaymentInput): Promise<TransferResult> {
  return moveMoney(db, input, { type: "recipient", recipientId, method });
}

const declineReasons = {
  CARD_FROZEN: "Declined: this card is frozen.",
  CARD_LIMIT_EXCEEDED: "Declined: over this card's monthly limit.",
  INSUFFICIENT_FUNDS: "Declined: not enough available funds.",
} as const;

export type CardPurchaseResult = { outcome: "approved" | "declined"; reason?: string; transactionId: string; replayed: boolean };

/**
 * Runs a card purchase through the same path as every other payment. A decline
 * rolls back and is then written down as a failed transaction, which moves no money
 * but leaves a record, the way a card statement does.
 */
export async function authorizeCardPurchase(
  db: Db,
  input: Omit<MovementBase, "fromAccountId" | "onPosted"> & { cardId: string; merchant: string },
): Promise<CardPurchaseResult> {
  const { orgId, actorUserId, cardId, merchant, amountCents, idempotencyKey } = input;

  const [card] = await db
    .select({ accountId: cards.accountId })
    .from(cards)
    .where(and(eq(cards.orgId, orgId), eq(cards.id, cardId)));
  if (!card) throw new LedgerError("CARD_NOT_FOUND");
  const destination: Destination = { type: "card", cardId, merchant };

  try {
    const { transactionId, replayed } = await moveMoney(
      db,
      { orgId, actorUserId, amountCents, idempotencyKey, memo: input.memo, fromAccountId: card.accountId },
      destination,
    );
    if (!replayed) return { outcome: "approved", transactionId, replayed };

    // A retry returns what happened the first time, whether that was approved or declined.
    const [original] = await db.select({ status: transactions.status, memo: transactions.memo }).from(transactions).where(eq(transactions.id, transactionId));
    return original?.status === "failed"
      ? { outcome: "declined", reason: original.memo ?? undefined, transactionId, replayed }
      : { outcome: "approved", transactionId, replayed };
  } catch (error) {
    const code = error instanceof LedgerError ? error.code : null;
    if (code !== "CARD_FROZEN" && code !== "CARD_LIMIT_EXCEEDED" && code !== "INSUFFICIENT_FUNDS") throw error;

    const reason = declineReasons[code];
    return db.transaction(async (tx) => {
      // The same lock, in the same order, as every other money path. Inserting below
      // takes shared locks on the card and account, which would otherwise deadlock
      // with an approval that holds the account and is waiting for the card.
      await tx.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, card.accountId)).for("update");

      const [external] = await tx
        .select({ id: accounts.id })
        .from(accounts)
        .where(and(eq(accounts.orgId, orgId), eq(accounts.kind, "external")));

      const transactionId = randomUUID();
      const inserted = await tx
        .insert(transactions)
        .values({
          id: transactionId,
          orgId,
          status: "failed",
          method: "card",
          description: merchant,
          counterparty: merchant,
          category: "Card purchases",
          cardId,
          memo: reason,
          occurredAt: new Date(),
          idempotencyKey,
          idempotencyFingerprint: fingerprintOf(card.accountId, destinationKeyOf(destination), amountCents),
        })
        .onConflictDoNothing({ target: [transactions.orgId, transactions.idempotencyKey] })
        .returning({ id: transactions.id });

      // The same declined purchase was already recorded by a request running alongside this one.
      if (inserted.length === 0) {
        const [existing] = await tx
          .select({ id: transactions.id })
          .from(transactions)
          .where(and(eq(transactions.orgId, orgId), eq(transactions.idempotencyKey, idempotencyKey)));
        return { outcome: "declined" as const, reason, transactionId: existing!.id, replayed: true };
      }

      await tx.insert(ledgerEntries).values([
        { orgId, transactionId, accountId: card.accountId, amountCents: -amountCents },
        { orgId, transactionId, accountId: external!.id, amountCents },
      ]);
      await tx.insert(auditLog).values({
        orgId,
        actorUserId,
        action: "card.purchase_declined",
        targetId: transactionId,
        metadata: { amountCents, cardId, reason: code },
      });
      return { outcome: "declined" as const, reason, transactionId, replayed: false };
    });
  }
}
