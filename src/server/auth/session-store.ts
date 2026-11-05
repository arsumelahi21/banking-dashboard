import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { SESSION_IDLE_MS } from "@/lib/session-cookie";
import type { Db, Tx } from "@/server/db/client";
import { organizations, sessions, users } from "@/server/db/schema";

export { SESSION_IDLE_MS };
export const SESSION_ABSOLUTE_MS = 12 * 60 * 60 * 1000;
/** Avoids a database write on every page view. */
const TOUCH_INTERVAL_MS = 60 * 1000;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Returns the token for the cookie. Only its hash is stored. */
export async function createSessionRecord(db: Db | Tx, userId: string, now = new Date()) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + SESSION_ABSOLUTE_MS);
  await db.insert(sessions).values({
    tokenHash: hashToken(token),
    userId,
    expiresAt,
    lastSeenAt: now,
    createdAt: now,
  });
  return { token, expiresAt };
}

export async function deleteSessionRecord(db: Db, token: string) {
  await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
}

export type Session = {
  userId: string;
  orgId: string;
  name: string;
  email: string;
  role: "owner" | "member";
  orgName: string;
};

/** The only way a cookie token becomes an identity. Expired sessions are deleted. */
export async function resolveSession(db: Db, token: string, now = new Date()): Promise<Session | null> {
  const tokenHash = hashToken(token);
  const [row] = await db
    .select({
      expiresAt: sessions.expiresAt,
      lastSeenAt: sessions.lastSeenAt,
      userId: users.id,
      orgId: users.orgId,
      name: users.name,
      email: users.email,
      role: users.role,
      orgName: organizations.name,
      orgExpiresAt: organizations.expiresAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .innerJoin(organizations, eq(organizations.id, users.orgId))
    .where(eq(sessions.tokenHash, tokenHash));

  if (!row) return null;

  const idleFor = now.getTime() - row.lastSeenAt.getTime();
  const workspaceExpired = row.orgExpiresAt !== null && row.orgExpiresAt <= now;
  if (row.expiresAt <= now || idleFor >= SESSION_IDLE_MS || workspaceExpired) {
    await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
    return null;
  }

  if (idleFor >= TOUCH_INTERVAL_MS) {
    await db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.tokenHash, tokenHash));
  }

  return {
    userId: row.userId,
    orgId: row.orgId,
    name: row.name,
    email: row.email,
    role: row.role,
    orgName: row.orgName,
  };
}
