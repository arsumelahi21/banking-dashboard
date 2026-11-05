import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import type { Db, Tx } from "@/server/db/client";
import { accounts, auditLog, ledgerEntries, transactions } from "@/server/db/schema";

export type LedgerErrorCode =
  | "INVALID_AMOUNT"
  | "SAME_ACCOUNT"
  | "ACCOUNT_NOT_FOUND"
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

type TransferInput = {
  orgId: string;
  actorUserId: string;
  fromAccountId: string;
  toAccountId: string;
  amountCents: number;
  /** Generated once per user intent. Retries send the same key. */
  idempotencyKey: string;
  memo?: string;
};

type TransferResult = { transactionId: string; replayed: boolean };

/**
 * Moves money between two of an organization's own accounts.
 *
 * Runs in one database transaction: either everything happens or nothing does.
 * Locking both accounts makes concurrent transfers wait their turn, so two of
 * them can't both spend the same balance. Locks are taken in a fixed order so
 * opposite transfers can't deadlock.
 */
export async function transferBetweenAccounts(db: Db, input: TransferInput): Promise<TransferResult> {
  const { orgId, actorUserId, fromAccountId, toAccountId, amountCents, idempotencyKey, memo } = input;

  if (!Number.isSafeInteger(amountCents) || amountCents <= 0 || amountCents > MAX_TRANSFER_CENTS) {
    throw new LedgerError("INVALID_AMOUNT");
  }
  if (fromAccountId === toAccountId) throw new LedgerError("SAME_ACCOUNT");

  const fingerprint = createHash("sha256")
    .update(`${fromAccountId}|${toAccountId}|${amountCents}`)
    .digest("hex");

  return db.transaction(async (tx) => {
    const locked = await tx
      .select({ id: accounts.id, name: accounts.name })
      .from(accounts)
      .where(
        and(
          eq(accounts.orgId, orgId),
          ne(accounts.kind, "external"),
          inArray(accounts.id, [fromAccountId, toAccountId]),
        ),
      )
      .orderBy(asc(accounts.id))
      .for("update");

    const from = locked.find((account) => account.id === fromAccountId);
    const to = locked.find((account) => account.id === toAccountId);
    // Same error for "doesn't exist" and "belongs to someone else", to reveal nothing.
    if (!from || !to) throw new LedgerError("ACCOUNT_NOT_FOUND");

    const [existing] = await tx
      .select({ id: transactions.id, fingerprint: transactions.idempotencyFingerprint })
      .from(transactions)
      .where(and(eq(transactions.orgId, orgId), eq(transactions.idempotencyKey, idempotencyKey)));
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw new LedgerError("IDEMPOTENCY_CONFLICT");
      return { transactionId: existing.id, replayed: true };
    }

    const balances = await getAccountBalances(tx, orgId);
    const available = balances.find((account) => account.id === fromAccountId)?.availableCents ?? 0;
    if (available < amountCents) throw new LedgerError("INSUFFICIENT_FUNDS");

    const transactionId = randomUUID();
    const inserted = await tx
      .insert(transactions)
      .values({
        id: transactionId,
        orgId,
        status: "posted",
        method: "transfer",
        description: `Transfer to ${to.name}`,
        counterparty: `${from.name} to ${to.name}`,
        category: "Internal transfer",
        memo,
        occurredAt: new Date(),
        idempotencyKey,
        idempotencyFingerprint: fingerprint,
      })
      .onConflictDoNothing({ target: [transactions.orgId, transactions.idempotencyKey] })
      .returning({ id: transactions.id });
    // Same key used concurrently for different accounts, so the locks didn't overlap.
    if (inserted.length === 0) throw new LedgerError("IDEMPOTENCY_CONFLICT");

    await tx.insert(ledgerEntries).values([
      { orgId, transactionId, accountId: fromAccountId, amountCents: -amountCents },
      { orgId, transactionId, accountId: toAccountId, amountCents },
    ]);

    await tx.insert(auditLog).values({
      orgId,
      actorUserId,
      action: "transfer.created",
      targetId: transactionId,
      metadata: { amountCents, fromAccountId, toAccountId },
    });

    return { transactionId, replayed: false };
  });
}
