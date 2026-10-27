import type { PrismaClient } from "@prisma/client";


export interface MaterialGroupView {
  id: string;
  userId: string;
  materialGroupId: string;
  kind: "virtual" | "real";
  name: string;
  coverUrl: string | null;
  isDefault: boolean;
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
  upsert(input: CreateMaterialGroupInput): Promise<MaterialGroupView>;
  findVirtualDefault(userId: string): Promise<MaterialGroupView | null>;
  listByUser(userId: string, kind?: "virtual" | "real"): Promise<MaterialGroupView[]>;
  pageByUser(
    userId: string,
    kind: "virtual" | "real",
    page: number,
    size: number,
  ): Promise<{ total: number; rows: MaterialGroupView[] }>;
  findByUserAndUpstream(userId: string, materialGroupId: string): Promise<MaterialGroupView | null>;
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
      const row = await prisma.catalog_material_groups.upsert({
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
      const row = await prisma.catalog_material_groups.findFirst({
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
      const rows = await prisma.catalog_material_groups.findMany({
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
        prisma.catalog_material_groups.count({ where }),
        prisma.catalog_material_groups.findMany({
          where,
          orderBy: [{ gmt_create: "desc" }, { id: "desc" }],
          skip: (page - 1) * size,
          take: size,
        }),
      ]);
      return { total, rows: rows.map(toView) };
    },
    async findByUserAndUpstream(userId, materialGroupId) {
      const row = await prisma.catalog_material_groups.findFirst({
        where: {
          user_id: BigInt(userId),
          material_group_id: materialGroupId,
          is_delete: false,
        },
      });
      return row ? toView(row) : null;
    },
    async softDelete(userId, materialGroupId) {
      await prisma.catalog_material_groups.updateMany({
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
