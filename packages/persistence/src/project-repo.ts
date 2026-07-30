import type { PrismaClient } from "@prisma/client";

/** Project CRUD 的 db port（Prisma-backed）。
 * 普通项目接口只暴露 purpose=canvas；GenerationInbox 由专用 repo 管理。 */

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
  rename(
    id: string,
    ownerId: string,
    name: string,
  ): Promise<ProjectView | null>;
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
        where: {
          owner_id: BigInt(ownerId),
          purpose: "canvas",
          is_delete: 0,
        },
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
      const updated = await prisma.project.updateMany({
        where: {
          id: BigInt(id),
          owner_id: BigInt(ownerId),
          purpose: "canvas",
          is_delete: 0,
        },
        data: { name },
      });
      if (updated.count !== 1) return null;
      const row = await prisma.project.findFirst({
        where: {
          id: BigInt(id),
          owner_id: BigInt(ownerId),
          purpose: "canvas",
          is_delete: 0,
        },
      });
      return row ? toView(row) : null;
    },
    async delete(id, ownerId) {
      // 逻辑删除（对齐 Java is_delete）。先验归属。
      const owned = await prisma.project.findFirst({
        where: {
          id: BigInt(id),
          owner_id: BigInt(ownerId),
          purpose: "canvas",
          is_delete: 0,
        },
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
