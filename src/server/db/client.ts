import "server-only";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/server/env";

type Connection = { sql: postgres.Sql; db: PostgresJsDatabase };

// Kept on globalThis so hot reloads in development don't leak connections.
const globalForDb = globalThis as typeof globalThis & { __db?: Connection };

export function getDb(): PostgresJsDatabase {
  if (!globalForDb.__db) {
    const sql = postgres(env().DATABASE_URL, {
      max: 5,
      connect_timeout: 5,
      idle_timeout: 20,
      // Neon's pooled endpoint runs PgBouncer, which can't use prepared statements.
      prepare: false,
    });
    globalForDb.__db = { sql, db: drizzle(sql) };
  }
  return globalForDb.__db.db;
}
