import { Prisma, type PrismaClient } from "@prisma/client";
import type {
  SharedAssetKind,
  SharedAssetSnapshot,
  SharedAssetType,
} from "@lib/contracts";

/** 共享资产内部行：snapshot 为类型数据的自包含快照（不依赖来源表）。
 *  asset_type 为第一层（节点大类），kind 为第二层（节点判别字段，goods/scene/text 为 null）。 */
export interface SharedAssetRow {
  id: bigint;
  user_id: bigint;
  asset_type: SharedAssetType;
  kind: SharedAssetKind | null;
  name: string;
  thumbnail_url: string | null;
  snapshot: SharedAssetSnapshot;
  dedup_key: string | null;
  status: string;
  gmt_create: Date;
  gmt_modified: Date;
  version: number;
  is_delete: number;
}

export interface SharedAssetCreateInput {
  userId: string;
  assetType: SharedAssetType;
  kind: SharedAssetKind | null;
  name: string;
  thumbnailUrl: string | null;
  snapshot: SharedAssetSnapshot;
  dedupKey: string | null;
}

export interface SharedAssetListFilter {
  /** 第一层类型过滤（缺省 = 全部）。 */
  assetType?: SharedAssetType;
  /** 第二层类型过滤（缺省 = 全部）。 */
  kind?: SharedAssetKind;
  page: number;
  size: number;
}

export interface SharedAssetPage {
  records: SharedAssetRow[];
  total: number;
  size: number;
  current: number;
}

export interface SharedAssetRepo {
  /** 新建共享资产；dedup_key 撞唯一键（uk_shared_user_dedup）由调用方捕获处理（并发兜底）。 */
  create(input: SharedAssetCreateInput): Promise<SharedAssetRow>;
  /** 幂等/近似去重查询（R2/R3）：按 (user_id, dedup_key) 取既有存活行。 */
  findByDedupKey(userId: string, dedupKey: string): Promise<SharedAssetRow | null>;
  /** 删除后重存兜底：按 dedup_key 取软删行并复活（is_delete 1→0，刷新快照/名称/缩略图）。
   *  不存在可复活行 → null。 */
  reviveByDedupKey(
    userId: string,
    dedupKey: string,
    update: {
      name: string;
      thumbnailUrl: string | null;
      snapshot: SharedAssetSnapshot;
    },
  ): Promise<SharedAssetRow | null>;
  /** 列表：asset_type/kind 双维过滤（缺省 = 全部）+ 分页。 */
  listByUser(userId: string, filter: SharedAssetListFilter): Promise<SharedAssetPage>;
  /** 详情（添加回画布取全量快照）；不存在/不归属 → null。 */
  findById(userId: string, id: string): Promise<SharedAssetRow | null>;
  /** 逻辑删除当前用户自己的共享资产；不存在/不归属 → false。 */
  softDeleteOwned(id: string, userId: string): Promise<boolean>;
}

const rowSelect = {
  id: true,
  user_id: true,
  asset_type: true,
  kind: true,
  name: true,
  thumbnail_url: true,
  snapshot: true,
  dedup_key: true,
  status: true,
  gmt_create: true,
  gmt_modified: true,
  version: true,
  is_delete: true,
} as const;

type SharedAssetDbRow = {
  id: bigint;
  user_id: bigint;
  asset_type: string;
  kind: string | null;
  name: string;
  thumbnail_url: string | null;
  snapshot: unknown;
  dedup_key: string | null;
  status: string;
  gmt_create: Date;
  gmt_modified: Date;
  version: number;
  is_delete: number;
};

function toRow(row: SharedAssetDbRow): SharedAssetRow {
  return {
    id: row.id,
    user_id: row.user_id,
    asset_type: row.asset_type as SharedAssetType,
    kind: row.kind as SharedAssetKind | null,
    name: row.name,
    thumbnail_url: row.thumbnail_url,
    snapshot: row.snapshot as SharedAssetSnapshot,
    dedup_key: row.dedup_key,
    status: row.status,
    gmt_create: row.gmt_create,
    gmt_modified: row.gmt_modified,
    version: row.version,
    is_delete: row.is_delete,
  };
}

export function createSharedAssetRepo(prisma: PrismaClient): SharedAssetRepo {
  return {
    async create(input) {
      const row = await prisma.shared_assets.create({
        data: {
          user_id: BigInt(input.userId),
          asset_type: input.assetType,
          kind: input.kind,
          name: input.name,
          thumbnail_url: input.thumbnailUrl,
          snapshot: input.snapshot as Prisma.InputJsonValue,
          dedup_key: input.dedupKey,
          status: "normal",
        },
        select: rowSelect,
      });
      return toRow(row);
    },

    async findByDedupKey(userId, dedupKey) {
      const row = await prisma.shared_assets.findFirst({
        where: {
          user_id: BigInt(userId),
          dedup_key: dedupKey,
          is_delete: 0,
        },
        select: rowSelect,
      });
      return row ? toRow(row) : null;
    },

    async reviveByDedupKey(userId, dedupKey, update) {
      const result = await prisma.shared_assets.updateMany({
        where: {
          user_id: BigInt(userId),
          dedup_key: dedupKey,
          is_delete: 1,
        },
        data: {
          is_delete: 0,
          status: "normal",
          name: update.name,
          thumbnail_url: update.thumbnailUrl,
          snapshot: update.snapshot as Prisma.InputJsonValue,
          version: { increment: 1 },
          gmt_modified: new Date(),
        },
      });
      if (result.count !== 1) return null;
      const row = await prisma.shared_assets.findFirst({
        where: { user_id: BigInt(userId), dedup_key: dedupKey },
        select: rowSelect,
      });
      return row ? toRow(row) : null;
    },

    async listByUser(userId, filter) {
      const where = {
        user_id: BigInt(userId),
        is_delete: 0,
        ...(filter.assetType ? { asset_type: filter.assetType } : {}),
        ...(filter.kind ? { kind: filter.kind } : {}),
      };
      const [total, rows] = await Promise.all([
        prisma.shared_assets.count({ where }),
        prisma.shared_assets.findMany({
          where,
          orderBy: { gmt_create: "desc" },
          skip: (filter.page - 1) * filter.size,
          take: filter.size,
          select: rowSelect,
        }),
      ]);
      return {
        records: rows.map(toRow),
        total,
        size: filter.size,
        current: filter.page,
      };
    },

    async findById(userId, id) {
      const row = await prisma.shared_assets.findFirst({
        where: {
          id: BigInt(id),
          user_id: BigInt(userId),
          is_delete: 0,
        },
        select: rowSelect,
      });
      return row ? toRow(row) : null;
    },

    async softDeleteOwned(id, userId) {
      const result = await prisma.shared_assets.updateMany({
        where: {
          id: BigInt(id),
          user_id: BigInt(userId),
          is_delete: 0,
        },
        data: {
          is_delete: 1,
          version: { increment: 1 },
          gmt_modified: new Date(),
        },
      });
      return result.count === 1;
    },
  };
}
