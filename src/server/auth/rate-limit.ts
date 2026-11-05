import "server-only";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Db } from "@/server/db/client";

/**
 * Counts an attempt and reports whether it is allowed. The single atomic upsert
 * means concurrent attempts can't slip past the limit. Keys are hashed so IPs
 * and emails aren't stored.
 */
export async function consumeRateLimit(
  db: Db,
  key: string,
  { limit, windowSeconds }: { limit: number; windowSeconds: number },
): Promise<boolean> {
  const keyHash = createHash("sha256").update(key).digest("hex");
  const expired = sql`rate_limits.window_start < now() - make_interval(secs => ${windowSeconds}::double precision)`;

  const rows = await db.execute<{ count: number }>(sql`
    insert into rate_limits (key_hash, window_start, count)
    values (${keyHash}, now(), 1)
    on conflict (key_hash) do update set
      count = case when ${expired} then 1 else rate_limits.count + 1 end,
      window_start = case when ${expired} then now() else rate_limits.window_start end
    returning count
  `);

  return Number(rows[0]?.count) <= limit;
}
