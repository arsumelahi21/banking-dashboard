import { defineConfig } from "vitest/config";
import base from "./vitest.config";

const databaseUrl = process.env.TEST_DATABASE_URL ?? "postgres://localhost:5432/banking_dashboard_test";

/**
 * Tests that need a real Postgres, because the guarantees live in the database.
 * Not built with mergeConfig: it concatenates lists, so the base config's exclude
 * would silently remove every database test.
 */
export default defineConfig({
  resolve: base.resolve,
  test: {
    include: ["src/**/*.db.test.ts"],
    env: { DATABASE_URL: databaseUrl },
    globalSetup: ["./src/server/db/test-setup.ts"],
    fileParallelism: false,
    passWithNoTests: false,
    testTimeout: 30_000,
  },
});
