import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/server/db/client";
import { organizations, rateLimits, sessions } from "@/server/db/schema";
import { installWorkspace, purgeExpired } from "@/server/seed/install";
import { consumeRateLimit, isRateLimited } from "./rate-limit";
import {
  createSessionRecord,
  deleteSessionRecord,
  resolveSession,
  SESSION_ABSOLUTE_MS,
  SESSION_IDLE_MS,
} from "./session-store";

describe("sessions", () => {
  let userId: string;
  let orgId: string;

  beforeAll(async () => {
    ({ userId, orgId } = await getDb().transaction((tx) =>
      installWorkspace(tx, {
        user: { email: `test-${randomUUID()}@example.test`, name: "Sam Test", passwordHash: null },
        expiresAt: null,
      }),
    ));
  });

  afterAll(async () => {
    await closeDb();
  });

  it("resolves a valid token to its user and organization", async () => {
    const { token } = await createSessionRecord(getDb(), userId);
    expect(await resolveSession(getDb(), token)).toMatchObject({ userId, orgId, name: "Sam Test" });
  });

  it("never stores the token itself", async () => {
    const { token } = await createSessionRecord(getDb(), userId);
    const rows = await getDb().select().from(sessions).where(eq(sessions.userId, userId));
    expect(rows.map((row) => row.tokenHash)).not.toContain(token);
  });

  it("rejects unknown tokens", async () => {
    expect(await resolveSession(getDb(), "not-a-real-token")).toBeNull();
  });

  it("ends a session after the idle timeout", async () => {
    const start = new Date();
    const { token } = await createSessionRecord(getDb(), userId, start);
    const later = new Date(start.getTime() + SESSION_IDLE_MS + 1);
    expect(await resolveSession(getDb(), token, later)).toBeNull();
    // Deleted, so going back in time can't revive it.
    expect(await resolveSession(getDb(), token, start)).toBeNull();
  });

  it("keeps an active session alive past the idle window", async () => {
    const start = new Date();
    const { token } = await createSessionRecord(getDb(), userId, start);
    const almostIdle = new Date(start.getTime() + SESSION_IDLE_MS - 1);
    expect(await resolveSession(getDb(), token, almostIdle)).not.toBeNull();
    const pastOriginalWindow = new Date(start.getTime() + SESSION_IDLE_MS + 1000);
    expect(await resolveSession(getDb(), token, pastOriginalWindow)).not.toBeNull();
  });

  it("ends a session at the absolute limit, however active it was", async () => {
    const start = new Date();
    const { token } = await createSessionRecord(getDb(), userId, start);
    let now = start;
    for (let elapsed = SESSION_IDLE_MS / 2; elapsed < SESSION_ABSOLUTE_MS; elapsed += SESSION_IDLE_MS / 2) {
      now = new Date(start.getTime() + elapsed);
      expect(await resolveSession(getDb(), token, now)).not.toBeNull();
    }
    expect(await resolveSession(getDb(), token, new Date(start.getTime() + SESSION_ABSOLUTE_MS))).toBeNull();
  });

  it("ends when its workspace expires, even if the session itself is still valid", async () => {
    const { userId: demoUser, orgId: demoOrg } = await getDb().transaction((tx) =>
      installWorkspace(tx, {
        user: { email: `test-${randomUUID()}@example.test`, name: "Demo", passwordHash: null },
        expiresAt: new Date(Date.now() + 60 * 1000),
      }),
    );
    const { token } = await createSessionRecord(getDb(), demoUser);
    expect(await resolveSession(getDb(), token)).toMatchObject({ orgId: demoOrg });
    await getDb().update(organizations).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(organizations.id, demoOrg));
    expect(await resolveSession(getDb(), token)).toBeNull();
  });

  it("ends immediately on sign out", async () => {
    const { token } = await createSessionRecord(getDb(), userId);
    await deleteSessionRecord(getDb(), token);
    expect(await resolveSession(getDb(), token)).toBeNull();
  });
});

describe("demo cleanup limits", () => {
  const live = (expiresAt: Date | null) =>
    getDb().transaction((tx) =>
      installWorkspace(tx, { user: { email: `test-${randomUUID()}@example.test`, name: "T", passwordHash: null }, expiresAt }),
    );
  const exists = async (id: string) => (await getDb().select().from(organizations).where(eq(organizations.id, id))).length === 1;
  const soon = () => new Date(Date.now() + 3_600_000);

  it("removes the oldest demos beyond the limit, and never a permanent workspace", async () => {
    const permanent = await live(null);
    const oldest = await live(soon());
    const middle = await live(soon());
    const newest = await live(soon());

    for (let pass = 0; pass < 10; pass += 1) await purgeExpired(getDb(), new Date(), 1);

    expect(await exists(oldest.orgId)).toBe(false);
    expect(await exists(middle.orgId)).toBe(false);
    expect(await exists(newest.orgId)).toBe(true);
    expect(await exists(permanent.orgId)).toBe(true);
  }, 60_000);

  it("removes at most five at a time, so one sign-in stays quick", async () => {
    const created = await Promise.all(Array.from({ length: 7 }, () => live(new Date(Date.now() - 1000))));
    await purgeExpired(getDb());
    const remaining = await Promise.all(created.map((org) => exists(org.orgId)));
    expect(remaining.filter(Boolean)).toHaveLength(2);
    await purgeExpired(getDb());
  }, 60_000);

  it("removes expired session records", async () => {
    const { userId } = await live(null);
    const past = new Date(Date.now() - 13 * 60 * 60 * 1000);
    const { token } = await createSessionRecord(getDb(), userId, past);
    await purgeExpired(getDb());
    const rows = await getDb().select().from(sessions).where(eq(sessions.userId, userId));
    expect(rows).toEqual([]);
    expect(await resolveSession(getDb(), token)).toBeNull();
  });
});

describe("rate limiting", () => {
  it("can check a limit without using it up", async () => {
    const key = `test:${randomUUID()}`;
    const limit = { limit: 2, windowSeconds: 60 };
    expect(await isRateLimited(getDb(), key, limit)).toBe(false);
    await consumeRateLimit(getDb(), key, limit);
    expect(await isRateLimited(getDb(), key, limit)).toBe(false);
    expect(await isRateLimited(getDb(), key, limit)).toBe(false);
    await consumeRateLimit(getDb(), key, limit);
    expect(await isRateLimited(getDb(), key, limit)).toBe(true);
  });

  it("stops counting once the window has passed", async () => {
    const key = `test:${randomUUID()}`;
    await consumeRateLimit(getDb(), key, { limit: 1, windowSeconds: 60 });
    expect(await isRateLimited(getDb(), key, { limit: 1, windowSeconds: 60 })).toBe(true);
    await getDb().update(rateLimits).set({ windowStart: new Date(Date.now() - 120_000) });
    expect(await isRateLimited(getDb(), key, { limit: 1, windowSeconds: 60 })).toBe(false);
  });

  it("allows up to the limit and blocks after it", async () => {
    const key = `test:${randomUUID()}`;
    const results = [];
    for (let i = 0; i < 5; i += 1) {
      results.push(await consumeRateLimit(getDb(), key, { limit: 3, windowSeconds: 60 }));
    }
    expect(results).toEqual([true, true, true, false, false]);
  });

  it("can't be beaten by concurrent attempts", async () => {
    const key = `test:${randomUUID()}`;
    const results = await Promise.all(
      Array.from({ length: 12 }, () => consumeRateLimit(getDb(), key, { limit: 5, windowSeconds: 60 })),
    );
    expect(results.filter(Boolean)).toHaveLength(5);
  });

  it("resets after the window and stores no raw keys", async () => {
    const db = getDb();
    const key = `test:${randomUUID()}`;
    await consumeRateLimit(db, key, { limit: 1, windowSeconds: 60 });
    expect(await consumeRateLimit(db, key, { limit: 1, windowSeconds: 60 })).toBe(false);
    await db.update(rateLimits).set({ windowStart: new Date(Date.now() - 120_000) });
    expect(await consumeRateLimit(db, key, { limit: 1, windowSeconds: 60 })).toBe(true);

    const stored = await db.select({ keyHash: rateLimits.keyHash }).from(rateLimits);
    expect(stored.map((row) => row.keyHash)).not.toContain(key);
  });
});
