import type { PrismaClient } from "@prisma/client";

// IKDE6X：素材库组 repo（Prisma-backed）。写权威=上游，本地表维护虚拟组镜像（IKEXX8 契约 v2）。
// 虚拟人像库组（每用户至多 1 个默认组）读走本地；真人组不落表、查询仍透传上游。
// is_default 每用户 virtual 至多 1 个由应用层保证。

export interface MaterialGroupView {
  id: string;
  userId: string;
  materialGroupId: string;
  kind: "virtual" | "real";
  name: string;
  coverUrl: string | null;
  isDefault: boolean;
  /** IKEXX8：组查询分流信封需要 CreateTime/UpdateTime（上游同款，秒精度）。 */
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface CreateMaterialGroupInput {
  userId: string;
  materialGroupId: string;
  kind: "virtual" | "real";
  name: string;
  coverUrl?: string | null;
  isDefault?: boolean;
}

export interface MaterialGroupRepo {
  /** 创建组镜像（上游成功后调用）。同 (user_id, material_group_id) 已存在则覆盖（幂等）。 */
  upsert(input: CreateMaterialGroupInput): Promise<MaterialGroupView>;
  /** 查某用户未删的虚拟默认组（kind=virtual, is_default=true）。无则 null。 */
  findVirtualDefault(userId: string): Promise<MaterialGroupView | null>;
  /** 查某用户未删组列表（按 kind 过滤可选）。 */
  listByUser(userId: string, kind?: "virtual" | "real"): Promise<MaterialGroupView[]>;
  /** IKEXX8：分页查某用户未删组（gmt_create desc, id desc），供 ListAssetGroups 本地分流。 */
  pageByUser(
    userId: string,
    kind: "virtual" | "real",
    page: number,
    size: number,
  ): Promise<{ total: number; rows: MaterialGroupView[] }>;
  /** 查某用户指定上游组 id 的镜像。无则 null。 */
  findByUserAndUpstream(userId: string, materialGroupId: string): Promise<MaterialGroupView | null>;
  /** 软删组（上游删除成功后调用，组删除双向维护）。 */
  softDelete(userId: string, materialGroupId: string): Promise<void>;
}

function toView(row: {
  id: bigint;
  user_id: bigint;
  material_group_id: string;
  kind: string;
  name: string;
  cover_url: string | null;
  is_default: boolean;
  gmt_create?: Date | null;
  gmt_modified?: Date | null;
}): MaterialGroupView {
  return {
    id: row.id.toString(),
    userId: row.user_id.toString(),
    materialGroupId: row.material_group_id,
    kind: row.kind === "real" ? "real" : "virtual",
    name: row.name,
    coverUrl: row.cover_url,
    isDefault: row.is_default,
    createdAt: row.gmt_create ?? null,
    updatedAt: row.gmt_modified ?? null,
  };
}

export function createMaterialGroupRepo(prisma: PrismaClient): MaterialGroupRepo {
  return {
    async upsert({ userId, materialGroupId, kind, name, coverUrl, isDefault }) {
      const row = await prisma.material_groups.upsert({
        where: {
          user_id_material_group_id: {
            user_id: BigInt(userId),
            material_group_id: materialGroupId,
          },
        },
        update: {
          kind,
          name,
          ...(coverUrl !== undefined ? { cover_url: coverUrl } : {}),
          ...(isDefault !== undefined ? { is_default: isDefault } : {}),
          version: { increment: 1 },
          gmt_modified: new Date(),
        },
        create: {
          user_id: BigInt(userId),
          material_group_id: materialGroupId,
          kind,
          name,
          cover_url: coverUrl ?? null,
          is_default: isDefault ?? false,
        },
      });
      return toView(row);
    },
    async findVirtualDefault(userId) {
      const row = await prisma.material_groups.findFirst({
        where: {
          user_id: BigInt(userId),
          kind: "virtual",
          is_default: true,
          is_delete: false,
        },
        orderBy: { id: "asc" },
      });
      return row ? toView(row) : null;
    },
    async listByUser(userId, kind) {
      const rows = await prisma.material_groups.findMany({
        where: {
          user_id: BigInt(userId),
          is_delete: false,
          ...(kind ? { kind } : {}),
        },
        orderBy: { id: "asc" },
      });
      return rows.map(toView);
    },
    async pageByUser(userId, kind, page, size) {
      const where = { user_id: BigInt(userId), kind, is_delete: false };
      const [total, rows] = await Promise.all([
        prisma.material_groups.count({ where }),
        prisma.material_groups.findMany({
          where,
          orderBy: [{ gmt_create: "desc" }, { id: "desc" }],
          skip: (page - 1) * size,
          take: size,
        }),
      ]);
      return { total, rows: rows.map(toView) };
    },
    async findByUserAndUpstream(userId, materialGroupId) {
      const row = await prisma.material_groups.findFirst({
        where: {
          user_id: BigInt(userId),
          material_group_id: materialGroupId,
          is_delete: false,
        },
      });
      return row ? toView(row) : null;
    },
    async softDelete(userId, materialGroupId) {
      await prisma.material_groups.updateMany({
        where: {
          user_id: BigInt(userId),
          material_group_id: materialGroupId,
          is_delete: false,
        },
        data: {
          is_delete: true,
          deleted_at: new Date(),
          version: { increment: 1 },
          gmt_modified: new Date(),
        },
      });
    },
  };
}
