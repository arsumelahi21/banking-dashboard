import "server-only";
import { randomUUID } from "node:crypto";
import { lt, sql } from "drizzle-orm";
import { dayKey, startOfMonth } from "@/lib/metrics";
import type { Db, Tx } from "@/server/db/client";
import {
  accounts,
  cards,
  ledgerEntries,
  organizations,
  rateLimits,
  recipients,
  scheduledPayments,
  transactions,
  users,
} from "@/server/db/schema";
import { generateActivity, seedAccounts, seedCards, seedRecipients, type AccountKey, type CardKey } from "./generate";

const WORKSPACE_NAME = "Fieldstone Studio";
const MAX_LINES_PER_INSERT = 1000;

type WorkspaceInput = {
  user: { email: string; name: string; passwordHash: string | null };
  expiresAt: Date | null;
  now?: Date;
};

/** Creates a complete workspace inside the caller's transaction, so it can't be half-made. */
export async function installWorkspace(tx: Tx, { user, expiresAt, now = new Date() }: WorkspaceInput) {
  const orgId = randomUUID();
  const userId = randomUUID();

  await tx.insert(organizations).values({ id: orgId, name: WORKSPACE_NAME, expiresAt });
  await tx.insert(users).values({ id: userId, orgId, ...user, role: "owner" });

  const accountIds = {} as Record<AccountKey, string>;
  const accountRows = seedAccounts.map(({ key, ...account }) => {
    const id = randomUUID();
    accountIds[key] = id;
    return { ...account, id, orgId };
  });
  await tx.insert(accounts).values(accountRows);

  const cardIds = {} as Record<CardKey, string>;
  const cardRows = seedCards.map(({ key, ...card }) => {
    const id = randomUUID();
    cardIds[key] = id;
    const accountId = accountIds.operating;
    return { ...card, id, orgId, accountId };
  });
  await tx.insert(cards).values(cardRows);
  const recipientRows = seedRecipients.map((recipient) => ({ ...recipient, id: randomUUID(), orgId }));
  await tx.insert(recipients).values(recipientRows);
  const recipientId = (name: string) => recipientRows.find((row) => row.name === name)!.id;

  const inDays = (days: number) => dayKey(new Date(now.getTime() + days * 24 * 60 * 60 * 1000));
  const base = { orgId, createdBy: userId, fromAccountId: accountIds.operating };
  await tx.insert(scheduledPayments).values([
    {
      ...base,
      recipientId: recipientId("Landmark Properties"),
      method: "ach",
      amountCents: 1_850_000,
      memo: "Office rent",
      // The first of next month, which is always in the future.
      scheduledFor: dayKey(startOfMonth(now, -1)),
      idempotencyKey: randomUUID(),
    },
    {
      ...base,
      recipientId: recipientId("Elena Vasquez Design"),
      method: "ach",
      amountCents: 620_000,
      memo: "Brand refresh, final invoice",
      scheduledFor: inDays(9),
      idempotencyKey: randomUUID(),
    },
    {
      ...base,
      toAccountId: accountIds.reserve,
      amountCents: 5_000_000,
      memo: "Quarterly move to reserve",
      scheduledFor: inDays(14),
      idempotencyKey: randomUUID(),
    },
  ]);

  const activity = generateActivity(now).map(({ lines, card, ...item }) => {
    const id = randomUUID();
    return {
      row: { ...item, id, orgId, cardId: card ? cardIds[card] : null },
      lines: lines.map((line) => ({
        orgId,
        transactionId: id,
        accountId: accountIds[line.account],
        amountCents: line.amountCents,
      })),
    };
  });

  await tx.insert(transactions).values(activity.map((item) => item.row));

  // The balance trigger checks each statement, so one transaction's lines must
  // never be split across two inserts.
  let batch: (typeof activity)[number]["lines"] = [];
  for (const { lines } of activity) {
    if (batch.length + lines.length > MAX_LINES_PER_INSERT) {
      await tx.insert(ledgerEntries).values(batch);
      batch = [];
    }
    batch.push(...lines);
  }
  if (batch.length > 0) await tx.insert(ledgerEntries).values(batch);

  return { orgId, userId };
}

/**
 * Removes expired demo workspaces and old rate limit counters. The ledger is
 * append-only, so this is the one place allowed to delete from it, using a
 * switch that only lasts for this transaction.
 */
export async function purgeExpired(db: Db | Tx, now = new Date()) {
  await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.allow_purge', 'on', true)`);
    await tx.execute(sql`
      delete from organizations where id in (
        select id from organizations
        where expires_at < ${now.toISOString()}::timestamptz
        limit 5
      )
    `);
    await tx.delete(rateLimits).where(lt(rateLimits.windowStart, new Date(now.getTime() - 24 * 60 * 60 * 1000)));
  });
}
