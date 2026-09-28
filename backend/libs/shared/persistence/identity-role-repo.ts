import type { PrismaClient } from "@prisma/client";

import { isAdmin } from "@lib/core/identity/roles.js";

/**
 * 角色与用户角色的持久化（`bw_roles` / `bw_user_roles`）。
 *
 * <p>读法是**两个查询**：先取该用户的 role_id 列表，再按 id 取 code。
 * 不做 Prisma relation 是因为整个 schema 都没有用 relation（`user_id` 都是裸 BigInt），
 * 为一处引入关系图会让「哪些表之间真的有外键」这件事变得难以判断。
 *
 * <p>代价是多一次往返；收益是角色表只有个位数行、且可整体缓存——
 * 真到需要合并时，那是加缓存的事，不是改建模的事。
 */
export interface IdentityRoleRepo {
  /** 该用户持有的角色 code（已排除软删的角色行）。 */
  listRoleCodes(userId: string): Promise<string[]>;
  /** 是否具备管理员权限。 */
  isAdmin(userId: string): Promise<boolean>;
  /** 授予角色；已持有（含撤销后再授予）时是幂等的空操作。 */
  grant(userId: string, code: string, grantedBy: string): Promise<void>;
  /** 撤销角色。@return 实际撤销的行数；0 = 本来就没持有 */
  revoke(userId: string, code: string): Promise<number>;
  /** 全系统持有该角色的人数（含被查询者）。 */
  countHolders(code: string): Promise<number>;
}

/** 角色 code 在 `bw_roles` 里不存在（或已被软删）。 */
export class UnknownRoleError extends Error {
  constructor(readonly code: string) {
    super(`未知的角色：${code}`);
    this.name = "UnknownRoleError";
  }
}

export function createIdentityRoleRepo(prisma: PrismaClient): IdentityRoleRepo {
  /**
   * code → role_id。
   *
   * ⚠️ 返回 null 而不是抛错：调用方才知道「查不到角色」意味着什么
   * （授权时是 400，计数时是 0）。
   */
  async function roleIdOf(code: string): Promise<bigint | null> {
    const role = await prisma.bw_roles.findFirst({
      where: { code, is_delete: false },
      select: { id: true },
    });
    return role?.id ?? null;
  }

  /** 授权幂等键。同一 (用户, 角色) 只有一行——撤销后再授予是复用同一行，不是新增。 */
  function grantKey(userId: string, code: string): string {
    return `role:${userId}:${code}`;
  }

  async function listRoleCodes(userId: string): Promise<string[]> {
    const grants = await prisma.bw_user_roles.findMany({
      where: { user_id: BigInt(userId), is_delete: false },
      select: { role_id: true },
    });
    if (grants.length === 0) return [];

    const roles = await prisma.bw_roles.findMany({
      where: {
        id: { in: grants.map((g) => g.role_id) },
        is_delete: false,
      },
      select: { code: true },
    });
    return roles.map((r) => r.code);
  }

  return {
    listRoleCodes,
    async isAdmin(userId) {
      return isAdmin(await listRoleCodes(userId));
    },

    async grant(userId, code, grantedBy) {
      const roleId = await roleIdOf(code);
      if (roleId === null) throw new UnknownRoleError(code);

      // upsert 而不是「先查后插」：撤销是软删（is_delete=1），重新授予要**复用同一行**。
      // 先查后插有两个毛病——有 TOCTOU 窗口，且会把软删的行当成「已持有」而跳过。
      await prisma.bw_user_roles.upsert({
        where: { grant_key: grantKey(userId, code) },
        create: {
          user_id: BigInt(userId),
          role_id: roleId,
          granted_by: grantedBy,
          grant_key: grantKey(userId, code),
          is_delete: false,
        },
        update: { is_delete: false, granted_by: grantedBy },
      });
    },

    async revoke(userId, code) {
      const roleId = await roleIdOf(code);
      if (roleId === null) throw new UnknownRoleError(code);

      const { count } = await prisma.bw_user_roles.updateMany({
        where: {
          user_id: BigInt(userId),
          role_id: roleId,
          is_delete: false,
        },
        data: { is_delete: true },
      });
      return count;
    },

    async countHolders(code) {
      const roleId = await roleIdOf(code);
      if (roleId === null) return 0;
      // grant_key 的 (用户, 角色) 唯一性保证了一人一行，所以行数就是人数
      return prisma.bw_user_roles.count({
        where: { role_id: roleId, is_delete: false },
      });
    },
  };
}
