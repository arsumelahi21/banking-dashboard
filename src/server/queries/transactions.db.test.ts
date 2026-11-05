import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TransactionFilters } from "@/lib/transaction-filters";
import { closeDb, getDb } from "@/server/db/client";
import { accounts, transactions } from "@/server/db/schema";
import { transferBetweenAccounts } from "@/server/ledger/ledger";
import { installWorkspace } from "@/server/seed/install";
import { exportTransactions, getTransaction, getTransactionFacets, listTransactions, PAGE_SIZE } from "./transactions";

const create = () =>
  getDb().transaction((tx) =>
    installWorkspace(tx, {
      user: { email: `test-${randomUUID()}@example.test`, name: "Test", passwordHash: null },
      expiresAt: null,
    }),
  );

const filter = (overrides: Partial<TransactionFilters> = {}): TransactionFilters => ({ page: 1, ...overrides });

describe("transactions", () => {
  let a: { orgId: string; userId: string };
  let b: { orgId: string; userId: string };
  let accountIds: Record<string, string>;
  const list = (overrides?: Partial<TransactionFilters>) => listTransactions(getDb(), a.orgId, filter(overrides));
  const everything = (overrides?: Partial<TransactionFilters>) => exportTransactions(getDb(), a.orgId, filter(overrides));

  beforeAll(async () => {
    [a, b] = await Promise.all([create(), create()]);
    const rows = await getDb().select().from(accounts).where(eq(accounts.orgId, a.orgId));
    accountIds = Object.fromEntries(rows.map((row) => [row.name, row.id]));
  });

  afterAll(async () => {
    await closeDb();
  });

  describe("search", () => {
    it("matches merchant, description and category, ignoring case", async () => {
      expect((await everything({ q: "figma" })).length).toBeGreaterThan(0);
      for (const row of await everything({ q: "figma" })) {
        expect(`${row.counterparty} ${row.description}`.toLowerCase()).toContain("figma");
      }
      expect((await everything({ q: "PAYROLL TAXES" })).every((row) => row.description === "Payroll taxes")).toBe(true);
    });

    it("treats % and _ as plain characters", async () => {
      expect((await list({ q: "%" })).total).toBe(0);
      expect((await list({ q: "_" })).total).toBe(0);
      expect((await list({ q: "\\" })).total).toBe(0);
    });

    it("treats SQL as plain text", async () => {
      expect((await list({ q: "'; drop table transactions; --" })).total).toBe(0);
      expect((await list({ q: "' or '1'='1" })).total).toBe(0);
      const [row] = await getDb().select({ count: sql`count(*)`.mapWith(Number) }).from(transactions);
      expect(row!.count).toBeGreaterThan(0);
    });

    it("finds text in memos", async () => {
      const marker = `memo-${randomUUID()}`;
      const [row] = await everything();
      await getDb().update(transactions).set({ memo: marker }).where(eq(transactions.id, row!.id));
      expect((await everything({ q: marker })).map((match) => match.id)).toEqual([row!.id]);
    });
  });

  describe("filters", () => {
    it.each(["posted", "pending", "failed"] as const)("filters by status: %s", async (status) => {
      const rows = await everything({ status });
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((row) => row.status === status)).toBe(true);
    });

    it("filters by type and category", async () => {
      const wires = await everything({ method: "wire" });
      expect(wires.length).toBeGreaterThan(0);
      expect(wires.every((row) => row.method === "wire")).toBe(true);

      const rent = await everything({ category: "Rent" });
      expect(rent.length).toBeGreaterThanOrEqual(12);
      expect(rent.every((row) => row.category === "Rent")).toBe(true);
    });

    it("filters by direction", async () => {
      const incoming = await everything({ direction: "in" });
      const outgoing = await everything({ direction: "out" });
      expect(incoming.length).toBeGreaterThan(0);
      expect(incoming.every((row) => row.amountCents > 0)).toBe(true);
      expect(outgoing.every((row) => row.amountCents < 0)).toBe(true);
    });

    it("includes both boundary days of a date range, in full", async () => {
      const all = await everything();
      const day = all[50]!.occurredAt.toISOString().slice(0, 10);
      const rows = await everything({ from: day, to: day });
      const expected = all.filter((row) => row.occurredAt.toISOString().slice(0, 10) === day);
      expect(rows.map((row) => row.id).sort()).toEqual(expected.map((row) => row.id).sort());
    });

    it("includes both ends of an amount range, whichever direction the money went", async () => {
      const rows = await everything({ minCents: 135_000, maxCents: 135_000 });
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((row) => Math.abs(row.amountCents) === 135_000)).toBe(true);
    });

    it("filters by account, including transfers that touch it", async () => {
      const rows = await everything({ accountId: accountIds.Reserve });
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((row) => row.accountNames.includes("Reserve"))).toBe(true);
    });

    it("filters by card, and another organization's card shows nothing", async () => {
      const facets = await getTransactionFacets(getDb(), a.orgId);
      expect(facets.cards).toHaveLength(4);
      const rows = await everything({ cardId: facets.cards[0]!.id });
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((row) => row.method === "card")).toBe(true);

      const theirs = await getTransactionFacets(getDb(), b.orgId);
      expect((await list({ cardId: theirs.cards[0]!.id })).total).toBe(0);
    });

    it("combines filters", async () => {
      const rows = await everything({ method: "card", category: "Software", direction: "out", q: "datadog" });
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((row) => row.counterparty === "Datadog" && row.method === "card")).toBe(true);
    });
  });

  describe("pagination and totals", () => {
    it("covers every row exactly once across pages", async () => {
      const { total } = await list();
      const seen: string[] = [];
      for (let page = 1; page <= Math.ceil(total / PAGE_SIZE); page += 1) {
        seen.push(...(await list({ page })).rows.map((row) => row.id));
      }
      expect(seen).toHaveLength(total);
      expect(new Set(seen).size).toBe(total);
    });

    it("returns an empty page, not an error, past the end", async () => {
      const result = await list({ page: 99_999 });
      expect(result.rows).toEqual([]);
      expect(result.total).toBeGreaterThan(0);
    });

    it("sorts newest first", async () => {
      const times = (await list()).rows.map((row) => row.occurredAt.getTime());
      expect(times).toEqual([...times].sort((x, y) => y - x));
    });

    it("totals only settled, real money for the matching rows", async () => {
      const summary = await list({ q: "figma" });
      const rows = await everything({ q: "figma", status: "posted" });
      expect(summary.outCents).toBe(-rows.reduce((sum, row) => sum + row.amountCents, 0));

      const failed = await list({ status: "failed" });
      expect(failed.total).toBeGreaterThan(0);
      expect(failed.outCents).toBe(0);

      const transfers = await list({ method: "transfer" });
      expect(transfers.total).toBeGreaterThan(0);
      expect(transfers.inCents).toBe(0);
      expect(transfers.outCents).toBe(0);
    });
  });

  describe("details", () => {
    it("returns balanced ledger lines and no internal idempotency data", async () => {
      const { orgId, userId } = a;
      const { transactionId } = await transferBetweenAccounts(getDb(), {
        orgId,
        actorUserId: userId,
        fromAccountId: accountIds.Operating!,
        toAccountId: accountIds.Reserve!,
        amountCents: 12_300,
        idempotencyKey: `secret-${randomUUID()}`,
      });

      const detail = await getTransaction(getDb(), orgId, transactionId);
      expect(detail).toMatchObject({ amountCents: 12_300, signed: false, method: "transfer" });
      expect(detail!.lines.reduce((sum, line) => sum + line.amountCents, 0)).toBe(0);
      expect(JSON.stringify(detail)).not.toContain("secret-");
    });

    it("includes the card on card payments", async () => {
      const [card] = await everything({ method: "card" });
      const detail = await getTransaction(getDb(), a.orgId, card!.id);
      expect(detail!.card).toMatchObject({ last4: expect.stringMatching(/^\d{4}$/) });
    });

    it("returns null for an unknown id", async () => {
      expect(await getTransaction(getDb(), a.orgId, randomUUID())).toBeNull();
    });
  });

  describe("organization isolation", () => {
    it("can't read another organization's transaction by id", async () => {
      const [theirs] = await exportTransactions(getDb(), b.orgId, filter());
      expect(await getTransaction(getDb(), b.orgId, theirs!.id)).not.toBeNull();
      expect(await getTransaction(getDb(), a.orgId, theirs!.id)).toBeNull();
    });

    it("shows nothing when filtering by another organization's account", async () => {
      const [theirAccount] = await getDb().select().from(accounts).where(eq(accounts.orgId, b.orgId));
      const result = await list({ accountId: theirAccount!.id });
      expect(result.total).toBe(0);
      expect(result.rows).toEqual([]);
    });

    it("never mixes rows in lists or exports", async () => {
      const mine = new Set((await everything()).map((row) => row.id));
      const theirs = await exportTransactions(getDb(), b.orgId, filter());
      expect(theirs.length).toBeGreaterThan(0);
      expect(theirs.filter((row) => mine.has(row.id))).toEqual([]);
    });

    it("keeps memo edits out of the other organization's search", async () => {
      const marker = `private-${randomUUID()}`;
      const [row] = await everything();
      await getDb().update(transactions).set({ memo: marker }).where(eq(transactions.id, row!.id));
      expect((await listTransactions(getDb(), b.orgId, filter({ q: marker }))).total).toBe(0);
    });

    it("builds filter menus only from this organization's data", async () => {
      const facets = await getTransactionFacets(getDb(), a.orgId);
      expect(facets.accounts.map((account) => account.name)).toEqual(["Operating", "Payroll", "Reserve"]);
      expect(facets.accounts.map((account) => account.id).sort()).toEqual(
        [accountIds.Operating, accountIds.Payroll, accountIds.Reserve].sort(),
      );
      expect(facets.categories).toContain("Software");
    });
  });
});
