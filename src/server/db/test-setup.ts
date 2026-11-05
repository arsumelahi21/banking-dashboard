import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

/**
 * Starts each run from an empty test database and applies every migration, so the
 * migrations are proven each time and test data can't pile up on disk. Only a database
 * named as a test one is ever reset. Anywhere else it just migrates.
 */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgres://localhost:5432/banking_dashboard_test";
  const sql = postgres(url, { max: 1, onnotice: () => {} });

  const name = new URL(url).pathname.slice(1);
  if (name.endsWith("_test")) {
    await sql`drop schema if exists public cascade`;
    await sql`drop schema if exists drizzle cascade`;
    await sql`create schema public`;
  }

  await migrate(drizzle(sql), { migrationsFolder: "./drizzle" });
  await sql.end();
}
