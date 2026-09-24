import type { PrismaClient } from "@prisma/client";

import { roleRank } from "@lib/core/identity/roles.js";

/**
 * 管理端用户列表 —— **读我们自己的库**，不再转发给 new-api。
 *
 * <h2>为什么必须切</h2>
 *
 * 原实现把这条请求转发给 new-api 的 admin API。new-api 独立之后那边不再有用户概念，
 * 这条链路会直接断；而且它要求「调用者在 new-api 那边也是管理员」——于是出现
 * 一个荒唐的状态：`lxq1234` 在我们这有 `super_admin`，却因为 new-api 说它不是管理员
 * 而看不到用户列表。**管理端不该有两个管理员概念。**
 *
 * <h2>余额三列暂时是 0</h2>
 *
 * `balance` / `totalRecharge` / `totalSpend` 属于计费域，而计费侧还没按用户维度接过来。
 * 这里返回 0 而不是从 new-api 借——借过来的数会随 new-api 独立一起消失，
 * 而且会让「已经切干净了」这个判断变得不成立。等计费接上再回填。
 */
export interface AdminUserRow {
  userId: number;
  nickname: string;
  phone: string;
  balance: number;
  totalRecharge: number;
  totalSpend: number;
  /** 1 普通用户 / 10 管理员 / 100 超级管理员 —— 由我们自己的角色 code 映射而来 */
  role: number;
  status: "active" | "disabled";
  createdAt: string;
  updatedAt: string;
}

export interface AdminUserListOptions {
  keyword?: string;
  status?: number;
  page?: number;
  pageSize?: number;
}

export interface AdminUserQuery {
  listAdminUsers(options: AdminUserListOptions): Promise<{ items: AdminUserRow[]; total: number }>;
}

export function createAdminUserQuery(prisma: PrismaClient): AdminUserQuery {
  return {
    async listAdminUsers({ keyword, status, page = 1, pageSize = 100 }) {
      const where = {
        is_delete: false,
        // status: 1 = 启用（我们库里存 'NORMAL'）；0 = 禁用
        // 本仓开了 exactOptionalPropertyTypes：不能给 ?: 属性传 undefined，只能条件展开
        ...(status === undefined ? {} : { status: status === 1 ? "NORMAL" : "DISABLED" }),
        ...(keyword
          ? {
              OR: [
                { username: { contains: keyword } },
                { phone: { contains: keyword } },
              ],
            }
          : {}),
      };

      const [total, rows] = await Promise.all([
        prisma.identity_users.count({ where }),
        prisma.identity_users.findMany({
          where,
          orderBy: { id: "asc" },
          skip: (page - 1) * pageSize,
          take: pageSize,
          select: {
            id: true,
            username: true,
            phone: true,
            status: true,
            gmt_create: true,
            gmt_modified: true,
          },
        }),
      ]);

      // 角色一次查完（按用户批量取），避免每行一次查询
      const ids = rows.map((r) => r.id);
      const grants = ids.length
        ? await prisma.identity_user_roles.findMany({
            where: { user_id: { in: ids }, is_delete: false },
            select: { user_id: true, role_id: true },
          })
        : [];
      const roleIdToCode = new Map(
        (await prisma.identity_roles.findMany({
          where: { is_delete: false },
          select: { id: true, code: true },
        })).map((r) => [r.id.toString(), r.code]),
      );
      const codesByUser = new Map<string, string[]>();
      for (const g of grants) {
        const key = g.user_id.toString();
        const code = roleIdToCode.get(g.role_id.toString());
        if (!code) continue;
        codesByUser.set(key, [...(codesByUser.get(key) ?? []), code]);
      }

      const items: AdminUserRow[] = rows.map((r) => ({
        userId: Number(r.id),
        nickname: r.username,
        phone: r.phone ?? "",
        // 计费域尚未按用户维度接过来，先给 0；不是从 new-api 借的数
        balance: 0,
        totalRecharge: 0,
        totalSpend: 0,
        role: roleRank(codesByUser.get(r.id.toString()) ?? []),
        status: r.status === "NORMAL" ? "active" : "disabled",
        createdAt: r.gmt_create.toISOString(),
        updatedAt: r.gmt_modified.toISOString(),
      }));

      return { items, total };
    },
  };
}
