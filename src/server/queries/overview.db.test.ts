import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RANGES, viewRange } from "@/lib/metrics";
import { closeDb, getDb } from "@/server/db/client";
import { accounts, transactions } from "@/server/db/schema";
import { transferBetweenAccounts } from "@/server/ledger/ledger";
import { installWorkspace } from "@/server/seed/install";
import { getOverview, type Overview } from "./overview";

const create = () =>
  getDb().transaction((tx) =>
    installWorkspace(tx, {
      user: { email: `test-${randomUUID()}@example.test`, name: "Test", passwordHash: null },
      expiresAt: null,
    }),
  );

describe("getOverview", () => {
  let org: { orgId: string; userId: string };
  let overview: Overview;

  beforeAll(async () => {
    org = await create();
    overview = await getOverview(getDb(), org.orgId);
  });

  afterAll(async () => {
    await closeDb();
  });

  it("ends the balance chart exactly on the total cash figure", () => {
    expect(overview.totalCents).toBeGreaterThan(0);
    expect(overview.daily.at(-1)!.balanceCents).toBe(overview.totalCents);
  });

  it.each(RANGES)("reconciles the change in cash with net cash flow over $label", ({ months }) => {
    const view = viewRange(overview.months, overview.daily, months);
    expect(overview.totalCents - view.openingCents).toBe(view.flows.netCents);
  });

  it("agrees with the raw ledger", async () => {
    const rows = await getDb().execute<{ total: string }>(sql`
      select sum(l.amount_cents)::bigint as total
      from ledger_entries l
      join transactions t on t.id = l.transaction_id
      join accounts a on a.id = l.account_id
      where l.org_id = ${org.orgId} and a.kind <> 'external' and t.status = 'posted'
    `);
    expect(overview.totalCents).toBe(Number(rows[0]!.total));
  });

  it("returns twelve months and at least 330 days, oldest first", () => {
    expect(overview.months).toHaveLength(12);
    expect(overview.daily.length).toBeGreaterThan(330);
    expect(overview.months.map((month) => month.month)).toEqual([...overview.months.map((month) => month.month)].sort());
  });

  it("doesn't count internal transfers as money in or out", async () => {
    const db = getDb();
    const { orgId, userId } = await create();
    const rows = await db.select().from(accounts).where(eq(accounts.orgId, orgId));
    const idOf = (name: string) => rows.find((row) => row.name === name)!.id;
    const before = await getOverview(db, orgId);

    await transferBetweenAccounts(db, {
      orgId,
      actorUserId: userId,
      fromAccountId: idOf("Operating"),
      toAccountId: idOf("Reserve"),
      amountCents: 5_000_000,
      idempotencyKey: randomUUID(),
    });
    const after = await getOverview(db, orgId);

    expect(after.months).toEqual(before.months);
    expect(after.totalCents).toBe(before.totalCents);
    expect(after.recent[0]).toMatchObject({ method: "transfer", amountCents: 5_000_000, signed: false });
  });

  it("excludes failed and pending activity from cash flow", async () => {
    const counts = await getDb()
      .select({ total: sql`count(*)`.mapWith(Number) })
      .from(transactions)
      .where(and(eq(transactions.orgId, org.orgId), eq(transactions.status, "failed")));
    expect(counts[0]!.total).toBeGreaterThan(0);

    const rows = await getDb().execute<{ total: string }>(sql`
      select coalesce(sum(l.amount_cents) filter (where l.amount_cents > 0), 0)::bigint as total
      from ledger_entries l
      join transactions t on t.id = l.transaction_id
      join accounts a on a.id = l.account_id
      where l.org_id = ${org.orgId} and a.kind <> 'external' and t.status = 'posted'
        and t.method <> 'transfer' and t.category <> 'Financing'
        and to_char(t.occurred_at at time zone 'UTC', 'YYYY-MM') = ${overview.months.at(-2)!.month}
    `);
    expect(overview.months.at(-2)!.inCents).toBe(Number(rows[0]!.total));
  });

  it("shows the newest activity first, up to six items", () => {
    expect(overview.recent).toHaveLength(6);
    const times = overview.recent.map((item) => item.occurredAt.getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it("returns nothing from another organization", async () => {
    const other = await create();
    const mine = await getOverview(getDb(), org.orgId);
    const theirs = await getOverview(getDb(), other.orgId);

    const ids = (data: Overview) => new Set([...data.accounts.map((a) => a.id), ...data.recent.map((r) => r.id)]);
    const overlap = [...ids(mine)].filter((id) => ids(theirs).has(id));
    expect(overlap).toEqual([]);
  });

  it("is empty, not an error, for an organization with no data", async () => {
    const empty = await getOverview(getDb(), randomUUID());
    expect(empty.accounts).toEqual([]);
    expect(empty.totalCents).toBe(0);
    expect(empty.recent).toEqual([]);
    expect(empty.runway).toEqual({ kind: "unknown" });
  });
});
