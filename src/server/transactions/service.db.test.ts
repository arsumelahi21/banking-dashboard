import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/server/db/client";
import { auditLog, transactions } from "@/server/db/schema";
import { installWorkspace } from "@/server/seed/install";
import { setTransactionMemo } from "./service";

const create = () =>
  getDb().transaction((tx) =>
    installWorkspace(tx, {
      user: { email: `test-${randomUUID()}@example.test`, name: "Test", passwordHash: null },
      expiresAt: null,
    }),
  );

describe("setTransactionMemo", () => {
  let a: { orgId: string; userId: string };
  let b: { orgId: string; userId: string };
  const firstOf = async (orgId: string) => (await getDb().select().from(transactions).where(eq(transactions.orgId, orgId)).limit(1))[0]!;

  beforeAll(async () => {
    [a, b] = await Promise.all([create(), create()]);
  });

  afterAll(async () => {
    await closeDb();
  });

  it("saves a memo and records it in the audit log", async () => {
    const row = await firstOf(a.orgId);
    expect(await setTransactionMemo(getDb(), a, row.id, "Reviewed")).toBe(true);
    const [saved] = await getDb().select().from(transactions).where(eq(transactions.id, row.id));
    expect(saved!.memo).toBe("Reviewed");

    const audits = await getDb().select().from(auditLog).where(eq(auditLog.targetId, row.id));
    expect(audits.map((audit) => audit.action)).toContain("transaction.memo_updated");
  });

  it("clears a memo with an empty value", async () => {
    const row = await firstOf(a.orgId);
    await setTransactionMemo(getDb(), a, row.id, "Temporary");
    await setTransactionMemo(getDb(), a, row.id, "");
    const [saved] = await getDb().select().from(transactions).where(eq(transactions.id, row.id));
    expect(saved!.memo).toBeNull();
  });

  it("can't change another organization's transaction, and audits nothing", async () => {
    const theirs = await firstOf(b.orgId);
    expect(await setTransactionMemo(getDb(), a, theirs.id, "tampered")).toBe(false);

    const [after] = await getDb().select().from(transactions).where(eq(transactions.id, theirs.id));
    expect(after!.memo).not.toBe("tampered");
    expect(await getDb().select().from(auditLog).where(eq(auditLog.targetId, theirs.id))).toEqual([]);
  });

  it("returns false for an id that doesn't exist", async () => {
    expect(await setTransactionMemo(getDb(), a, randomUUID(), "x")).toBe(false);
  });
});
