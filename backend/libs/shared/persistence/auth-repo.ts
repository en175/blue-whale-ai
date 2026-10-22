import { randomInt } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

export interface AuthRepo {
  createVerificationCode(record: {
    phone: string;
    purpose: string;
    code: string;
    ip: string;
    expiresAt: Date;
  }): Promise<{ id: string }>;
  invalidateOtherCodes(phone: string, purpose: string, keepId: string): Promise<number>;
  findActiveCode(phone: string, purposes: readonly string[]): Promise<{
    id: string;
    code: string;
    attempts: number;
    purpose: string;
  } | null>;
  incrementAttempts(codeId: string): Promise<number>;
  consumeCode(codeId: string): Promise<boolean>;
  findByPhone(phone: string): Promise<{
    id: string;
    username: string;
    nickname: string | null;
    phone: string;
    status: string;
    isDelete: boolean;
    created: boolean;
  } | null>;
  upsertUser(phone: string): Promise<{
    id: string;
    username: string;
    nickname: string | null;
    phone: string;
    status: string;
    isDelete: boolean;
    created: boolean;
  }>;
}

const DEFAULT_NICKNAME_PREFIX = "蓝鲸用户_";
const NICKNAME_RANDOM_LENGTH = 6;
const NICKNAME_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

function randomNickname(): string {
  let suffix = "";
  for (let index = 0; index < NICKNAME_RANDOM_LENGTH; index++) {
    suffix += NICKNAME_ALPHABET[randomInt(0, NICKNAME_ALPHABET.length)];
  }
  return `${DEFAULT_NICKNAME_PREFIX}${suffix}`;
}

function randomUsername(): string {
  return "用户" + String(randomInt(0, 10000)).padStart(4, "0");
}

const UNIQUE_VIOLATION = "P2002";

const USERNAME_RETRIES = 5;

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === UNIQUE_VIOLATION
  );
}

type PhoneUserRow = {
  id: bigint;
  username: string;
  nickname: string | null;
  phone: string | null;
  status: string;
  is_delete: boolean;
};

function hydrateUser(row: PhoneUserRow, created: boolean) {
  return {
    id: row.id.toString(),
    username: row.username,
    nickname: row.nickname,
    phone: row.phone ?? "",
    status: row.status,
    isDelete: row.is_delete,
    created,
  };
}

const USER_SELECT = {
  id: true,
  username: true,
  nickname: true,
  phone: true,
  status: true,
  is_delete: true,
} as const;

export function createAuthRepo(prisma: PrismaClient): AuthRepo {
  async function findByPhone(phone: string) {
    const row = await prisma.bw_users.findFirst({ where: { phone }, select: USER_SELECT });
    return row ? hydrateUser(row, false) : null;
  }

  return {
    async createVerificationCode(record) {
      const created = await prisma.bw_verification_codes.create({
        data: {
          phone: record.phone,
          purpose: record.purpose,
          code: record.code,
          ip: record.ip,
          gmt_expire: record.expiresAt,
          is_used: false,
          attempts: 0,
        },
      });
      return { id: created.id.toString() };
    },

    async invalidateOtherCodes(phone, purpose, keepId) {
      const result = await prisma.bw_verification_codes.updateMany({
        where: {
          phone,
          purpose,
          is_used: false,
          id: { not: BigInt(keepId) },
        },
        data: { is_used: true },
      });
      return result.count;
    },

    async findActiveCode(phone, purposes) {
      const row = await prisma.bw_verification_codes.findFirst({
        where: {
          phone,
          purpose: { in: [...purposes] },
          is_used: false,
          gmt_expire: { gt: new Date() },
        },
        orderBy: { id: "desc" },
        select: { id: true, code: true, attempts: true, purpose: true },
      });
      return row
        ? { id: row.id.toString(), code: row.code, attempts: row.attempts, purpose: row.purpose }
        : null;
    },

    async incrementAttempts(codeId) {
      const row = await prisma.bw_verification_codes.update({
        where: { id: BigInt(codeId) },
        data: { attempts: { increment: 1 } },
        select: { attempts: true },
      });
      return row.attempts;
    },

    async consumeCode(codeId) {
      const result = await prisma.bw_verification_codes.updateMany({
        where: { id: BigInt(codeId), is_used: false },
        data: { is_used: true },
      });
      return result.count === 1;
    },

    findByPhone,

    async upsertUser(phone) {
      const existing = await findByPhone(phone);
      if (existing) return existing;

      for (let attempt = 0; attempt < USERNAME_RETRIES; attempt++) {
        try {
          const created = await prisma.bw_users.create({
            data: {
              phone,
              username: randomUsername(),
              nickname: randomNickname(),
              status: "NORMAL",
            },
            select: USER_SELECT,
          });
          return hydrateUser(created, true);
        } catch (error) {
          if (!isUniqueViolation(error)) throw error;
          const raced = await findByPhone(phone);
          if (raced) return raced;
        }
      }

      throw new Error(
        `自动生成用户名连续 ${USERNAME_RETRIES} 次撞车（phone=${phone}）——` +
          `随机空间过小或索引异常，请检查`,
      );
    },
  };
}
