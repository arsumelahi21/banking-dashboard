import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/server/db/client";

/** Liveness and database check. Failure details go to logs, never the response. */
export async function GET() {
  const headers = { "Cache-Control": "no-store" };

  try {
    await getDb().execute(sql`select 1`);
    return NextResponse.json({ status: "ok" }, { headers });
  } catch (error) {
    console.error("Health check failed", error);
    return NextResponse.json({ status: "unavailable" }, { status: 503, headers });
  }
}
