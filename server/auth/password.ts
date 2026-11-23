import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  type ScryptOptions,
} from "node:crypto";

const COST = 16384;
const BLOCK_SIZE = 8;
const PARALLELISM = 1;
const KEY_LENGTH = 32;
const MAX_PASSWORD_LENGTH = 200;
const MIN_PASSWORD_LENGTH = 12;

const derive = (
  password: string,
  salt: Buffer,
  cost: number,
  blockSize: number,
  parallelism: number,
  keyLength: number
) =>
  new Promise<Buffer>((resolve, reject) => {
    const options: ScryptOptions = {
      N: cost,
      r: blockSize,
      p: parallelism,
      maxmem: 64 * 1024 * 1024,
    };
    scryptCallback(password.normalize("NFKC"), salt, keyLength, options, (error, key) =>
      error ? reject(error) : resolve(key as Buffer)
    );
  });

/**
 * Rejects passwords that cannot be stored safely. The message is deliberately
 * generic and is never echoed back with the offending value.
 */
export function passwordPolicyError(password: string): string | undefined {
  if (typeof password !== "string") return "invalid_password";
  if (password.length < MIN_PASSWORD_LENGTH) return "password_too_short";
  if (password.length > MAX_PASSWORD_LENGTH) return "password_too_long";
  if (/[\u0000-\u001f\u007f]/.test(password)) return "password_control_characters";
  if (!/[a-z]/i.test(password) || !/\d/.test(password)) return "password_too_simple";
  return undefined;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, COST, BLOCK_SIZE, PARALLELISM, KEY_LENGTH);
  return [
    "scrypt",
    COST,
    BLOCK_SIZE,
    PARALLELISM,
    salt.toString("base64url"),
    key.toString("base64url"),
  ].join("$");
}

/** Constant-time verification against a stored scrypt envelope. */
export async function verifyPassword(
  password: string,
  envelope: string
): Promise<boolean> {
  if (typeof password !== "string" || password.length > MAX_PASSWORD_LENGTH)
    return false;
  const parts = envelope.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, cost, blockSize, parallelism, salt, hash] = parts;
  if (
    !/^\d+$/.test(cost) ||
    !/^\d+$/.test(blockSize) ||
    !/^\d+$/.test(parallelism) ||
    Number(cost) > 1 << 20
  )
    return false;
  let expected: Buffer;
  let actual: Buffer;
  try {
    expected = Buffer.from(hash, "base64url");
    actual = await derive(
      password,
      Buffer.from(salt, "base64url"),
      Number(cost),
      Number(blockSize),
      Number(parallelism),
      expected.length
    );
  } catch {
    return false;
  }
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** Used for timing parity when no credential exists for an address. */
export const dummyEnvelope = (() => {
  const salt = randomBytes(16);
  return `scrypt$${COST}$${BLOCK_SIZE}$${PARALLELISM}$${salt.toString(
    "base64url"
  )}$${Buffer.alloc(KEY_LENGTH).toString("base64url")}`;
})();
