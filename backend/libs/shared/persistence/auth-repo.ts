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
}

export function createAuthRepo(prisma: PrismaClient): AuthRepo {
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
        ? {
            id: row.id.toString(),
            code: row.code,
            attempts: row.attempts,
            purpose: row.purpose,
          }
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
  };
}
