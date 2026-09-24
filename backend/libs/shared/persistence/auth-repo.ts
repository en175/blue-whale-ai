import { randomInt } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

/** Auth 用例的 db port 实现（Prisma-backed），满足 core 里 requestSmsCode/loginWithCode 的 db 依赖形状。
 *  字段映射真实表：identity_verification_codes(gmt_expire,is_used) / identity_users(username 唯一, phone 可空, status)。 */

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

/** 自动注册的随机用户名（对齐 Java 的「用户XXXX」）。 */
function randomUsername(): string {
  return "用户" + String(randomInt(0, 10000)).padStart(4, "0");
}

/** Prisma 的唯一约束冲突码。 */
const UNIQUE_VIOLATION = "P2002";

/** 随机用户名撞车后的重试上限。 */
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
      await prisma.identity_verification_codes.create({
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
      const row = await prisma.identity_verification_codes.findFirst({
        where: { phone, code, is_used: false, gmt_expire: { gt: new Date() } },
        orderBy: { id: "desc" },
      });
      return row ? { id: row.id.toString() } : null;
    },

    /**
     * 按手机号找用户，没有就建一个。
     *
     * ⚠️ **创建必须重试**：`username` 现在是**唯一索引**，而随机用户名取自
     * `randomInt(0, 10000)` —— 只有 1 万个取值。按生日问题，**约 120 个用户就有一半概率撞车**，
     * 撞上就是一次 `P2002`，注册直接失败。
     *
     * <p>这个隐患在加唯一索引**之前就存在**：那时撞车只产生两个同名用户，不报错、也没人发现。
     * 唯一索引把「静默重复」变成了「当场失败」——这是好事，但必须同时把重试补上，
     * 否则就是把一个我们自己的缺陷转嫁给正在注册的用户。
     *
     * <p>为什么不改成把随机空间撑大：空间再大也只是把碰撞概率变小，
     * 而唯一索引已经给了我们一个**精确的**碰撞信号（P2002），直接用它即可。
     */
    async upsertUser(phone) {
      const existing = await prisma.identity_users.findFirst({ where: { phone } });
      if (existing) {
        return { id: existing.id.toString(), username: existing.username, phone };
      }

      for (let attempt = 0; attempt < USERNAME_RETRIES; attempt++) {
        try {
          const created = await prisma.identity_users.create({
            data: { phone, username: randomUsername(), status: "NORMAL" },
          });
          return { id: created.id.toString(), username: created.username, phone };
        } catch (error) {
          // 只对用户名撞车重试。其他约束失败（例如 phone 重复说明并发建号）
          // 重试也解决不了，照常抛出——否则真正的错误会变成一次无关的超时。
          if (!isUniqueViolation(error)) throw error;
        }
      }

      throw new Error(
        `自动生成用户名连续 ${USERNAME_RETRIES} 次撞车（phone=${phone}）——` +
          `随机空间过小或索引异常，请检查`,
      );
    },

    async markCodeUsed(codeId) {
      await prisma.identity_verification_codes.update({
        where: { id: BigInt(codeId) },
        data: { is_used: true },
      });
    },
  };
}
