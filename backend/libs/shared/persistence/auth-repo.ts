import { randomInt } from "node:crypto";
import type { PrismaClient } from "@prisma/client";


export interface AuthRepo {
  createVerificationCode(record: {
    phone: string;
    code: string;
    ip: string;
    expiresAt: Date;
  }): Promise<unknown>;
  findValidCode(phone: string, code: string): Promise<{ id: string } | null>;
  upsertUser(phone: string): Promise<{
    id: string;
    username: string;
    phone: string;
    created: boolean;
  }>;
  markCodeUsed(codeId: string): Promise<unknown>;
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

export function createAuthRepo(prisma: PrismaClient): AuthRepo {
  return {
    async createVerificationCode(record) {
      await prisma.bw_verification_codes.create({
        data: {
          phone: record.phone,
          code: record.code,
          ip: record.ip,
          gmt_expire: record.expiresAt,
          is_used: false,
        },
      });
    },
    async findValidCode(phone, code) {
      const row = await prisma.bw_verification_codes.findFirst({
        where: { phone, code, is_used: false, gmt_expire: { gt: new Date() } },
        orderBy: { id: "desc" },
      });
      return row ? { id: row.id.toString() } : null;
    },

    async upsertUser(phone) {
      const existing = await prisma.bw_users.findFirst({ where: { phone } });
      if (existing) {
        return { id: existing.id.toString(), username: existing.username, phone, created: false };
      }

      for (let attempt = 0; attempt < USERNAME_RETRIES; attempt++) {
        try {
          const created = await prisma.bw_users.create({
            data: { phone, username: randomUsername(), status: "NORMAL" },
          });
          return { id: created.id.toString(), username: created.username, phone, created: true };
        } catch (error) {
          if (!isUniqueViolation(error)) throw error;
        }
      }

      throw new Error(
        `自动生成用户名连续 ${USERNAME_RETRIES} 次撞车（phone=${phone}）——` +
          `随机空间过小或索引异常，请检查`,
      );
    },

    async markCodeUsed(codeId) {
      await prisma.bw_verification_codes.update({
        where: { id: BigInt(codeId) },
        data: { is_used: true },
      });
    },
  };
}
