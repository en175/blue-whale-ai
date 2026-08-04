import type { PrismaClient } from "@prisma/client";

/** Skill 只读 repo（Prisma-backed），复用 skill / user_skill 表。
 *  对齐 Java SkillServiceImpl：library（official + keyword + 分页）与 mine（关系 join 快照），
 *  均排除 content 大字段；mineIds / creativeIds 批量查（无 N+1）。
 *  creative_skill 表在部分环境不存在：查询失败时回退空映射（对齐 Java「无映射返回空 Map」）。 */

export interface SkillLibraryView {
  id: string;
  name: string;
  description: string | null;
  coverUrl: string | null;
  source: string;
  added: boolean;
  creative_skill_id: string | null;
}

export interface SkillMineView {
  skillId: string;
  auto: boolean;
  name: string | null;
  description: string | null;
  coverUrl: string | null;
  source: string | null;
  creative_skill_id: string | null;
}

export interface SkillPage<T> {
  records: T[];
  total: number;
  size: number;
  current: number;
}

export interface SkillRepo {
  listLibrary(
    userId: string,
    q: { keyword?: string; pageNum: number; pageSize: number },
  ): Promise<SkillPage<SkillLibraryView>>;
  listMine(
    userId: string,
    q: { pageNum: number; pageSize: number },
  ): Promise<SkillPage<SkillMineView>>;
  /** skill 是否存在（add 前置校验，对齐 Java requireSkill）。 */
  skillExists(skillId: string): Promise<boolean>;
  /** 加入「我的」：ON DUPLICATE KEY 恢复逻辑删行 + 刷 auto=false（对齐 Java upsert）。 */
  addReference(userId: string, skillId: string): Promise<void>;
  /** 移除「我的」：逻辑删（对齐 Java @TableLogic delete）。返回是否命中。 */
  removeReference(userId: string, skillId: string): Promise<boolean>;
  /** 改 auto 开关（仅未删行）。返回是否命中。 */
  updateAuto(userId: string, skillId: string, auto: boolean): Promise<boolean>;
}

type SkillRow = {
  id: bigint;
  name: string;
  description: string | null;
  cover_url: string | null;
  source: string;
};

/** 批量回查 creative_skill（source_skill_id IN ...）→ sourceSkillId → creativeSkillId。
 *  表不存在/查询失败 → 空 Map（raw 查询绕开 Prisma schema，表缺失不阻塞主路径）。 */
async function mapCreativeSkillIds(
  prisma: PrismaClient,
  skillIds: bigint[],
): Promise<Map<string, string>> {
  if (skillIds.length === 0) return new Map();
  try {
    const placeholders = skillIds.map(() => "?").join(",");
    const rows = await prisma.$queryRawUnsafe<
      { source_skill_id: bigint; creative_skill_id: string }[]
    >(
      `SELECT source_skill_id, creative_skill_id FROM creative_skill WHERE source_skill_id IN (${placeholders})`,
      ...skillIds,
    );
    return new Map(
      rows.map((r) => [r.source_skill_id.toString(), r.creative_skill_id]),
    );
  } catch {
    return new Map();
  }
}

export function createSkillRepo(prisma: PrismaClient): SkillRepo {
  return {
    async listLibrary(userId, q) {
      const where = {
        source: "official",
        is_delete: 0,
        ...(q.keyword
          ? {
              OR: [
                { name: { contains: q.keyword } },
                { description: { contains: q.keyword } },
              ],
            }
          : {}),
      };
      const [total, rows] = await Promise.all([
        prisma.skill.count({ where }),
        prisma.skill.findMany({
          where,
          select: {
            id: true,
            name: true,
            description: true,
            cover_url: true,
            source: true,
          },
          orderBy: { sort_order: "asc" },
          skip: (q.pageNum - 1) * q.pageSize,
          take: q.pageSize,
        }),
      ]);

      // 批量：我的 skill ids + creative 映射（无 N+1）。
      const mine = await prisma.user_skill.findMany({
        where: { user_id: BigInt(userId), is_delete: 0 },
        select: { skill_id: true },
      });
      const mineIds = new Set(mine.map((m) => m.skill_id.toString()));
      const creativeIds = await mapCreativeSkillIds(
        prisma,
        rows.map((r) => r.id),
      );

      return {
        records: rows.map((s: SkillRow) => ({
          id: s.id.toString(),
          name: s.name,
          description: s.description,
          coverUrl: s.cover_url,
          source: s.source,
          added: mineIds.has(s.id.toString()),
          creative_skill_id: creativeIds.get(s.id.toString()) ?? null,
        })),
        total,
        size: q.pageSize,
        current: q.pageNum,
      };
    },

    async listMine(userId, q) {
      const where = { user_id: BigInt(userId), is_delete: 0 };
      const [total, rels] = await Promise.all([
        prisma.user_skill.count({ where }),
        prisma.user_skill.findMany({
          where,
          orderBy: { skill_id: "asc" },
          skip: (q.pageNum - 1) * q.pageSize,
          take: q.pageSize,
        }),
      ]);
      if (rels.length === 0) {
        return { records: [], total, size: q.pageSize, current: q.pageNum };
      }

      // 批量 join skill 快照（排除 content），再批量 creative 映射。
      const skillIds = rels.map((r) => r.skill_id);
      const skills = await prisma.skill.findMany({
        where: { id: { in: skillIds }, is_delete: 0 },
        select: {
          id: true,
          name: true,
          description: true,
          cover_url: true,
          source: true,
        },
      });
      const skillMap = new Map(skills.map((s) => [s.id.toString(), s]));
      const creativeIds = await mapCreativeSkillIds(prisma, skillIds);

      return {
        records: rels.map((r) => {
          const s = skillMap.get(r.skill_id.toString());
          return {
            skillId: r.skill_id.toString(),
            auto: r.auto === 1,
            name: s?.name ?? null,
            description: s?.description ?? null,
            coverUrl: s?.cover_url ?? null,
            source: s?.source ?? null,
            creative_skill_id: s
              ? (creativeIds.get(s.id.toString()) ?? null)
              : null,
          };
        }),
        total,
        size: q.pageSize,
        current: q.pageNum,
      };
    },

    async skillExists(skillId) {
      const c = await prisma.skill.count({
        where: { id: BigInt(skillId), is_delete: 0 },
        take: 1,
      });
      return c > 0;
    },

    async addReference(userId, skillId) {
      // 原生 upsert：ON DUPLICATE KEY 恢复逻辑删行 + 刷 auto（绕开 @TableLogic 过滤，对齐 Java）。
      await prisma.$executeRaw`INSERT INTO user_skill (user_id, skill_id, auto, version, is_delete) VALUES (${BigInt(userId)}, ${BigInt(skillId)}, 0, 0, 0) ON DUPLICATE KEY UPDATE auto = VALUES(auto), is_delete = 0`;
    },

    async removeReference(userId, skillId) {
      const r = await prisma.user_skill.updateMany({
        where: { user_id: BigInt(userId), skill_id: BigInt(skillId), is_delete: 0 },
        data: { is_delete: 1 },
      });
      return r.count > 0;
    },

    async updateAuto(userId, skillId, auto) {
      const r = await prisma.user_skill.updateMany({
        where: { user_id: BigInt(userId), skill_id: BigInt(skillId), is_delete: 0 },
        data: { auto: auto ? 1 : 0 },
      });
      return r.count > 0;
    },
  };
}
