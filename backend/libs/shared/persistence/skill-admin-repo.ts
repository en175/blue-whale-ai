import type { PrismaClient } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
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

export interface AdminSkillCategoryView {
  name: string;
  count: number;
}

export interface SkillAdminRepo {
  listOfficialSkills(): Promise<AdminSkillView[]>;
  listCategories(): Promise<AdminSkillCategoryView[]>;
  setCategory(id: bigint, category: string): Promise<boolean>;
  assignCategory(ids: bigint[], category: string): Promise<number>;
  backfillOfficialAssets(): Promise<number>;
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

    async assignCategory(ids, category) {
      const result = await prisma.skill.updateMany({
        where: { id: { in: ids }, source: "official", is_delete: 0 },
        data: { category },
      });
      return result.count;
    },

    async backfillOfficialAssets() {
      const rows = await prisma.skill.findMany({
        where: { source: "official", is_delete: 0 },
        select: { id: true, name: true, description: true, content: true },
      });
      let created = 0;
      for (const row of rows) {
        const existing = await prisma.creative_skill.findFirst({
          where: { source_skill_id: row.id, asset_domain: "official" },
          select: { id: true },
        });
        if (existing) continue;
        const body = (row.content ?? "").trim() || (row.description ?? "").trim();
        if (!body) continue;
        const creativeSkillId = await generateCreativeSkillId(prisma, row.name);
        const digest = `sha256:${createHash("sha256").update(body).digest("hex")}`;
        const versionId = randomUUID();
        await prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(
            `INSERT INTO creative_skill (creative_skill_id, name, description, owner_user_id, asset_domain, name_key, source_skill_id, active_version_id) VALUES (?, ?, ?, 0, 'official', ?, ?, ?)`,
            creativeSkillId,
            row.name,
            row.description,
            normalizeNameKey(row.name),
            row.id,
            versionId,
          );
          await tx.$executeRawUnsafe(
            `INSERT INTO creative_skill_version (creative_skill_version_id, creative_skill_id, display_version, body, content_digest, resource_digest) VALUES (?, ?, '1.0.0', ?, ?, ?)`,
            versionId,
            creativeSkillId,
            body,
            digest,
            digest,
          );
        });
        created++;
      }
      return created;
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
