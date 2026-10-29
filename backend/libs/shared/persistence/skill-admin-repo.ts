import type { Prisma, PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import {
  generateCreativeSkillId,
  normalizeNameKey,
} from "./skill-repo-internals.js";


export interface AdminSkillView {
  id: string;
  name: string;
  cover_url: string | null;
  category: string;
  sort_order: number;
}

export interface AdminSkillDetailView {
  id: string;
  creative_skill_id: string | null;
  name: string;
  description: string | null;
  body: string | null;
  category: string;
  skill_code: string | null;
  cover_url: string | null;
  sort_order: number;
}

export interface AdminSkillUpdateInput {
  name?: string;
  description?: string | null;
  body?: string | null;
  category?: string;
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
  listCategories(): Promise<AdminSkillCategoryView[]>;
  setCategory(id: bigint, category: string): Promise<boolean>;
  assignCategory(ids: bigint[], category: string): Promise<number>;
  backfillOfficialAssets(): Promise<number>;
  renameCategory(from: string, to: string): Promise<number>;
  clearCategory(name: string): Promise<number>;
}

const OFFICIAL = { owner_user_id: BigInt(0), is_delete: 0 };

export function createSkillAdminRepo(prisma: PrismaClient): SkillAdminRepo {
  return {
    async listOfficialSkills() {
      const rows = await prisma.catalog_skills.findMany({
        where: OFFICIAL,
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

    async getOfficialSkill(id) {
      const row = await prisma.catalog_skills.findFirst({
        where: { id, ...OFFICIAL },
        select: {
          id: true,
          creative_skill_id: true,
          name: true,
          description: true,
          body: true,
          category: true,
          skill_code: true,
          cover_url: true,
          sort_order: true,
        },
      });
      return row
        ? {
            id: row.id.toString(),
            creative_skill_id: row.creative_skill_id,
            name: row.name,
            description: row.description,
            body: row.body,
            category: row.category,
            skill_code: row.skill_code,
            cover_url: row.cover_url,
            sort_order: row.sort_order,
          }
        : null;
    },

    async updateOfficialSkill(id, input) {
      const data: Prisma.catalog_skillsUpdateManyMutationInput = {};
      if (input.name !== undefined) {
        const nameKey = normalizeNameKey(input.name);
        const conflict = await prisma.catalog_skills.findFirst({
          where: { ...OFFICIAL, name_key: nameKey, id: { not: id } },
          select: { id: true },
        });
        if (conflict) return "conflict";
        data.name = input.name;
        data.name_key = nameKey;
      }
      if (input.description !== undefined) data.description = input.description;
      if (input.body !== undefined) {
        data.body = input.body;
        data.content_digest = input.body
          ? `sha256:${createHash("sha256").update(input.body).digest("hex")}`
          : null;
      }
      if (input.category !== undefined) data.category = input.category;
      if (Object.keys(data).length === 0) return "ok";
      data.gmt_modified = new Date();
      const result = await prisma.catalog_skills.updateMany({
        where: { id, ...OFFICIAL },
        data,
      });
      return result.count > 0 ? "ok" : "not_found";
    },

    async listCategories() {
      const rows = await prisma.catalog_skills.groupBy({
        by: ["category"],
        where: { ...OFFICIAL, category: { not: "" } },
        _count: { _all: true },
        orderBy: { category: "asc" },
      });
      return rows.map((r) => ({ name: r.category, count: r._count._all }));
    },

    async setCategory(id, category) {
      const result = await prisma.catalog_skills.updateMany({
        where: { id, ...OFFICIAL },
        data: { category },
      });
      return result.count > 0;
    },

    async assignCategory(ids, category) {
      const result = await prisma.catalog_skills.updateMany({
        where: { id: { in: ids }, ...OFFICIAL },
        data: { category },
      });
      return result.count;
    },

    async backfillOfficialAssets() {
      const rows = await prisma.catalog_skills.findMany({
        where: { ...OFFICIAL, creative_skill_id: null },
        select: { id: true, name: true, description: true, body: true },
      });
      let created = 0;
      for (const row of rows) {
        const body = (row.body ?? "").trim() || (row.description ?? "").trim();
        if (!body) continue;
        const creativeSkillId = await generateCreativeSkillId(prisma, row.name);
        const digest = `sha256:${createHash("sha256").update(body).digest("hex")}`;
        const result = await prisma.catalog_skills.updateMany({
          where: { id: row.id, ...OFFICIAL, creative_skill_id: null },
          data: {
            creative_skill_id: creativeSkillId,
            name_key: normalizeNameKey(row.name),
            body,
            content_digest: digest,
          },
        });
        created += result.count;
      }
      return created;
    },

    async renameCategory(from, to) {
      const result = await prisma.catalog_skills.updateMany({
        where: { ...OFFICIAL, category: from },
        data: { category: to },
      });
      return result.count;
    },

    async clearCategory(name) {
      const result = await prisma.catalog_skills.updateMany({
        where: { ...OFFICIAL, category: name },
        data: { category: "" },
      });
      return result.count;
    },
  };
}
