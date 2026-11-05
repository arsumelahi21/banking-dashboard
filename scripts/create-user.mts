/**
 * Creates a password-login user with a seeded workspace. The password comes from
 * the environment so no credentials ever live in the repository.
 *
 *   SEED_USER_EMAIL=you@example.com SEED_USER_PASSWORD=... npm run db:create-user
 */
import { existsSync } from "node:fs";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const { hashPassword } = await import("@/server/auth/password");
const { closeDb, getDb } = await import("@/server/db/client");
const { installWorkspace } = await import("@/server/seed/install");

const email = process.env.SEED_USER_EMAIL?.toLowerCase();
const password = process.env.SEED_USER_PASSWORD;
const expiresInHours = Number(process.env.SEED_USER_EXPIRES_IN_HOURS ?? 0);

if (!email || !password || password.length < 12) {
  console.error("Set SEED_USER_EMAIL and SEED_USER_PASSWORD (at least 12 characters).");
  process.exit(1);
}

const passwordHash = await hashPassword(password);
await getDb().transaction((tx) =>
  installWorkspace(tx, {
    user: { email, name: process.env.SEED_USER_NAME ?? "Alex Morgan", passwordHash },
    expiresAt: expiresInHours > 0 ? new Date(Date.now() + expiresInHours * 60 * 60 * 1000) : null,
  }),
);
await closeDb();
console.log(`Created workspace for ${email}`);
