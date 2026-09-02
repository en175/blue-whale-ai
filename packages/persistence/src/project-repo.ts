import type { PrismaClient } from "@prisma/client";

/** Project CRUD 的 db port（Prisma-backed）。
 * 普通项目接口只暴露 purpose=canvas；GenerationInbox 由专用 repo 管理。 */

export interface ProjectView {
  id: string;
  name: string;
  thumb: string | null;
  /** 项目内最近创建的 3 张 image 类型图片 URL（按 gmt_create 倒序取前 3），不足 3 张为实际张数，无图为空数组。 */
  previews: string[];
  created_at: string;
}

export interface ProjectRepo {
  listByOwner(ownerId: string): Promise<ProjectView[]>;
  create(ownerId: string, name: string): Promise<ProjectView>;
  findOwnedById(id: string, ownerId: string): Promise<ProjectView | null>;
  /**
   * 按项目号解出主人（New API 用户号），不要求调用方先知道主人是谁。
   * 计费归属专用：模型网关拿 Agent 声明的项目号来这里换计费主体，Agent 因此无法自报记谁的账。
   * 逻辑删除的项目返回 null——已删项目不该再产生花费。
   */
  findOwnerId(id: string): Promise<string | null>;
  rename(
    id: string,
    ownerId: string,
    name: string,
  ): Promise<ProjectView | null>;
  delete(id: string, ownerId: string): Promise<boolean>;
  batchDelete(
    ownerId: string,
    ids: string[],
  ): Promise<{ succeeded: string[]; failed: string[] }>;
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
    previews: [],
    created_at: row.gmt_create.toISOString(),
  };
}

/** 空名创建时使用当前日期时间作为默认项目名（PRD E5）。 */
function defaultProjectName(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

export function createProjectRepo(prisma: PrismaClient): ProjectRepo {
  /** 名称撞名时自动追加序号（PRD E4/E6，如「名称 (2)」）。excludeId 用于重命名时排除自身。 */
  async function uniqueName(
    ownerId: bigint,
    desired: string,
    excludeId?: bigint,
  ): Promise<string> {
    const existing = await prisma.project.findMany({
      where: {
        owner_id: ownerId,
        purpose: "canvas",
        is_delete: 0,
        name: { startsWith: desired },
      },
      select: { id: true, name: true },
    });
    const taken = new Set(
      existing
        .filter((row) => excludeId === undefined || row.id !== excludeId)
        .map((row) => row.name),
    );
    if (!taken.has(desired)) return desired;
    let n = 2;
    while (taken.has(`${desired} (${n})`)) n += 1;
    return `${desired} (${n})`;
  }

  /** 批量取每个项目最近 3 张 image 图片 URL（按 gmt_create 倒序取前 3），不足 3 张取实际张数。 */
  async function attachPreviews(
    rows: { id: bigint }[],
    views: ProjectView[],
  ): Promise<void> {
    if (rows.length === 0) return;
    const projectIds = rows.map((row) => row.id);
    const imageAssets = await prisma.assets.findMany({
      where: {
        project_id: { in: projectIds },
        type: "image",
        is_delete: false,
      },
      orderBy: { gmt_create: "desc" },
      select: { project_id: true, url: true },
    });
    const byProject = new Map<bigint, string[]>();
    for (const asset of imageAssets) {
      const list = byProject.get(asset.project_id);
      if (!list) {
        byProject.set(asset.project_id, [asset.url]);
      } else if (list.length < 3) {
        list.push(asset.url);
      }
    }
    for (const view of views) {
      view.previews = byProject.get(BigInt(view.id)) ?? [];
    }
  }

  return {
    async listByOwner(ownerId) {
      const rows = await prisma.project.findMany({
        where: {
          owner_id: BigInt(ownerId),
          purpose: "canvas",
          is_delete: 0,
        },
        orderBy: { gmt_create: "desc" },
      });
      const views = rows.map(toView);
      await attachPreviews(rows, views);
      return views;
    },
    async create(ownerId, name) {
      const trimmed = name.trim();
      const finalName = await uniqueName(
        BigInt(ownerId),
        trimmed === "" ? defaultProjectName() : trimmed,
      );
      const row = await prisma.project.create({
        data: { owner_id: BigInt(ownerId), name: finalName },
      });
      return toView(row);
    },
    async findOwnedById(id, ownerId) {
      const row = await prisma.project.findFirst({
        where: { id: BigInt(id), owner_id: BigInt(ownerId), is_delete: 0 },
      });
      return row ? toView(row) : null;
    },
    async findOwnerId(id) {
      let key: bigint;
      try {
        key = BigInt(id);
      } catch {
        // 非数字项目号：调用方是网关而非受控前端，坏输入按查不到处理，不要抛到 500。
        return null;
      }
      const row = await prisma.project.findFirst({
        where: { id: key, is_delete: 0 },
        select: { owner_id: true },
      });
      return row ? row.owner_id.toString() : null;
    },
    async rename(id, ownerId, name) {
      const finalName = await uniqueName(
        BigInt(ownerId),
        name.trim(),
        BigInt(id),
      );
      const updated = await prisma.project.updateMany({
        where: {
          id: BigInt(id),
          owner_id: BigInt(ownerId),
          purpose: "canvas",
          is_delete: 0,
        },
        data: { name: finalName },
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
      // 逻辑删除（对齐 Java is_delete）。先验归属；级联逻辑删该项目关联资产（PRD O3/E8，不可逆）。
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
      await prisma.$transaction([
        prisma.assets.updateMany({
          where: { project_id: BigInt(id), is_delete: false },
          // 级联软删同样盖 deleted_at，否则延迟 GC 永远扫不到这批资产（IKBMDM F1）。
          data: { is_delete: true, deleted_at: new Date() },
        }),
        prisma.project.update({
          where: { id: BigInt(id) },
          data: { is_delete: 1 },
        }),
      ]);
      return true;
    },
    async batchDelete(ownerId, ids) {
      // 一次删除多个项目，各自级联删资产（不可逆）；非本人/不存在的 ID 记为失败项（PRD E14，已删除不回滚）。
      const idNums = ids.map((id) => BigInt(id));
      const owned = await prisma.project.findMany({
        where: {
          id: { in: idNums },
          owner_id: BigInt(ownerId),
          purpose: "canvas",
          is_delete: 0,
        },
        select: { id: true },
      });
      const ownedSet = new Set(owned.map((row) => row.id));
      const toDelete = [...ownedSet];
      if (toDelete.length > 0) {
        await prisma.$transaction([
          prisma.assets.updateMany({
            where: { project_id: { in: toDelete }, is_delete: false },
            // 级联软删同样盖 deleted_at，否则延迟 GC 永远扫不到这批资产（IKBMDM F1）。
            data: { is_delete: true, deleted_at: new Date() },
          }),
          prisma.project.updateMany({
            where: { id: { in: toDelete } },
            data: { is_delete: 1 },
          }),
        ]);
      }
      const succeeded = ids.filter((id) => ownedSet.has(BigInt(id)));
      const failed = ids.filter((id) => !ownedSet.has(BigInt(id)));
      return { succeeded, failed };
    },
  };
}
