"use server";

import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { SESSION_COOKIE } from "@/lib/session-cookie";
import { verifyAgainstDecoy, verifyPassword } from "@/server/auth/password";
import { consumeRateLimit } from "@/server/auth/rate-limit";
import { getSession, setSessionCookie } from "@/server/auth/session";
import { createSessionRecord, deleteSessionRecord } from "@/server/auth/session-store";
import { getDb } from "@/server/db/client";
import { auditLog, users } from "@/server/db/schema";
import { installWorkspace, purgeExpired } from "@/server/seed/install";

export type AuthFormState = { error?: string };

const DEMO_LIFETIME_MS = 24 * 60 * 60 * 1000;
const TOO_MANY_ATTEMPTS = "Too many attempts. Please wait a few minutes and try again.";
// One message for every credential failure, so it can't reveal which emails exist.
const INVALID_CREDENTIALS = "That email and password don't match.";

const credentials = z.object({
  email: z.email().max(254).transform((email) => email.toLowerCase()),
  password: z.string().min(1).max(256),
});

async function clientIp(): Promise<string> {
  // Set by the hosting platform, which overwrites any value the client sends.
  return (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

export async function signIn(_previous: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = credentials.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: INVALID_CREDENTIALS };
  const { email, password } = parsed.data;

  const db = getDb();
  const window = { windowSeconds: 15 * 60 };
  const [ipAllowed, emailAllowed] = await Promise.all([
    consumeRateLimit(db, `login:ip:${await clientIp()}`, { limit: 30, ...window }),
    consumeRateLimit(db, `login:email:${email}`, { limit: 5, ...window }),
  ]);
  if (!ipAllowed || !emailAllowed) return { error: TOO_MANY_ATTEMPTS };

  const [user] = await db
    .select({ id: users.id, orgId: users.orgId, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.email, email));

  if (!user?.passwordHash) {
    await verifyAgainstDecoy(password);
    return { error: INVALID_CREDENTIALS };
  }

  if (!(await verifyPassword(password, user.passwordHash))) {
    await db.insert(auditLog).values({ orgId: user.orgId, actorUserId: user.id, action: "auth.login_failed" });
    return { error: INVALID_CREDENTIALS };
  }

  const { token, expiresAt } = await createSessionRecord(db, user.id);
  await db.insert(auditLog).values({ orgId: user.orgId, actorUserId: user.id, action: "auth.login" });
  await setSessionCookie(token, expiresAt);
  redirect("/overview");
}

/** Gives each visitor a private, freshly seeded workspace that nobody else can see. */
export async function signInDemo(): Promise<AuthFormState> {
  const db = getDb();
  const allowed = await consumeRateLimit(db, `demo:ip:${await clientIp()}`, {
    limit: 20,
    windowSeconds: 60 * 60,
  });
  if (!allowed) return { error: TOO_MANY_ATTEMPTS };

  // Best effort: a failed cleanup must never stop someone from signing in.
  await purgeExpired(db).catch((error) => console.error("Demo cleanup failed", error));

  const { token, expiresAt } = await db.transaction(async (tx) => {
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

  await setSessionCookie(token, expiresAt);
  redirect("/overview");
}

export async function signOut(): Promise<void> {
  const session = await getSession();
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;

  if (token) {
    const db = getDb();
    if (session) {
      await db.insert(auditLog).values({ orgId: session.orgId, actorUserId: session.userId, action: "auth.logout" });
    }
    // Deleting the record ends the session on the server, not just in this browser.
    await deleteSessionRecord(db, token);
  }

  store.delete(SESSION_COOKIE);
  redirect("/login");
}
