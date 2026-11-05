import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { VERIFICATION_THRESHOLD_CENTS, type PaymentRequest } from "@/lib/payments";
import { closeDb, getDb } from "@/server/db/client";
import { accounts, auditLog, paymentChallenges, recipients, scheduledPayments, transactions } from "@/server/db/schema";
import { getAccountBalances, transferBetweenAccounts } from "@/server/ledger/ledger";
import { installWorkspace } from "@/server/seed/install";
import {
  addRecipient,
  cancelScheduledPayment,
  createChallenge,
  PaymentError,
  previewPayment,
  processDuePayments,
  requiresVerification,
  runScheduledPayment,
  submitPayment,
} from "./service";

type Workspace = { orgId: string; userId: string; operating: string; payroll: string; reserve: string; recipient: string };
const LARGE = VERIFICATION_THRESHOLD_CENTS;
const SMALL = 5_000;

async function createWorkspace(): Promise<Workspace> {
  const db = getDb();
  const { orgId, userId } = await db.transaction((tx) =>
    installWorkspace(tx, {
      user: { email: `test-${randomUUID()}@example.test`, name: "Test", passwordHash: null },
      expiresAt: null,
    }),
  );
  const rows = await db.select().from(accounts).where(eq(accounts.orgId, orgId));
  const idOf = (name: string) => rows.find((row) => row.name === name)!.id;
  const [recipient] = await db.select().from(recipients).where(eq(recipients.orgId, orgId));
  return { orgId, userId, operating: idOf("Operating"), payroll: idOf("Payroll"), reserve: idOf("Reserve"), recipient: recipient!.id };
}

const transfer = (w: Workspace, overrides: Partial<PaymentRequest> = {}): PaymentRequest =>
  ({ idempotencyKey: randomUUID(), fromAccountId: w.operating, toAccountId: w.reserve, amountCents: SMALL, ...overrides }) as PaymentRequest;

const payment = (w: Workspace, overrides: Partial<PaymentRequest> = {}): PaymentRequest =>
  ({ idempotencyKey: randomUUID(), fromAccountId: w.operating, recipientId: w.recipient, method: "ach", amountCents: SMALL, ...overrides }) as PaymentRequest;

const balance = async (w: Workspace, id: string) => (await getAccountBalances(getDb(), w.orgId)).find((a) => a.id === id)!;

const codeOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return "NO_ERROR";
  } catch (error) {
    return error instanceof Error && "code" in error ? String(error.code) : `UNEXPECTED: ${String(error)}`;
  }
};

const actor = (w: Workspace) => ({ orgId: w.orgId, userId: w.userId });
const tomorrow = () => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

/** Drains an account to a known balance so funding outcomes are exact. */
async function setBalance(w: Workspace, accountId: string, targetCents: number) {
  const { availableCents } = await balance(w, accountId);
  const other = accountId === w.operating ? w.reserve : w.operating;
  const change = availableCents - targetCents;
  await transferBetweenAccounts(getDb(), {
    orgId: w.orgId,
    actorUserId: w.userId,
    amountCents: Math.abs(change),
    idempotencyKey: randomUUID(),
    ...(change > 0 ? { fromAccountId: accountId, toAccountId: other } : { fromAccountId: other, toAccountId: accountId }),
  });
}

describe("payments", () => {
  let a: Workspace;
  let b: Workspace;

  beforeAll(async () => {
    [a, b] = await Promise.all([createWorkspace(), createWorkspace()]);
  });

  afterAll(async () => {
    await closeDb();
  });

  describe("sending", () => {
    it("settles an internal transfer right away", async () => {
      const before = await balance(a, a.reserve);
      const result = await submitPayment(getDb(), actor(a), transfer(a), {});
      expect(result.kind).toBe("sent");
      expect((await balance(a, a.reserve)).balanceCents).toBe(before.balanceCents + SMALL);
    });

    it("holds an ACH payment: available drops now, balance when it settles", async () => {
      const before = await balance(a, a.operating);
      await submitPayment(getDb(), actor(a), payment(a), {});
      const after = await balance(a, a.operating);
      expect(after.balanceCents).toBe(before.balanceCents);
      expect(after.availableCents).toBe(before.availableCents - SMALL);
    });

    it("settles a wire right away", async () => {
      const before = await balance(a, a.operating);
      await submitPayment(getDb(), actor(a), payment(a, { method: "wire" }), {});
      expect((await balance(a, a.operating)).balanceCents).toBe(before.balanceCents - SMALL);
    });

    it("sends once when a payment is retried", async () => {
      const request = payment(a, { method: "wire" });
      const before = await balance(a, a.operating);
      const first = await submitPayment(getDb(), actor(a), request, {});
      const retry = await submitPayment(getDb(), actor(a), request, {});
      expect(retry).toMatchObject({ kind: "sent", replayed: true });
      expect(first).toMatchObject({ replayed: false });
      expect((await balance(a, a.operating)).balanceCents).toBe(before.balanceCents - SMALL);
    });

    it("sends once when a double-click fires at the same moment", async () => {
      const request = payment(a, { method: "wire" });
      const before = await balance(a, a.operating);
      const results = await Promise.all(Array.from({ length: 5 }, () => submitPayment(getDb(), actor(a), request, {})));
      expect(results.filter((result) => !result.replayed)).toHaveLength(1);
      expect((await balance(a, a.operating)).balanceCents).toBe(before.balanceCents - SMALL);
    });

    it("rejects a payment above the available balance, counting held funds", async () => {
      const w = await createWorkspace();
      await setBalance(w, w.payroll, 100_000);
      await submitPayment(getDb(), actor(w), payment(w, { fromAccountId: w.payroll, amountCents: 60_000 }), {});
      const overdraft = payment(w, { fromAccountId: w.payroll, amountCents: 50_000 });
      expect(await codeOf(submitPayment(getDb(), actor(w), overdraft, {}))).toBe("INSUFFICIENT_FUNDS");
    });
  });

  describe("verification for large payments", () => {
    const large = (w: Workspace, overrides: Partial<PaymentRequest> = {}) => transfer(w, { amountCents: LARGE, ...overrides });

    it("applies from exactly the threshold", () => {
      expect(requiresVerification(LARGE - 1)).toBe(false);
      expect(requiresVerification(LARGE)).toBe(true);
    });

    it("can't be skipped by leaving the code out", async () => {
      const before = await balance(a, a.operating);
      expect(await codeOf(submitPayment(getDb(), actor(a), large(a), {}))).toBe("VERIFICATION_REQUIRED");
      expect((await balance(a, a.operating)).balanceCents).toBe(before.balanceCents);
    });

    it("sends with the right code", async () => {
      const request = large(a);
      const { challengeId, code } = await createChallenge(getDb(), actor(a), request);
      expect(await submitPayment(getDb(), actor(a), request, { challengeId, code })).toMatchObject({ kind: "sent" });
    });

    it("stores only a hash of the code", async () => {
      const { challengeId, code } = await createChallenge(getDb(), actor(a), large(a));
      const [row] = await getDb().select().from(paymentChallenges).where(eq(paymentChallenges.id, challengeId));
      expect(row!.codeHash).not.toContain(code);
    });

    it("rejects a wrong code and sends nothing", async () => {
      const request = large(a);
      const before = await balance(a, a.operating);
      const { challengeId, code } = await createChallenge(getDb(), actor(a), request);
      const wrong = code === "000000" ? "000001" : "000000";
      expect(await codeOf(submitPayment(getDb(), actor(a), request, { challengeId, code: wrong }))).toBe("CODE_INVALID");
      expect((await balance(a, a.operating)).balanceCents).toBe(before.balanceCents);
    });

    it("locks after five wrong attempts, even for the right code", async () => {
      const request = large(a);
      const { challengeId, code } = await createChallenge(getDb(), actor(a), request);
      const wrong = code === "000000" ? "000001" : "000000";
      for (let attempt = 0; attempt < 5; attempt += 1) {
        expect(await codeOf(submitPayment(getDb(), actor(a), request, { challengeId, code: wrong }))).toBe("CODE_INVALID");
      }
      expect(await codeOf(submitPayment(getDb(), actor(a), request, { challengeId, code }))).toBe("CODE_LOCKED");
    });

    it("can't be beaten by guessing concurrently", async () => {
      const request = large(a);
      const { challengeId, code } = await createChallenge(getDb(), actor(a), request);
      const wrong = code === "000000" ? "000001" : "000000";
      const results = await Promise.all(
        Array.from({ length: 12 }, () => codeOf(submitPayment(getDb(), actor(a), request, { challengeId, code: wrong }))),
      );
      expect(results.filter((result) => result === "CODE_INVALID")).toHaveLength(5);
      expect(results.filter((result) => result === "CODE_LOCKED")).toHaveLength(7);
    });

    it("expires", async () => {
      const request = large(a);
      const past = new Date(Date.now() - 6 * 60 * 1000);
      const { challengeId, code } = await createChallenge(getDb(), actor(a), request, past);
      expect(await codeOf(submitPayment(getDb(), actor(a), request, { challengeId, code }))).toBe("CODE_EXPIRED");
    });

    it("can't be reused for a second payment", async () => {
      const first = large(a);
      const { challengeId, code } = await createChallenge(getDb(), actor(a), first);
      await submitPayment(getDb(), actor(a), first, { challengeId, code });
      const second = { ...first, idempotencyKey: randomUUID() };
      expect(await codeOf(submitPayment(getDb(), actor(a), second, { challengeId, code }))).toBe("CODE_EXPIRED");
    });

    it.each([
      ["a different amount", () => ({ amountCents: LARGE + 100 })],
      ["a different destination", (w: Workspace) => ({ toAccountId: w.payroll })],
      ["a different source", (w: Workspace) => ({ fromAccountId: w.reserve })],
      ["a different date", () => ({ scheduledFor: tomorrow() })],
    ] as const)("can't approve %s", async (_label, change) => {
      const request = large(a);
      const { challengeId, code } = await createChallenge(getDb(), actor(a), request);
      const altered = { ...request, ...change(a), idempotencyKey: randomUUID() } as PaymentRequest;
      expect(await codeOf(submitPayment(getDb(), actor(a), altered, { challengeId, code }))).toBe("CODE_EXPIRED");
    });

    it("can't be used by another organization", async () => {
      const request = large(a);
      const { challengeId, code } = await createChallenge(getDb(), actor(a), request);
      const theirs = large(b);
      expect(await codeOf(submitPayment(getDb(), actor(b), theirs, { challengeId, code }))).toBe("CODE_EXPIRED");
    });

    it("keeps the code usable when the payment fails for lack of funds", async () => {
      const w = await createWorkspace();
      await setBalance(w, w.payroll, 100);
      const request = large(w, { fromAccountId: w.payroll, toAccountId: w.operating });
      const { challengeId, code } = await createChallenge(getDb(), actor(w), request);
      expect(await codeOf(submitPayment(getDb(), actor(w), request, { challengeId, code }))).toBe("INSUFFICIENT_FUNDS");

      const [row] = await getDb().select().from(paymentChallenges).where(eq(paymentChallenges.id, challengeId));
      expect(row!.consumedAt).toBeNull();
    });

    it("lets a successful payment be retried without its used code", async () => {
      const request = large(a);
      const { challengeId, code } = await createChallenge(getDb(), actor(a), request);
      const first = await submitPayment(getDb(), actor(a), request, { challengeId, code });
      const retry = await submitPayment(getDb(), actor(a), request, {});
      expect(retry).toMatchObject({ replayed: true });
      expect(first.kind === "sent" && retry.kind === "sent" && first.transactionId === retry.transactionId).toBe(true);
    });

    it("sends once when the same code is submitted twice at once", async () => {
      const request = large(a);
      const before = await balance(a, a.operating);
      const { challengeId, code } = await createChallenge(getDb(), actor(a), request);
      await Promise.all([
        codeOf(submitPayment(getDb(), actor(a), request, { challengeId, code })),
        codeOf(submitPayment(getDb(), actor(a), request, { challengeId, code })),
      ]);
      expect((await balance(a, a.operating)).balanceCents).toBe(before.balanceCents - LARGE);
    });

    it("also protects scheduling a large payment", async () => {
      const request = large(a, { scheduledFor: tomorrow() });
      expect(await codeOf(submitPayment(getDb(), actor(a), request, {}))).toBe("VERIFICATION_REQUIRED");
      const preview = await previewPayment(getDb(), actor(a), request);
      expect(preview.verification).not.toBeNull();
    });
  });

  describe("preview", () => {
    it("shows the balance after, and asks for a code only when needed", async () => {
      const before = await balance(a, a.operating);
      const small = await previewPayment(getDb(), actor(a), transfer(a));
      expect(small).toMatchObject({ fromName: "Operating", toName: "Reserve", verification: null });
      expect(small.availableAfterCents).toBe(before.availableCents - SMALL);
    });

    it("moves no money", async () => {
      const before = await balance(a, a.operating);
      await previewPayment(getDb(), actor(a), transfer(a));
      expect(await balance(a, a.operating)).toEqual(before);
    });

    it("rejects an immediate payment above the balance, and lets a future one through", async () => {
      const huge = { amountCents: 1_000_000_000_00 } as Partial<PaymentRequest>;
      expect(await codeOf(previewPayment(getDb(), actor(a), transfer(a, huge)))).toBe("INSUFFICIENT_FUNDS");
      expect(await codeOf(previewPayment(getDb(), actor(a), transfer(a, { ...huge, scheduledFor: tomorrow() })))).toBe("NO_ERROR");
    });
  });

  describe("organization isolation", () => {
    it("can't pay from another organization's account", async () => {
      const request = transfer(a, { fromAccountId: b.operating });
      expect(await codeOf(previewPayment(getDb(), actor(a), request))).toBe("ACCOUNT_NOT_FOUND");
      expect(await codeOf(submitPayment(getDb(), actor(a), request, {}))).toBe("ACCOUNT_NOT_FOUND");
    });

    it("can't send to another organization's account or recipient", async () => {
      expect(await codeOf(submitPayment(getDb(), actor(a), transfer(a, { toAccountId: b.operating }), {}))).toBe("ACCOUNT_NOT_FOUND");
      expect(await codeOf(submitPayment(getDb(), actor(a), payment(a, { recipientId: b.recipient }), {}))).toBe("RECIPIENT_NOT_FOUND");
    });

    it("can't schedule against another organization's accounts or recipients", async () => {
      const when = { scheduledFor: tomorrow() };
      expect(await codeOf(submitPayment(getDb(), actor(a), transfer(a, { fromAccountId: b.operating, ...when }), {}))).toBe("ACCOUNT_NOT_FOUND");
      expect(await codeOf(submitPayment(getDb(), actor(a), transfer(a, { toAccountId: b.operating, ...when }), {}))).toBe("ACCOUNT_NOT_FOUND");
      expect(await codeOf(submitPayment(getDb(), actor(a), payment(a, { recipientId: b.recipient, ...when }), {}))).toBe("RECIPIENT_NOT_FOUND");
    });

    it("can't cancel or run another organization's scheduled payment", async () => {
      const result = await submitPayment(getDb(), actor(b), transfer(b, { scheduledFor: tomorrow() }), {});
      const id = result.kind === "scheduled" ? result.scheduledId : "";

      expect(await cancelScheduledPayment(getDb(), actor(a), id)).toBe(false);
      expect(await runScheduledPayment(getDb(), a.orgId, id, a.userId)).toBe("skipped");
      const [row] = await getDb().select().from(scheduledPayments).where(eq(scheduledPayments.id, id));
      expect(row!.status).toBe("scheduled");
    });
  });

  describe("scheduled payments", () => {
    const schedule = async (w: Workspace, overrides: Partial<PaymentRequest> = {}) => {
      const result = await submitPayment(getDb(), actor(w), transfer(w, { scheduledFor: tomorrow(), ...overrides }), {});
      return result.kind === "scheduled" ? result.scheduledId : "";
    };
    const rowOf = async (id: string) => (await getDb().select().from(scheduledPayments).where(eq(scheduledPayments.id, id)))[0]!;
    const later = () => new Date(Date.now() + 2 * 86_400_000);

    it("moves no money until its date", async () => {
      const w = await createWorkspace();
      const before = await balance(w, w.operating);
      const id = await schedule(w);
      await processDuePayments(getDb(), w.orgId);
      expect((await rowOf(id)).status).toBe("scheduled");
      expect(await balance(w, w.operating)).toEqual(before);
    });

    it("runs on its date and links the transaction", async () => {
      const w = await createWorkspace();
      const before = await balance(w, w.reserve);
      const id = await schedule(w);
      await processDuePayments(getDb(), w.orgId, later());

      const row = await rowOf(id);
      expect(row.status).toBe("completed");
      expect(row.transactionId).toBeTruthy();
      expect((await balance(w, w.reserve)).balanceCents).toBe(before.balanceCents + SMALL);
    });

    it("sends once even when processing runs twice at the same moment", async () => {
      const w = await createWorkspace();
      const before = await balance(w, w.reserve);
      await schedule(w);
      await Promise.all([processDuePayments(getDb(), w.orgId, later()), processDuePayments(getDb(), w.orgId, later())]);
      expect((await balance(w, w.reserve)).balanceCents).toBe(before.balanceCents + SMALL);
    });

    it("fails clearly, moving nothing, when funds run short", async () => {
      const w = await createWorkspace();
      await setBalance(w, w.payroll, 1_000);
      const id = await schedule(w, { fromAccountId: w.payroll, toAccountId: w.operating, amountCents: 2_000 });
      const before = await balance(w, w.payroll);
      await processDuePayments(getDb(), w.orgId, later());

      const row = await rowOf(id);
      expect(row.status).toBe("failed");
      expect(row.failureReason).toContain("Not enough");
      expect(await balance(w, w.payroll)).toEqual(before);
    });

    it("never runs after being canceled, and can't be canceled twice", async () => {
      const w = await createWorkspace();
      const before = await balance(w, w.reserve);
      const id = await schedule(w);
      expect(await cancelScheduledPayment(getDb(), actor(w), id)).toBe(true);
      expect(await cancelScheduledPayment(getDb(), actor(w), id)).toBe(false);
      await processDuePayments(getDb(), w.orgId, later());

      expect((await rowOf(id)).status).toBe("canceled");
      expect((await balance(w, w.reserve)).balanceCents).toBe(before.balanceCents);
    });

    it("stays consistent when canceling races with running", async () => {
      for (let round = 0; round < 8; round += 1) {
        const w = await createWorkspace();
        const before = await balance(w, w.reserve);
        const id = await schedule(w);
        await Promise.all([cancelScheduledPayment(getDb(), actor(w), id), runScheduledPayment(getDb(), w.orgId, id, w.userId)]);

        const row = await rowOf(id);
        const moved = (await balance(w, w.reserve)).balanceCents - before.balanceCents;
        // Both outcomes are fine. Canceled with money moved, or completed without, is not.
        expect([row.status, moved]).toSatisfy(
          ([status, amount]: [string, number]) => (status === "completed" && amount === SMALL) || (status === "canceled" && amount === 0),
        );
      }
    }, 60_000);

    it("can be scheduled once when retried", async () => {
      const w = await createWorkspace();
      const request = transfer(w, { scheduledFor: tomorrow() });
      const [first, second] = await Promise.all([
        submitPayment(getDb(), actor(w), request, {}),
        submitPayment(getDb(), actor(w), request, {}),
      ]);
      const ids = [first, second].map((result) => (result.kind === "scheduled" ? result.scheduledId : ""));
      expect(ids[0]).toBe(ids[1]);
    });

    it("refuses a reused key with changed details", async () => {
      const w = await createWorkspace();
      const request = transfer(w, { scheduledFor: tomorrow() });
      await submitPayment(getDb(), actor(w), request, {});
      const altered = { ...request, amountCents: SMALL + 1 };
      expect(await codeOf(submitPayment(getDb(), actor(w), altered, {}))).toBe("IDEMPOTENCY_CONFLICT");
    });

    it("settles ACH payments after two days, and not before", async () => {
      const w = await createWorkspace();
      const result = await submitPayment(getDb(), actor(w), payment(w), {});
      const id = result.kind === "sent" ? result.transactionId : "";
      const statusOf = async () => (await getDb().select().from(transactions).where(eq(transactions.id, id)))[0]!.status;

      await processDuePayments(getDb(), w.orgId, new Date(Date.now() + 86_400_000));
      expect(await statusOf()).toBe("pending");
      await processDuePayments(getDb(), w.orgId, new Date(Date.now() + 3 * 86_400_000));
      expect(await statusOf()).toBe("posted");
    });

    it("comes seeded with upcoming payments", async () => {
      const w = await createWorkspace();
      const rows = await getDb()
        .select()
        .from(scheduledPayments)
        .where(and(eq(scheduledPayments.orgId, w.orgId), eq(scheduledPayments.status, "scheduled")));
      expect(rows).toHaveLength(3);
      const today = new Date().toISOString().slice(0, 10);
      for (const row of rows) expect(row.scheduledFor > today).toBe(true);
    });
  });

  describe("recipients", () => {
    it("keeps only the last four digits, and audits the change", async () => {
      const { id } = await addRecipient(getDb(), actor(a), { name: "New Vendor", bankName: "Test Bank", accountNumber: "000123456789" });
      const [row] = await getDb().select().from(recipients).where(eq(recipients.id, id));
      expect(row!.numberLast4).toBe("6789");
      expect(JSON.stringify(row)).not.toContain("000123456789");

      const audits = await getDb().select().from(auditLog).where(eq(auditLog.targetId, id));
      expect(audits[0]!.action).toBe("recipient.added");
      expect(JSON.stringify(audits[0])).not.toContain("000123456789");
    });
  });

  it("marks errors with the right type", async () => {
    await expect(submitPayment(getDb(), actor(a), transfer(a, { amountCents: LARGE }), {})).rejects.toBeInstanceOf(PaymentError);
  });
});
