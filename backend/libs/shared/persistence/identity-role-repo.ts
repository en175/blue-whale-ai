import type { PrismaClient } from "@prisma/client";

import { isAdmin } from "@lib/core/identity/roles.js";

export interface IdentityRoleRepo {
  listRoleCodes(userId: string): Promise<string[]>;
  isAdmin(userId: string): Promise<boolean>;
  grant(userId: string, code: string, grantedBy: string): Promise<void>;
  revoke(userId: string, code: string): Promise<number>;
  countHolders(code: string): Promise<number>;
}

export class UnknownRoleError extends Error {
  constructor(readonly code: string) {
    super(`未知的角色：${code}`);
    this.name = "UnknownRoleError";
  }
}

export function createIdentityRoleRepo(prisma: PrismaClient): IdentityRoleRepo {
  async function roleIdOf(code: string): Promise<bigint | null> {
    const role = await prisma.bw_roles.findFirst({
      where: { code, is_delete: false },
      select: { id: true },
    });
    return role?.id ?? null;
  }

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
      return prisma.bw_user_roles.count({
        where: { role_id: roleId, is_delete: false },
      });
    },
  };
}
