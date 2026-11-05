import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";

/**
 * Creates a password user for the sign-in tests. The password is random for each
 * run and the workspace expires quickly, so no known credentials can linger in
 * whichever database this points at.
 */
export default function globalSetup() {
  process.env.E2E_USER_EMAIL = `e2e-${randomUUID()}@example.test`;
  process.env.E2E_USER_PASSWORD = randomBytes(24).toString("base64url");

  execFileSync("npm", ["run", "-s", "db:create-user"], {
    stdio: "inherit",
    env: {
      ...process.env,
      SEED_USER_EMAIL: process.env.E2E_USER_EMAIL,
      SEED_USER_PASSWORD: process.env.E2E_USER_PASSWORD,
      SEED_USER_EXPIRES_IN_HOURS: "1",
    },
  });
}
