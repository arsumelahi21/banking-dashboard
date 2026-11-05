import { describe, expect, it } from "vitest";
import { hashPassword, verifyAgainstDecoy, verifyPassword } from "./password";

describe("password hashing", () => {
  it("accepts the right password and rejects the wrong one", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(await verifyPassword("correct horse battery", hash)).toBe(true);
    expect(await verifyPassword("correct horse batterz", hash)).toBe(false);
  });

  it("salts hashes and never contains the password", async () => {
    const [first, second] = await Promise.all([hashPassword("same-password"), hashPassword("same-password")]);
    expect(first).not.toBe(second);
    expect(first).not.toContain("same-password");
  });

  it("rejects malformed stored values instead of throwing", async () => {
    expect(await verifyPassword("x", "")).toBe(false);
    expect(await verifyPassword("x", "md5$abc")).toBe(false);
  });

  it("completes the decoy check for unknown users", async () => {
    await expect(verifyAgainstDecoy("anything")).resolves.toBeUndefined();
  });
});
