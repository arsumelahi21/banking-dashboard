import { describe, expect, it } from "vitest";
import { buildCsp } from "./csp";

describe("buildCsp", () => {
  it("restricts scripts to the request nonce", () => {
    const csp = buildCsp("abc123", { isDev: false });
    expect(csp).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
  });

  it("never allows eval in production", () => {
    expect(buildCsp("n", { isDev: false })).not.toContain("unsafe-eval");
    expect(buildCsp("n", { isDev: true })).toContain("unsafe-eval");
  });

  it("blocks framing, plugins and cross-origin form posts", () => {
    const csp = buildCsp("n", { isDev: false });
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("form-action 'self'");
  });
});
