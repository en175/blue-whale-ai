import type { PrismaClient } from "@prisma/client";

/**
 * 登录日志（`bw_login_logs`）。
 *
 * <p>两个用途，都是事后才用得上、事后又补不回来的：
 * <ul>
 *   <li><b>安全</b>：某个 IP 是不是在撞库、某个账号最近从哪登录过</li>
 *   <li><b>客服</b>：「我明明登录成功了」——日志能给出时间、IP、成败</li>
 * </ul>
 *
 * <p>写失败**不能阻断登录**：日志是旁路，不是登录的前置条件。
 * 但也不能静默——调用方要 catch 并记 error，见 `auth.controller.ts` 的用法。
 */
export interface IdentityLoginLogRepo {
  record(entry: {
    /** 登录失败时用户可能压根不存在，此时传 null */
    userId?: string | null | undefined;
    username: string;
    ip: string;
    userAgent: string;
    success: boolean;
    /** 失败原因；成功时省略。⚠️ `| undefined` 是本仓 exactOptionalPropertyTypes 的要求 */
    reason?: string | undefined;
  }): Promise<void>;
}

export function createIdentityLoginLogRepo(prisma: PrismaClient): IdentityLoginLogRepo {
  return {
    async record(entry) {
      await prisma.bw_login_logs.create({
        data: {
          user_id: entry.userId == null ? null : BigInt(entry.userId),
          username: entry.username,
          ip: entry.ip,
          // 超长 UA 直接截断而不是让整条日志写失败——留痕比完整更重要
          user_agent: entry.userAgent.slice(0, 255),
          success: entry.success,
          reason: (entry.reason ?? "").slice(0, 64),
        },
      });
    },
  };
}
