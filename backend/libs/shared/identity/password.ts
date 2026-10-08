import { compare, hash } from "bcryptjs";

export const BCRYPT_COST = 10;

export const MAX_PASSWORD_BYTES = 72;

export const MIN_PASSWORD_LENGTH = 8;

export class PasswordPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PasswordPolicyError";
  }
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

export async function hashPassword(plain: string): Promise<string> {
  if (plain.length < MIN_PASSWORD_LENGTH) {
    throw new PasswordPolicyError(`密码至少 ${MIN_PASSWORD_LENGTH} 位`);
  }
  if (byteLength(plain) > MAX_PASSWORD_BYTES) {
    throw new PasswordPolicyError(
      `密码过长（${MAX_PASSWORD_BYTES} 字节上限，一个汉字算 3 字节）`,
    );
  }
  return hash(plain, BCRYPT_COST);
}

export async function verifyPassword(
  plain: string,
  storedHash: string | null | undefined,
): Promise<boolean> {
  if (!storedHash) return false;
  try {
    return await compare(plain, storedHash);
  } catch {
    return false;
  }
}

let dummyHashCache: string | null = null;

export async function burnVerificationTime(plain: string): Promise<void> {
  if (!dummyHashCache) {
    dummyHashCache = await hash(
      `no-such-password:${Math.random().toString(36).slice(2)}`,
      BCRYPT_COST,
    );
  }
  await compare(plain, dummyHashCache);
}
