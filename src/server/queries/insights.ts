import "server-only";
import { and, eq, gte, lt, ne, sql } from "drizzle-orm";
import { startOfMonth } from "@/lib/metrics";
import type { SpendRow } from "@/lib/insights";
import type { Db } from "@/server/db/client";
import { accounts, ledgerEntries, transactions } from "@/server/db/schema";

const MONTHS = 12;

/**
 * Settled money out, by month, category and merchant. Deliberately the same rules
 * as "Money out" on the overview, so the two pages show the same number.
 */
export function getSpendRows(db: Db, orgId: string, now = new Date()): Promise<SpendRow[]> {
  return db
    .select({
      month: sql<string>`to_char(${transactions.occurredAt} at time zone 'UTC', 'YYYY-MM')`,
      category: transactions.category,
      counterparty: transactions.counterparty,
      cents: sql`-sum(${ledgerEntries.amountCents})::bigint`.mapWith(Number),
    })
    .from(ledgerEntries)
    .innerJoin(transactions, eq(transactions.id, ledgerEntries.transactionId))
    .innerJoin(accounts, eq(accounts.id, ledgerEntries.accountId))
    .where(
      and(
        eq(ledgerEntries.orgId, orgId),
        ne(accounts.kind, "external"),
        lt(ledgerEntries.amountCents, 0),
        eq(transactions.status, "posted"),
        ne(transactions.method, "transfer"),
        ne(transactions.category, "Financing"),
        gte(transactions.occurredAt, startOfMonth(now, MONTHS - 1)),
      ),
    )
    .groupBy(sql`1`, transactions.category, transactions.counterparty);
}
