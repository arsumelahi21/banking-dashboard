/**
 * The key rate limits use for a client address. Someone given an IPv6 address usually
 * controls the whole /64 block, so limiting single addresses would be easy to dodge.
 */
export function networkKey(address: string): string {
  if (!address.includes(":")) return address;

  const [head = "", tail = ""] = address.toLowerCase().split("%")[0]!.split("::");
  const headGroups = head ? head.split(":") : [];
  const tailGroups = tail ? tail.split(":") : [];
  const missing = Math.max(0, 8 - headGroups.length - tailGroups.length);
  const groups = [...headGroups, ...Array<string>(missing).fill("0"), ...tailGroups];
  return `${groups.slice(0, 4).map((group) => group.replace(/^0+(?=.)/, "")).join(":")}::/64`;
}
