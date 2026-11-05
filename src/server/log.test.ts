import { describe, expect, it } from "vitest";
import { summarizeError } from "./log";

function queryError() {
  const driver = Object.assign(new Error("connection refused"), { name: "PostgresError", code: "ECONNREFUSED" });
  return new Error('Failed query: update transactions set memo = $1\nparams: secret memo text,person@example.com', { cause: driver });
}

describe("summarizeError", () => {
  it("keeps the underlying cause and leaves out the query and its values", () => {
    const summary = summarizeError(queryError());
    expect(summary).toEqual({ name: "PostgresError", code: "ECONNREFUSED" });
    const text = JSON.stringify(summary);
    expect(text).not.toContain("secret memo");
    expect(text).not.toContain("person@example.com");
    expect(text).not.toContain("update transactions");
  });

  it("leaves out a query error's text when it has no cause", () => {
    const summary = summarizeError(new Error("Failed query: select * from users\nparams: person@example.com"));
    expect(JSON.stringify(summary)).not.toContain("person@example.com");
    expect(summary.cause).toBeUndefined();
  });

  it("handles anything that gets thrown", () => {
    expect(summarizeError("just a string")).toEqual({ name: "UnknownError" });
    expect(summarizeError(null)).toEqual({ name: "UnknownError" });
    expect(summarizeError(undefined)).toEqual({ name: "UnknownError" });
  });

  it("limits the length of what it records", () => {
    expect(summarizeError(new Error("x".repeat(1000))).cause).toHaveLength(200);
  });

  it("doesn't hang on an error that causes itself", () => {
    const error = new Error("loop") as Error & { cause?: unknown };
    error.cause = error;
    expect(summarizeError(error).name).toBe("Error");
  });
});
