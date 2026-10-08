import type { PrismaClient } from "@prisma/client";

import { resolveTier, type MembershipPeriod, type TierResolution } from "@lib/core/identity/tier.js";

export interface IdentityMembershipRepo {
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
