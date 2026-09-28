import type { PrismaClient } from "@prisma/client";

import { resolveTier, type MembershipPeriod, type TierResolution } from "@lib/core/identity/tier.js";

/**
 * 会员周期的持久化（`bw_memberships`）。
 *
 * <p>本文件只做两件事：**按索引粗筛** + 把行交给 {@link resolveTier} 判定。
 * 「什么算有效会员」的权威定义在 core 侧那个纯函数里，不在这里——
 * 这里的 WHERE 条件是为了走 `idx_bw_memberships__user_status_expiry`，
 * 是性能手段；两处条件若漂移，以纯函数为准。
 */
export interface IdentityMembershipRepo {
  /**
   * 推导用户的当前等级。
   *
   * @param now 判定时刻。由调用方传入，不在内部取 `new Date()`——
   *            同一请求里「现在」必须是一个值。
   */
  resolveTier(userId: string, now: Date): Promise<TierResolution>;
}

export function createIdentityMembershipRepo(prisma: PrismaClient): IdentityMembershipRepo {
  return {
    async resolveTier(userId, now) {
      const rows = await prisma.bw_memberships.findMany({
        where: {
          user_id: BigInt(userId),
          status: "active",
          is_delete: false,
          // NULL = 永久，必须显式放行，否则 `gt` 会把永久会员过滤掉
          OR: [{ expires_at: null }, { expires_at: { gt: now } }],
        },
        select: { tier: true, status: true, expires_at: true },
      });

      const periods: MembershipPeriod[] = rows.map((row) => ({
        tier: row.tier,
        status: row.status,
        expiresAt: row.expires_at,
      }));

      return resolveTier(periods, now);
    },
  };
}
