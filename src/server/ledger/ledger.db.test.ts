import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/server/db/client";
import { accounts, auditLog, ledgerEntries, organizations, transactions } from "@/server/db/schema";
import { getAccountBalances, LedgerError, transferBetweenAccounts } from "./ledger";
import { installWorkspace, purgeExpired } from "@/server/seed/install";

type Workspace = { orgId: string; userId: string; operating: string; payroll: string; reserve: string };

async function createWorkspace(expiresAt: Date | null = null): Promise<Workspace> {
  const db = getDb();
  const { orgId, userId } = await db.transaction((tx) =>
    installWorkspace(tx, {
      user: { email: `test-${randomUUID()}@example.test`, name: "Test", passwordHash: null },
      expiresAt,
    }),
  );
  const rows = await db.select().from(accounts).where(eq(accounts.orgId, orgId));
  const idOf = (name: string) => rows.find((row) => row.name === name)!.id;
  return { orgId, userId, operating: idOf("Operating"), payroll: idOf("Payroll"), reserve: idOf("Reserve") };
}

const balanceOf = async (workspace: Workspace, id: string) =>
  (await getAccountBalances(getDb(), workspace.orgId)).find((account) => account.id === id)!;

const transfer = (workspace: Workspace, overrides: Partial<Parameters<typeof transferBetweenAccounts>[1]> = {}) =>
  transferBetweenAccounts(getDb(), {
    orgId: workspace.orgId,
    actorUserId: workspace.userId,
    fromAccountId: workspace.operating,
    toAccountId: workspace.reserve,
    amountCents: 10_000,
    idempotencyKey: randomUUID(),
    ...overrides,
  });

const codeOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return "NO_ERROR";
  } catch (error) {
    return error instanceof LedgerError ? error.code : `UNEXPECTED: ${String(error)}`;
  }
};

/** Drizzle wraps driver errors, so look through the whole cause chain. */
const databaseMessage = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return "NO_ERROR";
  } catch (error) {
    let current: unknown = error;
    const messages: string[] = [];
    while (current instanceof Error) {
      messages.push(current.message);
      current = current.cause;
    }
    return messages.join(" | ");
  }
};

describe("ledger", () => {
  let a: Workspace;
  let b: Workspace;

  beforeAll(async () => {
    [a, b] = await Promise.all([createWorkspace(), createWorkspace()]);
  });

  afterAll(async () => {
    await closeDb();
  });

  async function newTransaction(orgId: string) {
    const id = randomUUID();
    await getDb().insert(transactions).values({
      id,
      orgId,
      status: "posted",
      method: "ach",
      description: "Test",
      counterparty: "Test",
      category: "Test",
      occurredAt: new Date(),
    });
    return id;
  }

  describe("database guarantees", () => {
    it("rejects a transaction whose lines don't balance", async () => {
      const transactionId = await newTransaction(a.orgId);
      const message = await databaseMessage(
        getDb().insert(ledgerEntries).values([
          { orgId: a.orgId, transactionId, accountId: a.operating, amountCents: 1_000 },
          { orgId: a.orgId, transactionId, accountId: a.reserve, amountCents: -999 },
        ]),
      );
      expect(message).toContain("unbalanced");
    });

    it("rejects a single line that creates money", async () => {
      const transactionId = await newTransaction(a.orgId);
      const message = await databaseMessage(
        getDb().insert(ledgerEntries).values({ orgId: a.orgId, transactionId, accountId: a.operating, amountCents: 1_000 }),
      );
      expect(message).toContain("unbalanced");
    });

    it("refuses edits and deletes of ledger lines", async () => {
      const db = getDb();
      const before = await balanceOf(a, a.operating);
      expect(await databaseMessage(db.update(ledgerEntries).set({ amountCents: 1 }).where(eq(ledgerEntries.orgId, a.orgId)))).toContain("append-only");
      expect(await databaseMessage(db.delete(ledgerEntries).where(eq(ledgerEntries.orgId, a.orgId)))).toContain("append-only");
      expect(await databaseMessage(db.execute(sql`truncate ledger_entries cascade`))).toContain("append-only");
      expect(await balanceOf(a, a.operating)).toEqual(before);
    });

    it("refuses edits of the audit log", async () => {
      const db = getDb();
      const [row] = await db
        .insert(auditLog)
        .values({ orgId: a.orgId, action: "test.event" })
        .returning({ id: auditLog.id });
      const thisRow = eq(auditLog.id, row!.id);

      expect(await databaseMessage(db.delete(auditLog).where(thisRow))).toContain("append-only");
      expect(await databaseMessage(db.update(auditLog).set({ action: "tampered" }).where(thisRow))).toContain("append-only");
      expect(await databaseMessage(db.execute(sql`truncate audit_log cascade`))).toContain("append-only");

      const [stored] = await db.select().from(auditLog).where(thisRow);
      expect(stored!.action).toBe("test.event");
    });

    it("refuses a line that points at another organization's account", async () => {
      const transactionId = await newTransaction(a.orgId);
      const message = await databaseMessage(
        getDb().insert(ledgerEntries).values([
          { orgId: a.orgId, transactionId, accountId: b.operating, amountCents: 1_000 },
          { orgId: a.orgId, transactionId, accountId: a.operating, amountCents: -1_000 },
        ]),
      );
      expect(message).toContain("ledger_entries_account_fk");
    });
  });

  describe("seeded data", () => {
    it("nets to exactly zero across each organization", async () => {
      const rows = await getDb().execute<{ total: string }>(
        sql`select coalesce(sum(amount_cents), 0)::bigint as total from ledger_entries where org_id = ${a.orgId}`,
      );
      expect(Number(rows[0]!.total)).toBe(0);
    });

    it("gives every account a healthy balance and hides the external account", async () => {
      const balances = await getAccountBalances(getDb(), a.orgId);
      expect(balances.map((account) => account.name).sort()).toEqual(["Operating", "Payroll", "Reserve"]);
      for (const account of balances) expect(account.balanceCents).toBeGreaterThanOrEqual(0);
    });

    it("excludes failed transactions from balances and counts pending as unavailable", async () => {
      const db = getDb();
      const { orgId, operating } = a;
      const before = await balanceOf(a, operating);

      for (const status of ["failed", "pending"] as const) {
        const transactionId = randomUUID();
        await db.insert(transactions).values({
          id: transactionId, orgId, status, method: "ach", description: "Test", counterparty: "Test", category: "Test", occurredAt: new Date(),
        });
        await db.insert(ledgerEntries).values([
          { orgId, transactionId, accountId: operating, amountCents: -5_000 },
          { orgId, transactionId, accountId: a.reserve, amountCents: 5_000 },
        ]);
      }

      const after = await balanceOf(a, operating);
      expect(after.balanceCents).toBe(before.balanceCents);
      expect(after.availableCents).toBe(before.availableCents - 5_000);
    });
  });

  describe("transfers", () => {
    it("moves money and records one audit entry", async () => {
      const fromBefore = await balanceOf(a, a.operating);
      const toBefore = await balanceOf(a, a.reserve);

      const { transactionId, replayed } = await transfer(a, { amountCents: 12_345 });

      expect(replayed).toBe(false);
      expect((await balanceOf(a, a.operating)).balanceCents).toBe(fromBefore.balanceCents - 12_345);
      expect((await balanceOf(a, a.reserve)).balanceCents).toBe(toBefore.balanceCents + 12_345);
      const audits = await getDb().select().from(auditLog).where(eq(auditLog.targetId, transactionId));
      expect(audits).toHaveLength(1);
      expect(audits[0]!.action).toBe("transfer.created");
    });

    it.each([
      ["zero", 0],
      ["negative", -100],
      ["fractional", 10.5],
      ["not a number", Number.NaN],
      ["huge", Number.MAX_SAFE_INTEGER],
    ])("rejects a %s amount", async (_label, amountCents) => {
      expect(await codeOf(transfer(a, { amountCents }))).toBe("INVALID_AMOUNT");
    });

    it("rejects a transfer to the same account", async () => {
      expect(await codeOf(transfer(a, { toAccountId: a.operating }))).toBe("SAME_ACCOUNT");
    });

    it("rejects more than the available balance and changes nothing", async () => {
      const before = await balanceOf(a, a.operating);
      expect(await codeOf(transfer(a, { amountCents: before.availableCents + 1 }))).toBe("INSUFFICIENT_FUNDS");
      expect(await balanceOf(a, a.operating)).toEqual(before);
    });

    it("can't move money from, or to, another organization's account", async () => {
      expect(await codeOf(transfer(a, { fromAccountId: b.operating }))).toBe("ACCOUNT_NOT_FOUND");
      expect(await codeOf(transfer(a, { toAccountId: b.operating }))).toBe("ACCOUNT_NOT_FOUND");
    });

    it("can't move money through the external account", async () => {
      const [external] = await getDb()
        .select({ id: accounts.id })
        .from(accounts)
        .where(and(eq(accounts.orgId, a.orgId), eq(accounts.kind, "external")));
      expect(await codeOf(transfer(a, { fromAccountId: external!.id }))).toBe("ACCOUNT_NOT_FOUND");
    });

    it("never overdraws when transfers race for the same money", async () => {
      const workspace = await createWorkspace();
      const { availableCents } = await balanceOf(workspace, workspace.payroll);
      // Empty the account to a known small balance so the race has a clear answer.
      if (availableCents > 0) await transfer(workspace, { fromAccountId: workspace.payroll, amountCents: availableCents });
      await transfer(workspace, { toAccountId: workspace.payroll, amountCents: 100_000 });

      // Ten attempts at 40% each: exactly two can succeed.
      const results = await Promise.all(
        Array.from({ length: 10 }, () =>
          codeOf(transfer(workspace, { fromAccountId: workspace.payroll, amountCents: 40_000 })),
        ),
      );

      expect(results.filter((result) => result === "NO_ERROR")).toHaveLength(2);
      expect(results.filter((result) => result === "INSUFFICIENT_FUNDS")).toHaveLength(8);
      expect((await balanceOf(workspace, workspace.payroll)).balanceCents).toBe(20_000);
    });

    it("doesn't deadlock when opposite transfers run at once", async () => {
      const results = await Promise.all(
        Array.from({ length: 10 }, (_, index) =>
          index % 2
            ? transfer(a, { amountCents: 100 })
            : transfer(a, { fromAccountId: a.reserve, toAccountId: a.operating, amountCents: 100 }),
        ),
      );
      expect(results).toHaveLength(10);
    });
  });

  describe("idempotency", () => {
    it("sends money once when the same request is retried", async () => {
      const idempotencyKey = randomUUID();
      const before = await balanceOf(a, a.operating);
      const first = await transfer(a, { idempotencyKey, amountCents: 7_000 });
      const retry = await transfer(a, { idempotencyKey, amountCents: 7_000 });

      expect(retry).toEqual({ transactionId: first.transactionId, replayed: true });
      expect((await balanceOf(a, a.operating)).balanceCents).toBe(before.balanceCents - 7_000);
    });

    it("sends money once when a double-click fires requests at the same moment", async () => {
      const idempotencyKey = randomUUID();
      const before = await balanceOf(a, a.operating);
      const results = await Promise.all(
        Array.from({ length: 5 }, () => transfer(a, { idempotencyKey, amountCents: 3_000 })),
      );

      expect(new Set(results.map((result) => result.transactionId)).size).toBe(1);
      expect(results.filter((result) => !result.replayed)).toHaveLength(1);
      expect((await balanceOf(a, a.operating)).balanceCents).toBe(before.balanceCents - 3_000);
    });

    it("refuses a reused key with a different amount", async () => {
      const idempotencyKey = randomUUID();
      await transfer(a, { idempotencyKey, amountCents: 1_000 });
      expect(await codeOf(transfer(a, { idempotencyKey, amountCents: 2_000 }))).toBe("IDEMPOTENCY_CONFLICT");
    });

    it("keeps keys separate between organizations", async () => {
      const idempotencyKey = randomUUID();
      const first = await transfer(a, { idempotencyKey });
      const second = await transfer(b, { idempotencyKey });
      expect(second.replayed).toBe(false);
      expect(second.transactionId).not.toBe(first.transactionId);
    });
  });

  describe("demo cleanup", () => {
    it("removes expired workspaces completely and leaves others alone", async () => {
      const db = getDb();
      const expired = await createWorkspace(new Date(Date.now() - 1_000));
      await purgeExpired(db);

      expect(await db.select().from(organizations).where(eq(organizations.id, expired.orgId))).toEqual([]);
      expect(await db.select().from(ledgerEntries).where(eq(ledgerEntries.orgId, expired.orgId))).toEqual([]);
      expect(await db.select().from(organizations).where(eq(organizations.id, a.orgId))).toHaveLength(1);
    });

    it("doesn't leave the delete switch on afterwards", async () => {
      await purgeExpired(getDb());
      const message = await databaseMessage(getDb().delete(ledgerEntries).where(eq(ledgerEntries.orgId, a.orgId)));
      expect(message).toContain("append-only");
    });
  });
});
