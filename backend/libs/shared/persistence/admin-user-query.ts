import type { PrismaClient } from "@prisma/client";

import { createLogger } from "@lib/core/logging";
import { fetchAdminUserStats } from "@lib/shared/billing/billing-admin-client.js";
import { roleRank } from "@lib/core/identity/roles.js";

const log = createLogger("admin-user-query");

export interface AdminUserRow {
  userId: number;
  nickname: string;
  phone: string;
  balance: number;
  totalRecharge: number;
  totalSpend: number;
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

export interface AdminUserIdentity {
  nickname: string;
  phone: string;
}

export interface AdminUserQuery {
  listAdminUsers(options: AdminUserListOptions): Promise<{ items: AdminUserRow[]; total: number }>;
  findUserIdByKeyword(keyword: string): Promise<number | undefined>;
  loadUserIdentities(userIds: readonly number[]): Promise<Map<number, AdminUserIdentity>>;
  countAdminUsers(): Promise<number>;
}

const BASE_WHERE = { is_delete: false } as const;

const MAX_USER_ID_DIGITS = 18;

function isUserIdKeyword(keyword: string): boolean {
  return keyword.length <= MAX_USER_ID_DIGITS && /^\d+$/.test(keyword);
}

export function createAdminUserQuery(prisma: PrismaClient): AdminUserQuery {
  return {
    async countAdminUsers() {
      return prisma.bw_users.count({ where: BASE_WHERE });
    },

    async listAdminUsers({ keyword, status, page = 1, pageSize = 100 }) {
      const where = {
        ...BASE_WHERE,
        ...(status === undefined ? {} : { status: status === 1 ? "NORMAL" : "DISABLED" }),
        ...(keyword
          ? {
              OR: [
                { username: { contains: keyword } },
                { phone: { contains: keyword } },
                ...(isUserIdKeyword(keyword) ? [{ id: BigInt(keyword) }] : []),
              ],
            }
          : {}),
      };

      const [total, rows] = await Promise.all([
        prisma.bw_users.count({ where }),
        prisma.bw_users.findMany({
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

      const ids = rows.map((r) => r.id);
      const grants = ids.length
        ? await prisma.bw_user_roles.findMany({
            where: { user_id: { in: ids }, is_delete: false },
            select: { user_id: true, role_id: true },
          })
        : [];
      const roleIdToCode = new Map(
        (await prisma.bw_roles.findMany({
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

      const stats = await fetchAdminUserStats(rows.map((r) => Number(r.id)));

      const items: AdminUserRow[] = rows.map((r) => {
        const userId = Number(r.id);
        const stat = stats.get(userId);
        if (!stat) {
          log.warn(`计费未返回用户 ${userId} 的三列（契约：请求里的每个 id 都应有回项），按 0 渲染`);
        }
        return {
          userId,
          nickname: r.username,
          phone: r.phone ?? "",
          balance: stat?.availableCredits ?? 0,
          totalRecharge: stat?.totalRecharged ?? 0,
          totalSpend: stat?.totalConsumed ?? 0,
          role: roleRank(codesByUser.get(r.id.toString()) ?? []),
          status: r.status === "NORMAL" ? "active" : "disabled",
          createdAt: r.gmt_create.toISOString(),
          updatedAt: r.gmt_modified.toISOString(),
        };
      });

      return { items, total };
    },

    async findUserIdByKeyword(rawKeyword) {
      const keyword = rawKeyword.trim();
      if (!keyword) return undefined;

      const asId = isUserIdKeyword(keyword);

      const rows = await prisma.bw_users.findMany({
        where: {
          OR: [
            ...(asId ? [{ id: BigInt(keyword) }] : []),
            { phone: keyword },
            { username: keyword },
          ],
        },
        take: 3,
        select: { id: true, username: true, phone: true },
      });

      const lower = keyword.toLowerCase();
      const named = rows.filter(
        (r) => r.phone === keyword || r.username.toLowerCase() === lower,
      );

      if (named.length > 1) return undefined;

      const byId = asId ? rows.find((r) => r.id === BigInt(keyword)) : undefined;

      const row = named[0] ?? byId;
      return row ? Number(row.id) : undefined;
    },

    async loadUserIdentities(userIds) {
      const ids = [...new Set(userIds)];
      if (ids.length === 0) return new Map();

      const rows = await prisma.bw_users.findMany({
        where: { id: { in: ids.map((id) => BigInt(id)) } },
        select: { id: true, username: true, phone: true },
      });
      return new Map(
        rows.map((r) => [Number(r.id), { nickname: r.username, phone: r.phone ?? "" }]),
      );
    },
  };
}
