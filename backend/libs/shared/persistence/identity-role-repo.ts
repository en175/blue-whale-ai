import type { PrismaClient } from "@prisma/client";

import { isAdmin } from "@lib/core/identity/roles.js";

/**
 * 角色与用户角色的持久化（`identity_roles` / `identity_user_roles`）。
 *
 * <p>本文件的读法是**两个查询**：先取该用户的 role_id 列表，再按 id 取 code。
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
}

export function createIdentityRoleRepo(prisma: PrismaClient): IdentityRoleRepo {
  async function listRoleCodes(userId: string): Promise<string[]> {
    const grants = await prisma.identity_user_roles.findMany({
      where: { user_id: BigInt(userId), is_delete: false },
      select: { role_id: true },
    });
    if (grants.length === 0) return [];

    const roles = await prisma.identity_roles.findMany({
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
  };
}
