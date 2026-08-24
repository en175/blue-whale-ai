import type { PrismaClient } from "@prisma/client";

/** 技能管理 admin repo（IKA64P 后续校准）：官方技能分类维护。
 *  category 列为自由文本（VarChar(32)），'' 表示未分类；不建新表、不迁移。 */

export interface AdminSkillView {
  id: string;
  name: string;
  cover_url: string | null;
  category: string;
  sort_order: number;
}

export interface AdminSkillCategoryView {
  name: string;
  count: number;
}

export interface SkillAdminRepo {
  listOfficialSkills(): Promise<AdminSkillView[]>;
  listCategories(): Promise<AdminSkillCategoryView[]>;
  setCategory(id: bigint, category: string): Promise<boolean>;
  renameCategory(from: string, to: string): Promise<number>;
  clearCategory(name: string): Promise<number>;
}

export function createSkillAdminRepo(prisma: PrismaClient): SkillAdminRepo {
  return {
    async listOfficialSkills() {
      const rows = await prisma.skill.findMany({
        where: { source: "official", is_delete: 0 },
        orderBy: [{ sort_order: "asc" }, { id: "asc" }],
        select: {
          id: true,
          name: true,
          cover_url: true,
          category: true,
          sort_order: true,
        },
      });
      return rows.map((r) => ({
        id: r.id.toString(),
        name: r.name,
        cover_url: r.cover_url,
        category: r.category,
        sort_order: r.sort_order,
      }));
    },

    async listCategories() {
      const rows = await prisma.skill.groupBy({
        by: ["category"],
        where: { source: "official", is_delete: 0, category: { not: "" } },
        _count: { _all: true },
        orderBy: { category: "asc" },
      });
      return rows.map((r) => ({ name: r.category, count: r._count._all }));
    },

    async setCategory(id, category) {
      const result = await prisma.skill.updateMany({
        where: { id, source: "official", is_delete: 0 },
        data: { category },
      });
      return result.count > 0;
    },

    async renameCategory(from, to) {
      const result = await prisma.skill.updateMany({
        where: { source: "official", is_delete: 0, category: from },
        data: { category: to },
      });
      return result.count;
    },

    async clearCategory(name) {
      const result = await prisma.skill.updateMany({
        where: { source: "official", is_delete: 0, category: name },
        data: { category: "" },
      });
      return result.count;
    },
  };
}
