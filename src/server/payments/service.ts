import "server-only";
import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { and, asc, eq, isNull, lt, lte, sql } from "drizzle-orm";
import { dayKey } from "@/lib/metrics";
import { VERIFICATION_THRESHOLD_CENTS, type PaymentRequest } from "@/lib/payments";
import type { Db, Tx } from "@/server/db/client";
import { accounts, auditLog, paymentChallenges, recipients, scheduledPayments, transactions } from "@/server/db/schema";
import { getAccountBalances, LedgerError, payRecipient, transferBetweenAccounts } from "@/server/ledger/ledger";

const CHALLENGE_LIFETIME_MS = 5 * 60 * 1000;
const MAX_CODE_ATTEMPTS = 5;
const SETTLEMENT_MS = 2 * 24 * 60 * 60 * 1000;
const DUE_BATCH_SIZE = 20;

export type Actor = { orgId: string; userId: string };

export type PaymentErrorCode =
  | LedgerError["code"]
  | "VERIFICATION_REQUIRED"
  | "CODE_INVALID"
  | "CODE_EXPIRED"
  | "CODE_LOCKED";

export class PaymentError extends Error {
  constructor(readonly code: PaymentErrorCode) {
    super(code);
    this.name = "PaymentError";
  }
}

export const requiresVerification = (amountCents: number) => amountCents >= VERIFICATION_THRESHOLD_CENTS;

/** Everything a code authorizes. A code issued for one payment can't approve a different one. */
function paymentFingerprint(request: PaymentRequest): string {
  const parts = [
    request.fromAccountId,
    request.toAccountId ?? "",
    request.recipientId ?? "",
    request.method ?? "",
    request.amountCents,
    request.scheduledFor ?? "now",
  ];
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

const hashCode = (challengeId: string, code: string) => createHash("sha256").update(`${challengeId}:${code}`).digest("hex");

/**
 * Creates a one-time code. In production it would go to the user's phone and never
 * come back in a response. This demo has no SMS, so the caller displays it.
 */
export async function createChallenge(db: Db, actor: Actor, request: PaymentRequest, now = new Date()) {
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const id = crypto.randomUUID();
  const expiresAt = new Date(now.getTime() + CHALLENGE_LIFETIME_MS);
  await db.insert(paymentChallenges).values({
    id,
    orgId: actor.orgId,
    userId: actor.userId,
    fingerprint: paymentFingerprint(request),
    codeHash: hashCode(id, code),
    expiresAt,
  });
  return { challengeId: id, code, expiresAt };
}

/**
 * Checks a code without using it up. The attempt is counted first in its own
 * statement, so it survives even if the payment later rolls back, and concurrent
 * guesses can't exceed the limit.
 */
async function checkChallenge(db: Db, actor: Actor, request: PaymentRequest, challengeId: string, code: string, now: Date) {
  const [challenge] = await db
    .update(paymentChallenges)
    .set({ attempts: sql`${paymentChallenges.attempts} + 1` })
    .where(
      and(
        eq(paymentChallenges.id, challengeId),
        eq(paymentChallenges.orgId, actor.orgId),
        eq(paymentChallenges.userId, actor.userId),
        eq(paymentChallenges.fingerprint, paymentFingerprint(request)),
        isNull(paymentChallenges.consumedAt),
      ),
    )
    .returning();

  if (!challenge) throw new PaymentError("CODE_EXPIRED");
  if (challenge.attempts > MAX_CODE_ATTEMPTS) throw new PaymentError("CODE_LOCKED");
  if (challenge.expiresAt <= now) throw new PaymentError("CODE_EXPIRED");

  const expected = Buffer.from(challenge.codeHash, "hex");
  const actual = Buffer.from(hashCode(challengeId, code), "hex");
  if (!timingSafeEqual(expected, actual)) throw new PaymentError("CODE_INVALID");
}

/** Used up in the same transaction as the payment: one code, one payment, even if requests race. */
async function consumeChallenge(tx: Tx, challengeId: string, now: Date) {
  const consumed = await tx
    .update(paymentChallenges)
    .set({ consumedAt: now })
    .where(and(eq(paymentChallenges.id, challengeId), isNull(paymentChallenges.consumedAt)))
    .returning({ id: paymentChallenges.id });
  if (consumed.length === 0) throw new PaymentError("CODE_EXPIRED");
}

export type PaymentPreview = {
  fromName: string;
  toName: string;
  availableAfterCents: number;
  verification: { challengeId: string; code: string; expiresAt: Date } | null;
};

/** Checks a payment before anyone commits to it, and issues a code if it needs one. */
export async function previewPayment(db: Db, actor: Actor, request: PaymentRequest, now = new Date()): Promise<PaymentPreview> {
  const balances = await getAccountBalances(db, actor.orgId);
  const from = balances.find((account) => account.id === request.fromAccountId);
  if (!from) throw new PaymentError("ACCOUNT_NOT_FOUND");

  let toName: string;
  if (request.toAccountId !== undefined) {
    const to = balances.find((account) => account.id === request.toAccountId);
    if (!to) throw new PaymentError("ACCOUNT_NOT_FOUND");
    toName = to.name;
  } else {
    const [recipient] = await db
      .select({ name: recipients.name })
      .from(recipients)
      .where(and(eq(recipients.orgId, actor.orgId), eq(recipients.id, request.recipientId)));
    if (!recipient) throw new PaymentError("RECIPIENT_NOT_FOUND");
    toName = recipient.name;
  }

  // A future payment is checked again on its date, when the balance may be different.
  if (!request.scheduledFor && from.availableCents < request.amountCents) {
    throw new PaymentError("INSUFFICIENT_FUNDS");
  }

  const verification = requiresVerification(request.amountCents) ? await createChallenge(db, actor, request, now) : null;

  return { fromName: from.name, toName, availableAfterCents: from.availableCents - request.amountCents, verification };
}

export type Verification = { challengeId?: string; code?: string };

export type SubmitResult =
  | { kind: "sent"; transactionId: string; replayed: boolean }
  | { kind: "scheduled"; scheduledId: string; replayed: boolean };

function send(db: Db, actor: Actor, request: PaymentRequest, onPosted?: (tx: Tx, transactionId: string) => Promise<void>) {
  const base = {
    orgId: actor.orgId,
    actorUserId: actor.userId,
    fromAccountId: request.fromAccountId,
    amountCents: request.amountCents,
    idempotencyKey: request.idempotencyKey,
    memo: request.memo,
    onPosted,
  };
  return request.toAccountId !== undefined
    ? transferBetweenAccounts(db, { ...base, toAccountId: request.toAccountId })
    : payRecipient(db, { ...base, recipientId: request.recipientId, method: request.method });
}

/** The server's only way to commit a payment, whichever screen or request it came from. */
export async function submitPayment(
  db: Db,
  actor: Actor,
  request: PaymentRequest,
  verification: Verification,
  now = new Date(),
): Promise<SubmitResult> {
  // A retry of a payment that already went through returns it, without asking for a
  // code that has since been used up. A retry must not fail just because it's a retry.
  const replay = await findExisting(db, actor, request);
  if (replay) return replay;

  const needsCode = requiresVerification(request.amountCents);
  if (needsCode) {
    if (!verification.challengeId || !verification.code) throw new PaymentError("VERIFICATION_REQUIRED");
    await checkChallenge(db, actor, request, verification.challengeId, verification.code, now);
  }
  const consume = needsCode ? (tx: Tx) => consumeChallenge(tx, verification.challengeId!, now) : undefined;

  if (request.scheduledFor) return schedulePayment(db, actor, request, consume);

  const { transactionId, replayed } = await send(db, actor, request, consume ? (tx) => consume(tx) : undefined);
  return { kind: "sent", transactionId, replayed };
}

async function findExisting(db: Db, actor: Actor, request: PaymentRequest): Promise<SubmitResult | null> {
  if (request.scheduledFor) {
    const [existing] = await db
      .select()
      .from(scheduledPayments)
      .where(and(eq(scheduledPayments.orgId, actor.orgId), eq(scheduledPayments.idempotencyKey, request.idempotencyKey)));
    if (!existing) return null;

    const sameDetails =
      existing.fromAccountId === request.fromAccountId &&
      existing.toAccountId === (request.toAccountId ?? null) &&
      existing.recipientId === (request.recipientId ?? null) &&
      existing.method === (request.method ?? null) &&
      existing.amountCents === request.amountCents &&
      existing.scheduledFor === request.scheduledFor;
    if (!sameDetails) throw new PaymentError("IDEMPOTENCY_CONFLICT");
    return { kind: "scheduled", scheduledId: existing.id, replayed: true };
  }

  const [existing] = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(and(eq(transactions.orgId, actor.orgId), eq(transactions.idempotencyKey, request.idempotencyKey)));
  if (!existing) return null;

  // The ledger compares details and rejects a reused key used for a different payment.
  const { transactionId, replayed } = await send(db, actor, request);
  return { kind: "sent", transactionId, replayed };
}

async function schedulePayment(db: Db, actor: Actor, request: PaymentRequest, consume?: (tx: Tx) => Promise<void>): Promise<SubmitResult> {
  return db.transaction(async (tx) => {
    const [owned] = await tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.orgId, actor.orgId), eq(accounts.id, request.fromAccountId), sql`${accounts.kind} <> 'external'`));
    if (!owned) throw new PaymentError("ACCOUNT_NOT_FOUND");

    if (request.toAccountId !== undefined) {
      const [to] = await tx
        .select({ id: accounts.id })
        .from(accounts)
        .where(and(eq(accounts.orgId, actor.orgId), eq(accounts.id, request.toAccountId), sql`${accounts.kind} <> 'external'`));
      if (!to) throw new PaymentError("ACCOUNT_NOT_FOUND");
    } else {
      const [recipient] = await tx
        .select({ id: recipients.id })
        .from(recipients)
        .where(and(eq(recipients.orgId, actor.orgId), eq(recipients.id, request.recipientId)));
      if (!recipient) throw new PaymentError("RECIPIENT_NOT_FOUND");
    }

    const inserted = await tx
      .insert(scheduledPayments)
      .values({
        orgId: actor.orgId,
        createdBy: actor.userId,
        fromAccountId: request.fromAccountId,
        toAccountId: request.toAccountId ?? null,
        recipientId: request.recipientId ?? null,
        method: request.method ?? null,
        amountCents: request.amountCents,
        memo: request.memo ?? null,
        scheduledFor: request.scheduledFor!,
        idempotencyKey: request.idempotencyKey,
      })
      .onConflictDoNothing({ target: [scheduledPayments.orgId, scheduledPayments.idempotencyKey] })
      .returning({ id: scheduledPayments.id });

    if (inserted.length === 0) {
      const [existing] = await tx
        .select({ id: scheduledPayments.id })
        .from(scheduledPayments)
        .where(and(eq(scheduledPayments.orgId, actor.orgId), eq(scheduledPayments.idempotencyKey, request.idempotencyKey)));
      return { kind: "scheduled" as const, scheduledId: existing!.id, replayed: true };
    }

    await consume?.(tx);
    await tx.insert(auditLog).values({
      orgId: actor.orgId,
      actorUserId: actor.userId,
      action: "payment.scheduled",
      targetId: inserted[0]!.id,
      metadata: { amountCents: request.amountCents, scheduledFor: request.scheduledFor! },
    });
    return { kind: "scheduled" as const, scheduledId: inserted[0]!.id, replayed: false };
  });
}

/** Can't cancel a payment that has already run, or one belonging to another organization. */
export async function cancelScheduledPayment(db: Db, actor: Actor, id: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const canceled = await tx
      .update(scheduledPayments)
      .set({ status: "canceled" })
      .where(and(eq(scheduledPayments.id, id), eq(scheduledPayments.orgId, actor.orgId), eq(scheduledPayments.status, "scheduled")))
      .returning({ id: scheduledPayments.id });
    if (canceled.length === 0) return false;

    await tx.insert(auditLog).values({ orgId: actor.orgId, actorUserId: actor.userId, action: "payment.canceled", targetId: id });
    return true;
  });
}

class ScheduleChanged extends Error {}

export type RunOutcome = "completed" | "failed" | "skipped";

/**
 * Runs one scheduled payment. Moving the money and marking it complete happen in a
 * single transaction, so a crash can't leave one without the other, and a cancellation
 * arriving at the same moment rolls the payment back instead of losing the race.
 */
export async function runScheduledPayment(db: Db, orgId: string, id: string, actorUserId: string | null): Promise<RunOutcome> {
  const [payment] = await db
    .select()
    .from(scheduledPayments)
    .where(and(eq(scheduledPayments.id, id), eq(scheduledPayments.orgId, orgId), eq(scheduledPayments.status, "scheduled")));
  if (!payment) return "skipped";

  const base = {
    orgId,
    actorUserId,
    fromAccountId: payment.fromAccountId,
    amountCents: payment.amountCents,
    // Fixed per scheduled payment, so running it twice still sends once.
    idempotencyKey: `scheduled:${payment.id}`,
    memo: payment.memo ?? undefined,
    onPosted: async (tx: Tx, transactionId: string) => {
      const updated = await tx
        .update(scheduledPayments)
        .set({ status: "completed", transactionId })
        .where(and(eq(scheduledPayments.id, payment.id), eq(scheduledPayments.status, "scheduled")))
        .returning({ id: scheduledPayments.id });
      if (updated.length === 0) throw new ScheduleChanged();
    },
  };

  try {
    if (payment.toAccountId) {
      await transferBetweenAccounts(db, { ...base, toAccountId: payment.toAccountId });
    } else {
      await payRecipient(db, { ...base, recipientId: payment.recipientId!, method: payment.method! });
    }
    return "completed";
  } catch (error) {
    if (error instanceof ScheduleChanged) return "skipped";
    if (!(error instanceof LedgerError)) throw error;

    await db
      .update(scheduledPayments)
      .set({
        status: "failed",
        failureReason: error.code === "INSUFFICIENT_FUNDS" ? "Not enough available funds on the scheduled date." : "This payment couldn't be completed.",
      })
      .where(and(eq(scheduledPayments.id, payment.id), eq(scheduledPayments.status, "scheduled")));
    return "failed";
  }
}

export type SendEarlyOutcome = RunOutcome | "verification_required";

/**
 * Someone choosing to send early is a new decision, so it follows the same rule as any
 * payment. A large one has no code to check here, so it waits for its date instead.
 */
export async function sendScheduledEarly(db: Db, actor: Actor, id: string): Promise<SendEarlyOutcome> {
  const [payment] = await db
    .select({ amountCents: scheduledPayments.amountCents })
    .from(scheduledPayments)
    .where(and(eq(scheduledPayments.id, id), eq(scheduledPayments.orgId, actor.orgId)));
  if (!payment) return "skipped";
  if (requiresVerification(payment.amountCents)) return "verification_required";
  return runScheduledPayment(db, actor.orgId, id, actor.userId);
}

/**
 * Catches up an organization's time-based work: settles older pending payments and
 * runs what's due. Safe to call often, or at the same time from two requests. A real
 * deployment would run this on a job queue; here it runs when the workspace is opened.
 */
export async function processDuePayments(db: Db, orgId: string, now = new Date()) {
  await db
    .update(transactions)
    .set({ status: "posted" })
    .where(
      and(
        eq(transactions.orgId, orgId),
        eq(transactions.status, "pending"),
        lt(transactions.occurredAt, new Date(now.getTime() - SETTLEMENT_MS)),
      ),
    );

  const due = await db
    .select({ id: scheduledPayments.id, createdBy: scheduledPayments.createdBy })
    .from(scheduledPayments)
    .where(
      and(
        eq(scheduledPayments.orgId, orgId),
        eq(scheduledPayments.status, "scheduled"),
        lte(scheduledPayments.scheduledFor, dayKey(now)),
      ),
    )
    .orderBy(asc(scheduledPayments.scheduledFor))
    .limit(DUE_BATCH_SIZE);

  for (const payment of due) {
    await runScheduledPayment(db, orgId, payment.id, payment.createdBy);
  }
}

/** Only the last four digits are kept. The full number is discarded here and never stored. */
export async function addRecipient(
  db: Db,
  actor: Actor,
  input: { name: string; bankName: string; accountNumber: string },
) {
  return db.transaction(async (tx) => {
    const [recipient] = await tx
      .insert(recipients)
      .values({ orgId: actor.orgId, name: input.name, bankName: input.bankName, numberLast4: input.accountNumber.slice(-4) })
      .returning({ id: recipients.id });
    await tx.insert(auditLog).values({
      orgId: actor.orgId,
      actorUserId: actor.userId,
      action: "recipient.added",
      targetId: recipient!.id,
    });
    return recipient!;
  });
}
