import "server-only";
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z
    .string()
    .regex(/^postgres(ql)?:\/\//, "must be a postgres:// connection string"),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/**
 * Validated server environment. Read lazily so `next build` works without
 * secrets, while a misconfigured deployment fails on first use. The error names
 * the bad variables but never prints their values.
 */
export function env(): Env {
  if (cached) return cached;

  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid server environment: ${problems}`);
  }

  cached = result.data;
  return cached;
}
