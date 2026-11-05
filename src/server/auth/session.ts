import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { SESSION_COOKIE } from "@/lib/session-cookie";
import { getDb } from "@/server/db/client";
import { resolveSession, type Session } from "@/server/auth/session-store";

/** Resolved once per request, however many components ask. */
export const getSession = cache(async (): Promise<Session | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? resolveSession(getDb(), token) : null;
});

/**
 * Every page and action that touches customer data starts here, and uses the
 * returned orgId to scope its queries. The orgId never comes from the client.
 */
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

/** Only callable from a Server Action or Route Handler. */
export async function setSessionCookie(token: string, expiresAt: Date) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}
