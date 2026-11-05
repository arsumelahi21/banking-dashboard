import "server-only";

type ErrorLike = { name?: unknown; code?: unknown; message?: unknown; cause?: unknown };

/**
 * Database errors carry the failed query and its parameters, which can include memo
 * text, emails and session hashes. This records what's needed to diagnose a problem:
 * where it happened and the underlying cause, without the query or its values.
 */
export function summarizeError(error: unknown): { name: string; code?: string; cause?: string } {
  let current = error as ErrorLike | undefined;
  // Limited, because an error's cause can point back at itself.
  for (let depth = 0; depth < 5 && current && typeof current === "object" && current.cause && typeof current.cause === "object"; depth += 1) {
    current = current.cause as ErrorLike;
  }

  const isQueryWrapper = typeof current?.message === "string" && current.message.startsWith("Failed query");
  return {
    name: typeof current?.name === "string" ? current.name : "UnknownError",
    code: typeof current?.code === "string" ? current.code : undefined,
    // A database's own message can quote the values involved, and its code identifies the problem.
    cause: typeof current?.message === "string" && !isQueryWrapper && typeof current?.code !== "string" ? current.message.slice(0, 200) : undefined,
  };
}

export function logError(context: string, error: unknown): void {
  console.error(context, summarizeError(error));
}
