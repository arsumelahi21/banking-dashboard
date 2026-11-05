import "server-only";
import { and, desc, eq, gte, ne, sql } from "drizzle-orm";
import { buildDailyBalances, computeRunway, fillMonths, startOfMonth, type MonthFlow } from "@/lib/metrics";
import type { Db } from "@/server/db/client";
import { accounts, ledgerEntries, transactions } from "@/server/db/schema";
import { getAccountBalances } from "@/server/ledger/ledger";

const MONTHS = 12;
const RECENT_LIMIT = 6;

const owned = sql`${accounts.kind} <> 'external'`;

/** Every query is scoped to `orgId`, which callers take from the verified session. */
export async function getOverview(db: Db, orgId: string, now = new Date()) {
  const start = startOfMonth(now, MONTHS - 1);

  const [balances, monthRows, dayRows, recent] = await Promise.all([
    getAccountBalances(db, orgId),

    // Real money in and out of the business: internal transfers and investor
    // funding would make both revenue and burn look wrong.
    db
      .select({
        month: sql<string>`to_char(${transactions.occurredAt} at time zone 'UTC', 'YYYY-MM')`,
        inCents: sql`coalesce(sum(${ledgerEntries.amountCents}) filter (where ${ledgerEntries.amountCents} > 0), 0)::bigint`.mapWith(Number),
        outCents: sql`coalesce(-sum(${ledgerEntries.amountCents}) filter (where ${ledgerEntries.amountCents} < 0), 0)::bigint`.mapWith(Number),
      })
      .from(ledgerEntries)
      .innerJoin(transactions, eq(transactions.id, ledgerEntries.transactionId))
      .innerJoin(accounts, eq(accounts.id, ledgerEntries.accountId))
      .where(
        and(
          eq(ledgerEntries.orgId, orgId),
          owned,
          eq(transactions.status, "posted"),
          ne(transactions.method, "transfer"),
          ne(transactions.category, "Financing"),
          gte(transactions.occurredAt, start),
        ),
      )
      .groupBy(sql`1`),

    // All time, because the opening balance depends on everything before the chart starts.
    db
      .select({
        date: sql<string>`to_char(${transactions.occurredAt} at time zone 'UTC', 'YYYY-MM-DD')`,
        netCents: sql`sum(${ledgerEntries.amountCents})::bigint`.mapWith(Number),
      })
      .from(ledgerEntries)
      .innerJoin(transactions, eq(transactions.id, ledgerEntries.transactionId))
      .innerJoin(accounts, eq(accounts.id, ledgerEntries.accountId))
      .where(and(eq(ledgerEntries.orgId, orgId), owned, eq(transactions.status, "posted")))
      .groupBy(sql`1`),

    db
      .select({
        id: transactions.id,
        counterparty: transactions.counterparty,
        description: transactions.description,
        method: transactions.method,
        status: transactions.status,
        occurredAt: transactions.occurredAt,
        netCents: sql`coalesce(sum(${ledgerEntries.amountCents}) filter (where ${owned}), 0)::bigint`.mapWith(Number),
        movedCents: sql`coalesce(max(${ledgerEntries.amountCents}) filter (where ${owned}), 0)::bigint`.mapWith(Number),
      })
      .from(transactions)
      .innerJoin(ledgerEntries, eq(ledgerEntries.transactionId, transactions.id))
      .innerJoin(accounts, eq(accounts.id, ledgerEntries.accountId))
      .where(eq(transactions.orgId, orgId))
      .groupBy(transactions.id)
      .orderBy(desc(transactions.occurredAt))
      .limit(RECENT_LIMIT),
  ]);

  const months: MonthFlow[] = fillMonths(monthRows, now, MONTHS);
  const totalCents = balances.reduce((sum, account) => sum + account.balanceCents, 0);
  const availableCents = balances.reduce((sum, account) => sum + account.availableCents, 0);

  return {
    accounts: balances,
    totalCents,
    availableCents,
    months,
    // Starts a day early: the close of that day is the 12-month opening balance.
    daily: buildDailyBalances(dayRows, new Date(start.getTime() - 24 * 60 * 60 * 1000), now),
    // The last row is the month in progress, which isn't a complete picture of spending.
    runway: computeRunway(totalCents, months.slice(0, -1)),
    recent: recent.map(({ netCents, movedCents, ...row }) => ({
      ...row,
      // An internal transfer nets to zero, so show the amount that moved, unsigned.
      amountCents: row.method === "transfer" ? movedCents : netCents,
      signed: row.method !== "transfer",
    })),
  };
}

export type Overview = Awaited<ReturnType<typeof getOverview>>;
