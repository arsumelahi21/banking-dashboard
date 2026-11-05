import "server-only";
import { randomBytes, scrypt as scryptCallback, timingSafeEqual, type ScryptOptions } from "node:crypto";

const N = 2 ** 15;
const R = 8;
const P = 1;
const KEY_LENGTH = 32;

function scrypt(password: string, salt: Buffer, keyLength: number, options: ScryptOptions) {
  return new Promise<Buffer>((resolve, reject) => {
    scryptCallback(password.normalize("NFKC"), salt, keyLength, options, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

const optionsFor = (n: number, r: number, p: number): ScryptOptions => ({
  N: n,
  r,
  p,
  maxmem: 128 * n * r * 2,
});

/** Parameters are stored with the hash, so they can be raised later without a migration. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEY_LENGTH, optionsFor(N, R, P));
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, expected] = stored.split("$");
  if (scheme !== "scrypt" || !n || !r || !p || !salt || !expected) return false;

  const expectedKey = Buffer.from(expected, "base64url");
  const key = await scrypt(
    password,
    Buffer.from(salt, "base64url"),
    expectedKey.length,
    optionsFor(Number(n), Number(r), Number(p)),
  );
  return timingSafeEqual(key, expectedKey);
}

let decoy: Promise<string> | undefined;

/**
 * Does the same work as a real check when the email is unknown, so response
 * time doesn't reveal which emails have accounts.
 */
export async function verifyAgainstDecoy(password: string): Promise<void> {
  decoy ??= hashPassword(randomBytes(16).toString("hex"));
  await verifyPassword(password, await decoy);
}
