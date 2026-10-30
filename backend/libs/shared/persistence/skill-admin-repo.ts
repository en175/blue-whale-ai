import type { Prisma, PrismaClient } from "@prisma/client";
import {
  generateCreativeSkillId,
  normalizeNameKey,
} from "./skill-repo-internals.js";


export interface AdminSkillView {
  id: string;
  creative_skill_id: string | null;
  name: string;
  skill_code: string | null;
  cover_url: string | null;
  category: string;
  sort_order: number;
  is_delete: number;
  has_content: boolean;
}

export interface AdminSkillDetailView extends AdminSkillView {
  description: string | null;
  content: string | null;
}

export interface AdminSkillUpdateInput {
  name?: string;
  description?: string | null;
  content?: string | null;
  category?: string;
  sort_order?: number;
  cover_url?: string | null;
}

export type AdminSkillUpdateResult = "ok" | "not_found" | "conflict";

export interface AdminSkillCategoryView {
  name: string;
  count: number;
}

export interface SkillAdminRepo {
  listOfficialSkills(): Promise<AdminSkillView[]>;
  getOfficialSkill(id: bigint): Promise<AdminSkillDetailView | null>;
  updateOfficialSkill(
    id: bigint,
    input: AdminSkillUpdateInput,
  ): Promise<AdminSkillUpdateResult>;
  setActive(id: bigint, isDelete: number): Promise<boolean>;
  listCategories(): Promise<AdminSkillCategoryView[]>;
  setCategory(id: bigint, category: string): Promise<boolean>;
  assignCategory(ids: bigint[], category: string): Promise<number>;
  backfillOfficialAssets(): Promise<number>;
  renameCategory(from: string, to: string): Promise<number>;
  clearCategory(name: string): Promise<number>;
}

const OWNER = { owner_user_id: BigInt(0) };
const ACTIVE_OFFICIAL = { ...OWNER, is_delete: 0 };

export function createSkillAdminRepo(prisma: PrismaClient): SkillAdminRepo {
  return {
    async listOfficialSkills() {
      const rows = await prisma.$queryRawUnsafe<
        {
          id: bigint;
          creative_skill_id: string | null;
          name: string;
          skill_code: string | null;
          cover_url: string | null;
          category: string;
          sort_order: number;
          is_delete: number;
          has_content: number;
        }[]
      >(
        `SELECT id, creative_skill_id, name, skill_code, cover_url, category, sort_order, is_delete,
                (content IS NOT NULL AND content <> '') AS has_content
           FROM catalog_skills
          WHERE owner_user_id = 0
          ORDER BY sort_order ASC, id ASC`,
      );
      return rows.map((r) => ({
        id: r.id.toString(),
        creative_skill_id: r.creative_skill_id,
        name: r.name,
        skill_code: r.skill_code,
        cover_url: r.cover_url,
        category: r.category,
        sort_order: r.sort_order,
        is_delete: r.is_delete,
        has_content: Number(r.has_content) === 1,
      }));
    },

    async getOfficialSkill(id) {
      const row = await prisma.catalog_skills.findFirst({
        where: { id, ...OWNER },
        select: {
          id: true,
          creative_skill_id: true,
          name: true,
          skill_code: true,
          description: true,
          content: true,
          category: true,
          sort_order: true,
          cover_url: true,
          is_delete: true,
        },
      });
      return row
        ? {
            id: row.id.toString(),
            creative_skill_id: row.creative_skill_id,
            name: row.name,
            skill_code: row.skill_code,
            description: row.description,
            content: row.content,
            category: row.category,
            sort_order: row.sort_order,
            cover_url: row.cover_url,
            is_delete: row.is_delete,
            has_content: !!row.content,
          }
        : null;
    },

    async updateOfficialSkill(id, input) {
      const data: Prisma.catalog_skillsUpdateManyMutationInput = {};
      if (input.name !== undefined) {
        const nameKey = normalizeNameKey(input.name);
        const conflict = await prisma.catalog_skills.findFirst({
          where: { ...OWNER, name_key: nameKey, id: { not: id } },
          select: { id: true },
        });
        if (conflict) return "conflict";
        const current = await prisma.catalog_skills.findFirst({
          where: { id, ...OWNER },
          select: { name: true, name_zh: true },
        });
        data.name = input.name;
        data.name_key = nameKey;
        if (current?.name_zh && current.name_zh === current.name) {
          data.name_zh = input.name;
        }
      }
      if (input.description !== undefined) data.description = input.description;
      if (input.content !== undefined) data.content = input.content;
      if (input.category !== undefined) data.category = input.category;
      if (input.sort_order !== undefined) data.sort_order = input.sort_order;
      if (input.cover_url !== undefined) data.cover_url = input.cover_url;
      if (Object.keys(data).length === 0) return "ok";
      data.gmt_modified = new Date();
      const result = await prisma.catalog_skills.updateMany({
        where: { id, ...OWNER },
        data,
      });
      return result.count > 0 ? "ok" : "not_found";
    },

    async setActive(id, isDelete) {
      const result = await prisma.catalog_skills.updateMany({
        where: { id, ...OWNER },
        data: { is_delete: isDelete, gmt_modified: new Date() },
      });
      return result.count > 0;
    },

    async listCategories() {
      const rows = await prisma.catalog_skills.groupBy({
        by: ["category"],
        where: { ...ACTIVE_OFFICIAL, category: { not: "" } },
        _count: { _all: true },
        orderBy: { category: "asc" },
      });
      return rows.map((r) => ({ name: r.category, count: r._count._all }));
    },

    async setCategory(id, category) {
      const result = await prisma.catalog_skills.updateMany({
        where: { id, ...ACTIVE_OFFICIAL },
        data: { category },
      });
      return result.count > 0;
    },

    async assignCategory(ids, category) {
      const result = await prisma.catalog_skills.updateMany({
        where: { id: { in: ids }, ...ACTIVE_OFFICIAL },
        data: { category },
      });
      return result.count;
    },

    async backfillOfficialAssets() {
      const rows = await prisma.catalog_skills.findMany({
        where: { ...OWNER, creative_skill_id: null },
        select: { id: true, name: true, description: true, content: true },
      });
      let created = 0;
      for (const row of rows) {
        const content =
          (row.content ?? "").trim() || (row.description ?? "").trim();
        if (!content) continue;
        const creativeSkillId = await generateCreativeSkillId(prisma, row.name);
        const result = await prisma.catalog_skills.updateMany({
          where: { id: row.id, ...OWNER, creative_skill_id: null },
          data: {
            creative_skill_id: creativeSkillId,
            name_key: normalizeNameKey(row.name),
            content,
          },
        });
        created += result.count;
      }
      return created;
    },

    async renameCategory(from, to) {
      const result = await prisma.catalog_skills.updateMany({
        where: { ...ACTIVE_OFFICIAL, category: from },
        data: { category: to },
      });
      return result.count;
    },

    async clearCategory(name) {
      const result = await prisma.catalog_skills.updateMany({
        where: { ...ACTIVE_OFFICIAL, category: name },
        data: { category: "" },
      });
      return result.count;
    },
  };
}
