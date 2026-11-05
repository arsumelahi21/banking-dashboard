"use server";

import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { SESSION_COOKIE } from "@/lib/session-cookie";
import { verifyAgainstDecoy, verifyPassword } from "@/server/auth/password";
import { networkKey } from "@/lib/network-key";
import { consumeRateLimit, isRateLimited } from "@/server/auth/rate-limit";
import { getSession, requireSession, setSessionCookie } from "@/server/auth/session";
import { createSessionRecord, deleteSessionRecord } from "@/server/auth/session-store";
import { getDb } from "@/server/db/client";
import { auditLog, users } from "@/server/db/schema";
import { logError } from "@/server/log";
import { installWorkspace, purgeExpired } from "@/server/seed/install";

export type AuthFormState = { error?: string };

const DEMO_LIFETIME_MS = 24 * 60 * 60 * 1000;
const LOGIN_WINDOW = { windowSeconds: 15 * 60 };
const LOGIN_IP_LIMIT = { limit: 30, ...LOGIN_WINDOW };
const LOGIN_PAIR_LIMIT = { limit: 5, ...LOGIN_WINDOW };
const LOGIN_EMAIL_LIMIT = { limit: 20, ...LOGIN_WINDOW };
const UNAVAILABLE = "We can't sign you in right now. Please try again in a moment.";
const TOO_MANY_ATTEMPTS = "Too many attempts. Please wait a few minutes and try again.";
// One message for every credential failure, so it can't reveal which emails exist.
const INVALID_CREDENTIALS = "That email and password don't match.";

const credentials = z.object({
  email: z.email().max(254).transform((email) => email.toLowerCase()),
  password: z.string().min(1).max(256),
});

async function clientIp(): Promise<string> {
  // Set by the hosting platform, which overwrites any value the client sends.
  return networkKey((await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown");
}

/**
 * Each action does its database work inside a try, and redirects outside it:
 * redirect() works by throwing, so catching it would break the sign-in.
 */
export async function signIn(_previous: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = credentials.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: INVALID_CREDENTIALS };
  const { email, password } = parsed.data;

  let session: { token: string; expiresAt: Date };
  try {
    const db = getDb();
    // Checked first and alone, so a blocked address stops here and writes nothing more.
    const address = await clientIp();
    if (!(await consumeRateLimit(db, `login:ip:${address}`, LOGIN_IP_LIMIT))) return { error: TOO_MANY_ATTEMPTS };

    // Only wrong passwords use these up. The tighter one is per email and address, so
    // someone guessing from elsewhere can't lock the real person out of their account.
    const emailAndAddress = `login:email-ip:${email}:${address}`;
    const emailOverall = `login:email:${email}`;
    const [pairBlocked, emailBlocked] = await Promise.all([
      isRateLimited(db, emailAndAddress, LOGIN_PAIR_LIMIT),
      isRateLimited(db, emailOverall, LOGIN_EMAIL_LIMIT),
    ]);
    if (pairBlocked || emailBlocked) return { error: TOO_MANY_ATTEMPTS };

    const recordFailure = () =>
      Promise.all([
        consumeRateLimit(db, emailAndAddress, LOGIN_PAIR_LIMIT),
        consumeRateLimit(db, emailOverall, LOGIN_EMAIL_LIMIT),
      ]);

    const [user] = await db
      .select({ id: users.id, orgId: users.orgId, passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.email, email));

    if (!user?.passwordHash) {
      await verifyAgainstDecoy(password);
      await recordFailure();
      return { error: INVALID_CREDENTIALS };
    }

    if (!(await verifyPassword(password, user.passwordHash))) {
      await recordFailure();
      await db.insert(auditLog).values({ orgId: user.orgId, actorUserId: user.id, action: "auth.login_failed" });
      return { error: INVALID_CREDENTIALS };
    }

    session = await createSessionRecord(db, user.id);
    await db.insert(auditLog).values({ orgId: user.orgId, actorUserId: user.id, action: "auth.login" });
  } catch (error) {
    logError("Sign in failed", error);
    return { error: UNAVAILABLE };
  }

  await setSessionCookie(session.token, session.expiresAt);
  redirect("/overview");
}

/** Gives each visitor a private, freshly seeded workspace that nobody else can see. */
export async function signInDemo(): Promise<AuthFormState> {
  let session: { token: string; expiresAt: Date };
  try {
    const db = getDb();
    const allowed = await consumeRateLimit(db, `demo:ip:${await clientIp()}`, {
      limit: 20,
      windowSeconds: 60 * 60,
    });
    if (!allowed) return { error: TOO_MANY_ATTEMPTS };

    // Best effort: a failed cleanup must never stop someone from signing in.
    await purgeExpired(db).catch((error) => logError("Demo cleanup failed", error));

    session = await db.transaction(async (tx) => {
      const { orgId, userId } = await installWorkspace(tx, {
        user: {
          email: `demo-${randomUUID()}@demo.invalid`,
          name: "Alex Morgan",
          passwordHash: null,
        },
        expiresAt: new Date(Date.now() + DEMO_LIFETIME_MS),
      });
      await tx.insert(auditLog).values({ orgId, actorUserId: userId, action: "auth.demo_started" });
      return createSessionRecord(tx, userId);
    });
  } catch (error) {
    logError("Demo sign in failed", error);
    return { error: UNAVAILABLE };
  }

  await setSessionCookie(session.token, session.expiresAt);
  redirect("/overview");
}

/** Counts as activity for the idle timeout: reading the session refreshes it. */
export async function keepSessionAlive(): Promise<void> {
  await requireSession();
}

export async function signOut(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;

  if (token) {
    // The cookie is removed even if the database can't be reached right now.
    try {
      const session = await getSession();
      const db = getDb();
      if (session) {
        await db.insert(auditLog).values({ orgId: session.orgId, actorUserId: session.userId, action: "auth.logout" });
      }
      // Deleting the record ends the session on the server, not just in this browser.
      await deleteSessionRecord(db, token);
    } catch (error) {
      logError("Sign out couldn't reach the database", error);
    }
  }

  store.delete(SESSION_COOKIE);
  redirect("/login");
}
