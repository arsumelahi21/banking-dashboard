import { describe, expect, it } from "vitest";
import { networkKey } from "./network-key";

describe("networkKey", () => {
  it("keeps an IPv4 address whole", () => {
    expect(networkKey("203.0.113.9")).toBe("203.0.113.9");
    expect(networkKey("unknown")).toBe("unknown");
  });

  it("treats every address in an IPv6 /64 as the same client", () => {
    const expected = "2001:db8:1:2::/64";
    expect(networkKey("2001:db8:1:2:aaaa:bbbb:cccc:dddd")).toBe(expected);
    expect(networkKey("2001:db8:1:2:1:1:1:1")).toBe(expected);
    expect(networkKey("2001:0DB8:0001:0002::1")).toBe(expected);
  });

  it("keeps different /64 blocks apart", () => {
    expect(networkKey("2001:db8:1:2::1")).not.toBe(networkKey("2001:db8:1:3::1"));
  });

  it("expands shortened addresses correctly", () => {
    expect(networkKey("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(networkKey("::1")).toBe("0:0:0:0::/64");
  });
});
