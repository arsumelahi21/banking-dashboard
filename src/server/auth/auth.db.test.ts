import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/server/db/client";
import { rateLimits, sessions } from "@/server/db/schema";
import { installWorkspace } from "@/server/seed/install";
import { consumeRateLimit } from "./rate-limit";
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

  it("ends immediately on sign out", async () => {
    const { token } = await createSessionRecord(getDb(), userId);
    await deleteSessionRecord(getDb(), token);
    expect(await resolveSession(getDb(), token)).toBeNull();
  });
});

describe("rate limiting", () => {
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
