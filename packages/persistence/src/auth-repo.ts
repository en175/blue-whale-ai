import { randomInt } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

/** Auth 用例的 db port 实现（Prisma-backed），满足 core 里 requestSmsCode/loginWithCode 的 db 依赖形状。
 *  字段映射 Java 真实表：verification_codes(gmt_expire,is_used) / users(phone unique, username, status)。 */

export interface AuthRepo {
  createVerificationCode(record: {
    phone: string;
    code: string;
    ip: string;
    expiresAt: Date;
  }): Promise<unknown>;
  findValidCode(phone: string, code: string): Promise<{ id: string } | null>;
  upsertUser(phone: string): Promise<{ id: string; username: string; phone: string }>;
  markCodeUsed(codeId: string): Promise<unknown>;
}

function randomUsername(): string {
  // 对齐 Java：自动注册随机 "用户XXXX"
  return "用户" + String(randomInt(0, 10000)).padStart(4, "0");
}

export function createAuthRepo(prisma: PrismaClient): AuthRepo {
  return {
    async createVerificationCode(record) {
      await prisma.verification_codes.create({
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
      const row = await prisma.verification_codes.findFirst({
        where: { phone, code, is_used: false, gmt_expire: { gt: new Date() } },
        orderBy: { id: "desc" },
      });
      return row ? { id: row.id.toString() } : null;
    },
    async upsertUser(phone) {
      const existing = await prisma.users.findFirst({ where: { phone } });
      if (existing) {
        return { id: existing.id.toString(), username: existing.username, phone };
      }
      const created = await prisma.users.create({
        data: { phone, username: randomUsername(), status: "NORMAL" },
      });
      return { id: created.id.toString(), username: created.username, phone };
    },
    async markCodeUsed(codeId) {
      await prisma.verification_codes.update({
        where: { id: BigInt(codeId) },
        data: { is_used: true },
      });
    },
  };
}
