import type { PrismaClient } from "@prisma/client";

/** Project CRUD 的 db port（Prisma-backed），复用部署的 project 表
 *  （id/owner_id/name/thumb/gmt_create/gmt_modified/version/is_delete）。
 *  对齐 Java ProjectDto：{id,name,thumb,created_at}（purpose 列部署表没有，先不带）。 */

export interface ProjectView {
  id: string;
  name: string;
  thumb: string | null;
  created_at: string;
}

export interface ProjectRepo {
  listByOwner(ownerId: string): Promise<ProjectView[]>;
  create(ownerId: string, name: string): Promise<ProjectView>;
  findOwnedById(id: string, ownerId: string): Promise<ProjectView | null>;
  rename(id: string, ownerId: string, name: string): Promise<ProjectView | null>;
  delete(id: string, ownerId: string): Promise<boolean>;
}

function toView(row: {
  id: bigint;
  name: string;
  thumb: string | null;
  gmt_create: Date;
}): ProjectView {
  return {
    id: row.id.toString(),
    name: row.name,
    thumb: row.thumb,
    created_at: row.gmt_create.toISOString(),
  };
}

export function createProjectRepo(prisma: PrismaClient): ProjectRepo {
  return {
    async listByOwner(ownerId) {
      const rows = await prisma.project.findMany({
        where: { owner_id: BigInt(ownerId), is_delete: 0 },
        orderBy: { gmt_modified: "desc" },
      });
      return rows.map(toView);
    },
    async create(ownerId, name) {
      const row = await prisma.project.create({
        data: { owner_id: BigInt(ownerId), name },
      });
      return toView(row);
    },
    async findOwnedById(id, ownerId) {
      const row = await prisma.project.findFirst({
        where: { id: BigInt(id), owner_id: BigInt(ownerId), is_delete: 0 },
      });
      return row ? toView(row) : null;
    },
    async rename(id, ownerId, name) {
      const row = await prisma.project.update({
        where: { id: BigInt(id) },
        data: { name },
      }).catch(() => null);
      if (!row || row.owner_id !== BigInt(ownerId) || row.is_delete !== 0) return null;
      return toView(row);
    },
    async delete(id, ownerId) {
      // 逻辑删除（对齐 Java is_delete）。先验归属。
      const owned = await prisma.project.findFirst({
        where: { id: BigInt(id), owner_id: BigInt(ownerId), is_delete: 0 },
        select: { id: true },
      });
      if (!owned) return false;
      await prisma.project.update({
        where: { id: BigInt(id) },
        data: { is_delete: 1 },
      });
      return true;
    },
  };
}
