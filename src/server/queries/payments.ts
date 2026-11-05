import "server-only";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "@/server/db/client";
import { accounts, recipients, scheduledPayments } from "@/server/db/schema";
import { getAccountBalances } from "@/server/ledger/ledger";

export function listRecipients(db: Db, orgId: string) {
  return db
    .select({ id: recipients.id, name: recipients.name, bankName: recipients.bankName, numberLast4: recipients.numberLast4 })
    .from(recipients)
    .where(eq(recipients.orgId, orgId))
    .orderBy(asc(recipients.name));
}

/** Everything the payment form needs, limited to this organization. */
export async function getPaymentOptions(db: Db, orgId: string) {
  const [balances, recipientRows] = await Promise.all([getAccountBalances(db, orgId), listRecipients(db, orgId)]);
  return { accounts: balances, recipients: recipientRows };
}

export async function listScheduledPayments(db: Db, orgId: string) {
  const from = alias(accounts, "from_account");
  const to = alias(accounts, "to_account");

  return db
    .select({
      id: scheduledPayments.id,
      status: scheduledPayments.status,
      amountCents: scheduledPayments.amountCents,
      scheduledFor: scheduledPayments.scheduledFor,
      method: scheduledPayments.method,
      memo: scheduledPayments.memo,
      failureReason: scheduledPayments.failureReason,
      transactionId: scheduledPayments.transactionId,
      fromName: from.name,
      toName: sql<string>`coalesce(${to.name}, ${recipients.name})`,
    })
    .from(scheduledPayments)
    .innerJoin(from, eq(from.id, scheduledPayments.fromAccountId))
    .leftJoin(to, eq(to.id, scheduledPayments.toAccountId))
    .leftJoin(recipients, eq(recipients.id, scheduledPayments.recipientId))
    .where(and(eq(scheduledPayments.orgId, orgId)))
    .orderBy(sql`case when ${scheduledPayments.status} = 'scheduled' then 0 else 1 end`, asc(scheduledPayments.scheduledFor), desc(scheduledPayments.createdAt));
}

export type ScheduledPaymentRow = Awaited<ReturnType<typeof listScheduledPayments>>[number];
