import type { PrismaClient } from "@prisma/client";

import { swapSequence, type MoveDirection } from "./template-admin-repo.js";

/**
 * 首页背景图/视频后台动态配置 repo（IKCH05，Prisma-backed）。
 *
 * 复用 homepage_hero 表：
 * - 删除一律软删（is_delete=1），查询端（公开列表 + admin 列表）都按 is_delete=0 过滤。
 * - enabled=1 才进首页轮播（listEnabled），按 (sort_order, id) 升序。
 * - 上限 8 条（enabled=1 的存活条数）应用层校验，不设 DB 唯一约束。
 * - create 的 sort_order 缺省取 max+1；调序与模板一致走 swapSequence 整体重排。
 * 业务字段校验（media_type/URL 格式/enabled 取值）属 validation 层，不在此处。
 */

/** 入参业务错误（如上限超限）：路由层映射 409。 */
export class HomepageHeroLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HomepageHeroLimitError";
  }
}

/** 首页轮播上限（母工单 IKCH01 产品规则）。 */
export const HOMEPAGE_HERO_MAX_ENABLED = 8;

export interface HomepageHeroAdminView {
  id: string;
  media_type: string;
  media_url: string;
  poster_url: string | null;
  sort_order: number;
  enabled: number;
  created_at: Date;
  updated_at: Date;
}

/** 公开列表只暴露这 5 个字段（不带 enabled）。 */
export interface HomepageHeroPublicView {
  id: string;
  media_type: string;
  media_url: string;
  poster_url: string | null;
  sort_order: number;
}

export interface CreateHomepageHeroInput {
  media_type: string;
  media_url: string;
  poster_url?: string | null;
  sort_order?: number;
  enabled?: number;
}

export type UpdateHomepageHeroInput = Partial<CreateHomepageHeroInput>;

export interface HomepageHeroRepo {
  /** admin 列表：全部存活条目（含禁用），按 sort_order 升序 */
  listAll(): Promise<HomepageHeroAdminView[]>;
  /** 公开列表：仅 enabled=1 存活条目，按 sort_order 升序 */
  listEnabled(): Promise<HomepageHeroPublicView[]>;
  getById(id: bigint): Promise<HomepageHeroAdminView | null>;
  create(input: CreateHomepageHeroInput): Promise<string>;
  update(id: bigint, input: UpdateHomepageHeroInput): Promise<boolean>;
  softDelete(id: bigint): Promise<boolean>;
  /** 调序：与上/下一位交换 sort_order（整体重排归一化） */
  move(id: bigint, direction: MoveDirection): Promise<MoveResult>;
  countEnabled(): Promise<number>;
}

export interface MoveResult {
  ok: boolean;
  /** 失败原因：not_found（目标不存在/已删）| boundary（已在边缘）| limit（启用数超上限） */
  reason?: "not_found" | "boundary" | "limit";
}

function toAdminView(row: {
  id: bigint;
  media_type: string;
  media_url: string;
  poster_url: string | null;
  sort_order: number;
  enabled: number;
  gmt_create: Date;
  gmt_modified: Date;
}): HomepageHeroAdminView {
  return {
    id: row.id.toString(),
    media_type: row.media_type,
    media_url: row.media_url,
    poster_url: row.poster_url,
    sort_order: row.sort_order,
    enabled: row.enabled,
    created_at: row.gmt_create,
    updated_at: row.gmt_modified,
  };
}

export function createHomepageHeroRepo(prisma: PrismaClient): HomepageHeroRepo {
  return {
    async listAll() {
      const rows = await prisma.homepage_hero.findMany({
        where: { is_delete: 0 },
        orderBy: [{ sort_order: "asc" }, { id: "asc" }],
      });
      return rows.map(toAdminView);
    },

    async listEnabled() {
      const rows = await prisma.homepage_hero.findMany({
        where: { is_delete: 0, enabled: 1 },
        orderBy: [{ sort_order: "asc" }, { id: "asc" }],
        select: {
          id: true,
          media_type: true,
          media_url: true,
          poster_url: true,
          sort_order: true,
        },
      });
      return rows.map((row) => ({
        id: row.id.toString(),
        media_type: row.media_type,
        media_url: row.media_url,
        poster_url: row.poster_url,
        sort_order: row.sort_order,
      }));
    },

    async getById(id) {
      const row = await prisma.homepage_hero.findFirst({
        where: { id, is_delete: 0 },
      });
      return row ? toAdminView(row) : null;
    },

    async create(input) {
      return prisma.$transaction(async (tx) => {
        // 上限校验：新增默认 enabled=1（未显式传 0），启用数 + 1 不得超过上限
        const enabling = input.enabled ?? 1;
        if (enabling === 1) {
          const enabledCount = await tx.homepage_hero.count({
            where: { is_delete: 0, enabled: 1 },
          });
          if (enabledCount + 1 > HOMEPAGE_HERO_MAX_ENABLED) {
            throw new HomepageHeroLimitError(
              `启用条目已达上限 ${HOMEPAGE_HERO_MAX_ENABLED} 条`,
            );
          }
        }
        // sort_order 缺省取 max+1（存活条目中）
        let sortOrder = input.sort_order;
        if (sortOrder === undefined) {
          const agg = await tx.homepage_hero.aggregate({
            where: { is_delete: 0 },
            _max: { sort_order: true },
          });
          sortOrder = (agg._max.sort_order ?? -1) + 1;
        }
        const now = new Date();
        const row = await tx.homepage_hero.create({
          data: {
            media_type: input.media_type,
            media_url: input.media_url,
            poster_url: input.poster_url ?? null,
            sort_order: sortOrder,
            enabled: enabling,
            gmt_modified: now,
          },
        });
        return row.id.toString();
      });
    },

    async update(id, input) {
      return prisma.$transaction(async (tx) => {
        const existing = await tx.homepage_hero.findFirst({
          where: { id, is_delete: 0 },
        });
        if (!existing) return false;

        // 从禁用改为启用时校验上限（已是启用态不算新增）
        const targetEnabled = input.enabled ?? existing.enabled;
        if (existing.enabled === 0 && targetEnabled === 1) {
          const enabledCount = await tx.homepage_hero.count({
            where: { is_delete: 0, enabled: 1 },
          });
          if (enabledCount + 1 > HOMEPAGE_HERO_MAX_ENABLED) {
            throw new HomepageHeroLimitError(
              `启用条目已达上限 ${HOMEPAGE_HERO_MAX_ENABLED} 条`,
            );
          }
        }

        await tx.homepage_hero.update({
          where: { id },
          data: {
            media_type: input.media_type ?? existing.media_type,
            media_url: input.media_url ?? existing.media_url,
            poster_url:
              input.poster_url !== undefined ? input.poster_url : existing.poster_url,
            sort_order: input.sort_order ?? existing.sort_order,
            enabled: targetEnabled,
            gmt_modified: new Date(),
          },
        });
        return true;
      });
    },

    async softDelete(id) {
      const result = await prisma.homepage_hero.updateMany({
        where: { id, is_delete: 0 },
        data: { is_delete: 1, gmt_modified: new Date() },
      });
      return result.count > 0;
    },

    async move(id, direction) {
      return prisma.$transaction(async (tx) => {
        const target = await tx.homepage_hero.findFirst({
          where: { id, is_delete: 0 },
        });
        if (!target) return { ok: false, reason: "not_found" as const };

        const siblings = await tx.homepage_hero.findMany({
          where: { is_delete: 0 },
          orderBy: [{ sort_order: "asc" }, { id: "asc" }],
        });
        const idx = siblings.findIndex((r) => r.id === id);
        const swapped = swapSequence(siblings, idx, direction);
        if (!swapped) return { ok: false, reason: "boundary" as const };
        // 整体重排为连续值，归一化历史重复 sort_order
        await Promise.all(
          swapped.map((row, i) =>
            row.sort_order === i
              ? Promise.resolve()
              : tx.homepage_hero.update({
                  where: { id: row.id },
                  data: { sort_order: i, gmt_modified: new Date() },
                }),
          ),
        );
        return { ok: true };
      });
    },

    async countEnabled() {
      return prisma.homepage_hero.count({
        where: { is_delete: 0, enabled: 1 },
      });
    },
  };
}
