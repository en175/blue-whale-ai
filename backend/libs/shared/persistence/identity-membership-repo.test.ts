import { describe, expect, it, vi } from "vitest";

import { createIdentityMembershipRepo } from "./identity-membership-repo.js";

const NOW = new Date("2026-09-24T12:00:00+08:00");
const FUTURE = new Date("2026-10-24T12:00:00+08:00");

/** 只实现本 repo 用到的那一个方法——不引真库，也不起 Prisma 客户端。 */
function fakePrisma(rows: Array<{ tier: string; status: string; expires_at: Date | null }>) {
  const findMany = vi.fn().mockResolvedValue(rows);
  return {
    prisma: { identity_memberships: { findMany } } as unknown as Parameters<
      typeof createIdentityMembershipRepo
    >[0],
    findMany,
  };
}

describe("identity-membership-repo", () => {
  it("把行交给纯函数判定，不自己算等级", async () => {
    const { prisma } = fakePrisma([{ tier: "pro", status: "active", expires_at: FUTURE }]);

    await expect(createIdentityMembershipRepo(prisma).resolveTier("9001", NOW)).resolves.toEqual({
      tier: "pro",
      unknownTiers: [],
    });
  });

  it("SQL 条件放行永久会员（expires_at IS NULL）", async () => {
    const { prisma, findMany } = fakePrisma([{ tier: "max", status: "active", expires_at: null }]);

    const resolution = await createIdentityMembershipRepo(prisma).resolveTier("9001", NOW);

    expect(resolution.tier).toBe("max");
    // 永久会员被 NULL 条件漏掉是个很容易犯的错：`gt` 遇到 NULL 是 false。
    // 这里直接断言查询里带了显式的 NULL 分支。
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [{ expires_at: null }, { expires_at: { gt: NOW } }],
        }),
      }),
    );
  });

  it("无会员的用户是 free", async () => {
    const { prisma } = fakePrisma([]);
    await expect(createIdentityMembershipRepo(prisma).resolveTier("9001", NOW)).resolves.toEqual({
      tier: "free",
      unknownTiers: [],
    });
  });

  it("脏等级原样往上报，不被吞掉", async () => {
    const { prisma } = fakePrisma([{ tier: "vip", status: "active", expires_at: FUTURE }]);

    const resolution = await createIdentityMembershipRepo(prisma).resolveTier("9001", NOW);

    expect(resolution.tier).toBe("free");
    expect(resolution.unknownTiers).toEqual(["vip"]);
  });
});
