import {createHash, randomUUID} from "node:crypto";
import type {PrismaClient} from "@prisma/client";
import {checkPersonalNameKeyAvailable, generateCreativeSkillId, mapCreativeSkillIds, mapUsageCounts, matchLibraryKeyword, normalizeNameKey, resolveDescription, resolveName, resolveOfficialSourceSkillId, type SkillRow} from "./skill-repo-internals.js";
import {SkillAddConflictError, SkillNameConflictError, SkillNameReservedError} from "./skill-repo-types.js";
import type {SkillMineView, SkillRepo} from "./skill-repo-types.js";

export * from "./skill-repo-types.js";
export { normalizeNameKey } from "./skill-repo-internals.js";


export function createSkillRepo(prisma: PrismaClient): SkillRepo {
  return {
    async listLibrary(userId, q) {
      const lang = q.lang ?? "zh";
      const sort = q.sort ?? "featured";
      const where = {
        source: "official",
        is_delete: 0,
        ...(q.category && q.category !== "all"
          ? { category: q.category }
          : {}),
      };
      const rows: SkillRow[] = await prisma.catalog_skills.findMany({
        where,
        select: {
          id: true,
          name: true,
          description: true,
          cover_url: true,
          source: true,
          skill_code: true,
          category: true,
          sort_order: true,
          gmt_create: true,
          name_en: true,
          name_zh: true,
          description_en: true,
          description_zh: true,
          search_keywords: true,
        },
        orderBy: { sort_order: "asc" },
      });

      const resolved = rows.map((row) => ({
        row,
        name: resolveName(lang, row),
        description: resolveDescription(lang, row),
      }));
      const matched = resolved.filter((r) =>
        matchLibraryKeyword(
          q.keyword,
          r.name,
          r.description,
          r.row.search_keywords,
        ),
      );

      const mine = await prisma.user_skills.findMany({
        where: { user_id: BigInt(userId), is_delete: 0 },
        select: { skill_id: true },
      });
      const mineIds = new Set(mine.map((m) => m.skill_id.toString()));
      const creativeIds = await mapCreativeSkillIds(
        prisma,
        matched.map((r) => r.row.id),
      );
      const usageCounts = await mapUsageCounts(prisma, [...creativeIds.values()]);
      const usageOf = (skillId: bigint): number => {
        const cid = creativeIds.get(skillId.toString());
        return cid !== undefined ? (usageCounts.get(cid) ?? 0) : 0;
      };

      if (sort === "newest") {
        matched.sort(
          (a, b) => b.row.gmt_create.getTime() - a.row.gmt_create.getTime(),
        );
      } else if (sort === "most_used") {
        matched.sort(
          (a, b) =>
            usageOf(b.row.id) - usageOf(a.row.id) ||
            a.row.sort_order - b.row.sort_order,
        );
      }

      const start = (q.pageNum - 1) * q.pageSize;
      return {
        records: matched
          .slice(start, start + q.pageSize)
          .map(({ row, name, description }) => ({
            creative_skill_id: creativeIds.get(row.id.toString()) ?? null,
            name,
            description,
            cover_url: row.cover_url,
            source: row.source,
            skill_code: row.skill_code ?? null,
            asset_domain: "official" as const,
            added: mineIds.has(row.id.toString()),
            category: row.category,
            usage_count: usageOf(row.id),
          })),
        total: matched.length,
        size: q.pageSize,
        current: q.pageNum,
        pages: Math.ceil(matched.length / q.pageSize),
      };
    },

    async getOfficialContent(creativeId) {
      const row = await prisma.catalog_creative_skills.findFirst({
        where: { creative_skill_id: creativeId, asset_domain: "official" },
        select: { active_version_id: true },
      });
      if (!row?.active_version_id) return null;
      const ver = await prisma.catalog_creative_skill_versions.findFirst({
        where: { creative_skill_version_id: row.active_version_id },
        select: { body: true },
      });
      return ver?.body ?? null;
    },

    async findAgentSkill(creativeSkillId, requestingUserId) {
      try {
        const rows = await prisma.$queryRawUnsafe<
          {
            creative_skill_id: string;
            name: string;
            description: string | null;
            asset_domain: string;
            body: string;
          }[]
        >(
          `SELECT cs.creative_skill_id,
                  COALESCE(NULLIF(s.name_zh, ''), cs.name) AS name,
                  cs.description,
                  cs.asset_domain,
                  v.body
             FROM catalog_creative_skills cs
             JOIN catalog_creative_skill_versions v ON v.creative_skill_id = cs.creative_skill_id
             LEFT JOIN catalog_skills s ON s.id = cs.source_skill_id AND s.is_delete = 0
            WHERE cs.creative_skill_id = ?
              AND (cs.asset_domain = 'official'
                   OR (cs.asset_domain = 'personal' AND cs.owner_user_id = ?))
            ORDER BY (v.creative_skill_version_id = cs.active_version_id) DESC, v.id DESC
            LIMIT 1`,
          creativeSkillId,
          BigInt(requestingUserId),
        );
        return rows[0] ?? null;
      } catch {
        return null;
      }
    },

    async listMine(userId, q) {
      const rels = await prisma.user_skills.findMany({
        where: { user_id: BigInt(userId), is_delete: 0 },
        orderBy: { gmt_create: "desc" },
        select: { skill_id: true, gmt_create: true },
      });

      const skillIds = rels.map((r) => r.skill_id);
      const skills = await prisma.catalog_skills.findMany({
        where: { id: { in: skillIds }, is_delete: 0 },
        select: {
          id: true,
          name: true,
          description: true,
          cover_url: true,
          source: true,
          skill_code: true,
          name_en: true,
          name_zh: true,
        },
      });
      const skillMap = new Map(skills.map((s) => [s.id.toString(), s]));
      const creativeIds = await mapCreativeSkillIds(prisma, skillIds);

      const official: (SkillMineView & { sort_time: Date })[] = rels.map((r) => {
        const s = skillMap.get(r.skill_id.toString());
        return {
          creative_skill_id: s
            ? (creativeIds.get(s.id.toString()) ?? null)
            : null,
          name: s ? resolveName("zh", s as SkillRow) : null,
          description: s?.description ?? null,
          cover_url: s?.cover_url ?? null,
          source: s?.source ?? null,
          skill_code: s?.skill_code ?? null,
          asset_domain: "official",
          sort_time: r.gmt_create,
        };
      });
      let personal: (SkillMineView & { sort_time: Date })[] = [];
      try {
        const personalRows = await prisma.$queryRawUnsafe<
          { creative_skill_id: string; name: string; description: string | null; gmt_create: Date }[]
        >(
          `SELECT creative_skill_id, name, description, gmt_create FROM catalog_creative_skills WHERE owner_user_id = ? AND asset_domain = 'personal' ORDER BY gmt_create DESC`,
          BigInt(userId),
        );
        personal = personalRows.map((p) => ({
          creative_skill_id: p.creative_skill_id,
          name: p.name,
          description: p.description,
          cover_url: null,
          source: null,
          skill_code: null,
          asset_domain: "personal",
          sort_time: p.gmt_create,
        }));
      } catch {
      }

      const merged = [...official, ...personal].sort(
        (a, b) => b.sort_time.getTime() - a.sort_time.getTime(),
      );
      const start = (q.pageNum - 1) * q.pageSize;
      return {
        records: merged.slice(start, start + q.pageSize).map(({ sort_time: _, ...view }) => view),
        total: merged.length,
        size: q.pageSize,
        current: q.pageNum,
        pages: Math.ceil(merged.length / q.pageSize),
      };
    },

    async resolveOfficialSkillId(creativeSkillId) {
      return resolveOfficialSourceSkillId(prisma, creativeSkillId);
    },

    async findAssetDomainInfo(creativeSkillId) {
      try {
        const rows = await prisma.$queryRawUnsafe<
          { asset_domain: string; owner_user_id: bigint }[]
        >(
          `SELECT asset_domain, owner_user_id FROM catalog_creative_skills WHERE creative_skill_id = ?`,
          creativeSkillId,
        );
        const row = rows[0];
        return row
          ? {
              asset_domain: row.asset_domain,
              owner_user_id: row.owner_user_id.toString(),
            }
          : null;
      } catch {
        return null;
      }
    },

    async addReference(userId, skillId) {
      const official = await prisma.catalog_skills.findUnique({
        where: { id: BigInt(skillId) },
        select: { name: true },
      });
      if (official) {
        const nameKey = normalizeNameKey(official.name);
        try {
          const conflicts = await prisma.$queryRawUnsafe<{ c: bigint }[]>(
            `SELECT COUNT(*) AS c FROM catalog_creative_skills WHERE owner_user_id = ? AND asset_domain = 'personal' AND name_key = ?`,
            BigInt(userId),
            nameKey,
          );
          if (Number(conflicts[0]?.c ?? 0) > 0) {
            throw new SkillAddConflictError(official.name);
          }
        } catch (e) {
          if (e instanceof SkillAddConflictError) throw e;
        }
      }
      await prisma.$executeRaw`INSERT INTO user_skills (user_id, skill_id, auto, version, is_delete) VALUES (${BigInt(userId)}, ${BigInt(skillId)}, 0, 0, 0) ON DUPLICATE KEY UPDATE auto = VALUES(auto), is_delete = 0, gmt_create = CURRENT_TIMESTAMP(3)`;
    },

    async removeReferenceByCreativeSkillId(userId, creativeSkillId) {
      const skillId = await resolveOfficialSourceSkillId(
        prisma,
        creativeSkillId,
      );
      if (skillId === null) return false;
      const r = await prisma.user_skills.updateMany({
        where: { user_id: BigInt(userId), skill_id: BigInt(skillId), is_delete: 0 },
        data: { is_delete: 1 },
      });
      return r.count > 0;
    },

    async findPersonalContent(ownerUserId, creativeSkillId) {
      try {
        const rows = await prisma.$queryRawUnsafe<
          { name: string; description: string | null; body: string }[]
        >(
          `SELECT cs.name, cs.description, v.body FROM catalog_creative_skills cs JOIN catalog_creative_skill_versions v ON v.creative_skill_id = cs.creative_skill_id WHERE cs.owner_user_id = ? AND cs.creative_skill_id = ? AND cs.asset_domain = 'personal' ORDER BY v.id DESC LIMIT 1`,
          BigInt(ownerUserId),
          creativeSkillId,
        );
        return rows[0] ?? null;
      } catch {
        return null;
      }
    },

    async deletePersonal(ownerUserId, creativeSkillId) {
      return prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRawUnsafe<{ name: string }[]>(
          `SELECT name FROM catalog_creative_skills WHERE creative_skill_id = ? AND asset_domain = 'personal' AND owner_user_id = ? LIMIT 1`,
          creativeSkillId,
          BigInt(ownerUserId),
        );
        const skill = rows[0];
        if (!skill) return false;

        const deleted = await tx.$executeRawUnsafe(
          `DELETE FROM catalog_creative_skills WHERE creative_skill_id = ? AND asset_domain = 'personal' AND owner_user_id = ?`,
          creativeSkillId,
          BigInt(ownerUserId),
        );
        if (deleted === 0) return false;

        await tx.$executeRawUnsafe(
          `DELETE FROM catalog_creative_skill_versions WHERE creative_skill_id = ?`,
          creativeSkillId,
        );
        return true;
      });
    },

    async createPersonalSkill(userId, input) {
      const nameKey = normalizeNameKey(input.name);
      const availability = await checkPersonalNameKeyAvailable(
        prisma,
        userId,
        nameKey,
      );
      if (availability === "reserved") throw new SkillNameReservedError(nameKey);
      if (availability === "conflict") throw new SkillNameConflictError(nameKey);

      const creativeSkillId = await generateCreativeSkillId(prisma, input.name);
      const contentDigest = `sha256:${createHash("sha256").update(input.body).digest("hex")}`;
      const creativeSkillVersionId = randomUUID();

      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
          `INSERT INTO catalog_creative_skills (creative_skill_id, name, description, owner_user_id, asset_domain, name_key, active_version_id) VALUES (?, ?, ?, ?, 'personal', ?, ?)`,
          creativeSkillId,
          input.name,
          input.description,
          BigInt(userId),
          nameKey,
          creativeSkillVersionId,
        );
        await tx.$executeRawUnsafe(
          `INSERT INTO catalog_creative_skill_versions (creative_skill_version_id, creative_skill_id, display_version, body, content_digest, resource_digest) VALUES (?, ?, '1.0.0', ?, ?, ?)`,
          creativeSkillVersionId,
          creativeSkillId,
          input.body,
          contentDigest,
          contentDigest,
        );
      });

      return {
        creative_skill_id: creativeSkillId,
        name: input.name,
        description: input.description,
      };
    },

    checkPersonalNameAvailable(userId, name) {
      return checkPersonalNameKeyAvailable(
        prisma,
        userId,
        normalizeNameKey(name),
      );
    },

  };
}
