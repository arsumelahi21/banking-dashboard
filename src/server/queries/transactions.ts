import "server-only";
import { and, asc, desc, eq, exists, gte, ilike, inArray, lte, lt, ne, or, sql, type SQL } from "drizzle-orm";
import type { TransactionFilters } from "@/lib/transaction-filters";
import type { Db } from "@/server/db/client";
import { accounts, cards, ledgerEntries, transactions } from "@/server/db/schema";

export const PAGE_SIZE = 25;
export const EXPORT_LIMIT = 10_000;

/** One row per transaction with what it did to this organization's own accounts. */
function ownedTotals(db: Db, orgId: string) {
  return db
    .select({
      transactionId: ledgerEntries.transactionId,
      netCents: sql<string>`sum(${ledgerEntries.amountCents})`.as("net_cents"),
      movedCents: sql<string>`max(abs(${ledgerEntries.amountCents}))`.as("moved_cents"),
      accountNames: sql<string>`string_agg(${accounts.name}, ' → ' order by ${ledgerEntries.amountCents})`.as("account_names"),
    })
    .from(ledgerEntries)
    .innerJoin(accounts, eq(accounts.id, ledgerEntries.accountId))
    .where(and(eq(ledgerEntries.orgId, orgId), ne(accounts.kind, "external")))
    .groupBy(ledgerEntries.transactionId)
    .as("totals");
}

/** Makes %, _ and \ literal, so a search for "100%" means exactly that. */
const escapeLike = (text: string) => text.replace(/[\\%_]/g, (character) => `\\${character}`);

function nextDay(date: string): Date {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() + 24 * 60 * 60 * 1000);
}

function buildConditions(orgId: string, filters: TransactionFilters, totals: ReturnType<typeof ownedTotals>, db: Db) {
  // The organization comes first and isn't optional: no filter can widen beyond it.
  const conditions: (SQL | undefined)[] = [eq(transactions.orgId, orgId)];

  if (filters.q) {
    const pattern = `%${escapeLike(filters.q)}%`;
    conditions.push(
      or(
        ilike(transactions.counterparty, pattern),
        ilike(transactions.description, pattern),
        ilike(transactions.category, pattern),
        ilike(transactions.memo, pattern),
      ),
    );
  }
  if (filters.status) conditions.push(eq(transactions.status, filters.status));
  if (filters.method) conditions.push(eq(transactions.method, filters.method));
  if (filters.category) conditions.push(eq(transactions.category, filters.category));
  if (filters.cardId) conditions.push(eq(transactions.cardId, filters.cardId));
  if (filters.from) conditions.push(gte(transactions.occurredAt, new Date(`${filters.from}T00:00:00Z`)));
  if (filters.to) conditions.push(lt(transactions.occurredAt, nextDay(filters.to)));

  if (filters.direction === "in") conditions.push(sql`${totals.netCents} > 0`);
  if (filters.direction === "out") conditions.push(sql`${totals.netCents} < 0`);
  if (filters.minCents !== undefined) conditions.push(gte(totals.movedCents, String(filters.minCents)));
  if (filters.maxCents !== undefined) conditions.push(lte(totals.movedCents, String(filters.maxCents)));

  if (filters.accountId) {
    conditions.push(
      exists(
        db
          .select({ one: sql`1` })
          .from(ledgerEntries)
          .where(
            and(
              eq(ledgerEntries.orgId, orgId),
              eq(ledgerEntries.transactionId, transactions.id),
              eq(ledgerEntries.accountId, filters.accountId),
            ),
          ),
      ),
    );
  }

  return and(...conditions);
}

const toAmount = (row: { method: string; netCents: string; movedCents: string }) =>
  // An internal transfer nets to zero, so show the amount that moved, unsigned.
  row.method === "transfer"
    ? { amountCents: Number(row.movedCents), signed: false }
    : { amountCents: Number(row.netCents), signed: true };

type Page = { limit: number; offset: number };

async function selectRows(db: Db, orgId: string, filters: TransactionFilters, { limit, offset }: Page) {
  const totals = ownedTotals(db, orgId);
  const rows = await db
    .select({
      id: transactions.id,
      occurredAt: transactions.occurredAt,
      description: transactions.description,
      counterparty: transactions.counterparty,
      category: transactions.category,
      method: transactions.method,
      status: transactions.status,
      memo: transactions.memo,
      accountNames: totals.accountNames,
      netCents: totals.netCents,
      movedCents: totals.movedCents,
    })
    .from(transactions)
    .innerJoin(totals, eq(totals.transactionId, transactions.id))
    .where(buildConditions(orgId, filters, totals, db))
    // The id breaks ties, so rows can't repeat or vanish between pages.
    .orderBy(desc(transactions.occurredAt), asc(transactions.id))
    .limit(limit)
    .offset(offset);

  return rows.map(({ netCents, movedCents, ...row }) => ({
    ...row,
    ...toAmount({ method: row.method, netCents, movedCents }),
  }));
}

export type TransactionRow = Awaited<ReturnType<typeof selectRows>>[number];

export async function listTransactions(db: Db, orgId: string, filters: TransactionFilters) {
  const totals = ownedTotals(db, orgId);
  const [rows, [summary]] = await Promise.all([
    selectRows(db, orgId, filters, { limit: PAGE_SIZE, offset: (filters.page - 1) * PAGE_SIZE }),
    db
      .select({
        count: sql`count(*)`.mapWith(Number),
        // Only settled, real money: declined cards and internal transfers would mislead.
        inCents: sql`coalesce(sum(${totals.netCents}) filter (where ${transactions.status} = 'posted' and ${transactions.method} <> 'transfer' and ${totals.netCents} > 0), 0)::bigint`.mapWith(Number),
        outCents: sql`coalesce(-sum(${totals.netCents}) filter (where ${transactions.status} = 'posted' and ${transactions.method} <> 'transfer' and ${totals.netCents} < 0), 0)::bigint`.mapWith(Number),
      })
      .from(transactions)
      .innerJoin(totals, eq(totals.transactionId, transactions.id))
      .where(buildConditions(orgId, filters, totals, db)),
  ]);

  return { rows, total: summary?.count ?? 0, inCents: summary?.inCents ?? 0, outCents: summary?.outCents ?? 0 };
}

/** Newest first, up to a fixed limit, so one request can't exhaust the server. */
export function exportTransactions(db: Db, orgId: string, filters: TransactionFilters) {
  return selectRows(db, orgId, filters, { limit: EXPORT_LIMIT, offset: 0 });
}

/** Money sent out of the business or moved between accounts, newest first. */
export async function listRecentPayments(db: Db, orgId: string, limit = 8) {
  const totals = ownedTotals(db, orgId);
  const rows = await db
    .select({
      id: transactions.id,
      occurredAt: transactions.occurredAt,
      description: transactions.description,
      counterparty: transactions.counterparty,
      method: transactions.method,
      status: transactions.status,
      netCents: totals.netCents,
      movedCents: totals.movedCents,
    })
    .from(transactions)
    .innerJoin(totals, eq(totals.transactionId, transactions.id))
    .where(
      and(
        eq(transactions.orgId, orgId),
        inArray(transactions.method, ["ach", "wire", "transfer"]),
        or(eq(transactions.method, "transfer"), sql`${totals.netCents} < 0`),
      ),
    )
    .orderBy(desc(transactions.occurredAt), asc(transactions.id))
    .limit(limit);

  return rows.map(({ netCents, movedCents, ...row }) => ({
    ...row,
    ...toAmount({ method: row.method, netCents, movedCents }),
  }));
}

/** Returns null for a transaction that doesn't exist or belongs to someone else, alike. */
export async function getTransaction(db: Db, orgId: string, id: string) {
  const [row] = await db
    .select({
      transaction: transactions,
      cardLabel: cards.label,
      cardLast4: cards.numberLast4,
      cardHolder: cards.holderName,
    })
    .from(transactions)
    .leftJoin(cards, eq(cards.id, transactions.cardId))
    .where(and(eq(transactions.orgId, orgId), eq(transactions.id, id)));
  if (!row) return null;

  const lines = await db
    .select({
      id: ledgerEntries.id,
      accountName: accounts.name,
      accountKind: accounts.kind,
      numberLast4: accounts.numberLast4,
      amountCents: ledgerEntries.amountCents,
    })
    .from(ledgerEntries)
    .innerJoin(accounts, eq(accounts.id, ledgerEntries.accountId))
    .where(and(eq(ledgerEntries.orgId, orgId), eq(ledgerEntries.transactionId, id)))
    .orderBy(asc(ledgerEntries.amountCents));

  const { idempotencyKey: _key, idempotencyFingerprint: _fingerprint, ...transaction } = row.transaction;
  const owned = lines.filter((line) => line.accountKind !== "external");
  const net = owned.reduce((sum, line) => sum + line.amountCents, 0);

  return {
    ...transaction,
    card: row.cardLabel ? { label: row.cardLabel, last4: row.cardLast4!, holder: row.cardHolder! } : null,
    lines,
    amountCents: transaction.method === "transfer" ? Math.max(...owned.map((line) => line.amountCents)) : net,
    signed: transaction.method !== "transfer",
  };
}

export type TransactionDetail = NonNullable<Awaited<ReturnType<typeof getTransaction>>>;

/** The options for the filter menus, taken from this organization's own data. */
export async function getTransactionFacets(db: Db, orgId: string) {
  const [categories, accountRows, cardRows] = await Promise.all([
    db
      .selectDistinct({ category: transactions.category })
      .from(transactions)
      .where(eq(transactions.orgId, orgId))
      .orderBy(asc(transactions.category)),
    db
      .select({ id: accounts.id, name: accounts.name })
      .from(accounts)
      .where(and(eq(accounts.orgId, orgId), ne(accounts.kind, "external")))
      .orderBy(asc(accounts.name)),
    db
      .select({ id: cards.id, label: cards.label, numberLast4: cards.numberLast4 })
      .from(cards)
      .where(eq(cards.orgId, orgId))
      .orderBy(asc(cards.label)),
  ]);
  return { categories: categories.map((row) => row.category), accounts: accountRows, cards: cardRows };
}
