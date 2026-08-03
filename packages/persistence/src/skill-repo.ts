import type { PrismaClient } from "@prisma/client";

/** Skill 资产 repo（Prisma-backed），落地 Creative Skill 资产契约
 *  （docs/specs/2026-08-03-creative-skill-asset-contract.md §2/§3/§6）：
 *  - wire 主键一律 creative_skill_id；自增 id/skill_id、content/body/prompt 永不出库；
 *  - mine = 官方引用（user_skill join skill 快照，official）∪ 名下个人技能（personal），
 *    官方引用按 skill_id asc 在前、个人按 creative_skill_id asc 在后，合并后内存切片分页；
 *  - 注册命令（remove/setAuto）以 creative_skill_id 寻址，经 creative_skill.source_skill_id
 *    解析回目录行；个人域/未知/已删 ID 解析失败，一律按不存在处理；
 *  - 个人技能凭 owner_user_id 可见，跨用户读/删 0 命中，不泄露存在性。
 *  creative_skill / creative_skill_version 已入 Node-owned schema（prisma/schema.prisma +
 *  schema/001_baseline.sql，Java 链已退役）；读路径保留 raw SQL + 查询失败回退空
 *  （旧库缺表/缺列不阻塞主路径）；写路径 deletePersonal 不容错，失败直接抛错。 */

export interface SkillLibraryView {
  creative_skill_id: string | null;
  name: string;
  description: string | null;
  cover_url: string | null;
  source: string;
  asset_domain: "official";
  added: boolean;
}

export interface SkillMineView {
  creative_skill_id: string | null;
  auto: boolean;
  name: string | null;
  description: string | null;
  cover_url: string | null;
  source: string | null;
  asset_domain: "official" | "personal";
}

export interface PersonalSkillView {
  creative_skill_id: string;
  name: string;
  description: string | null;
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
  /** 解析 official 域 creative_skill_id → 内部 skill.id（字符串）；
   *  个人域/未知 ID/目录行已删 → null（按不存在处理）。 */
  resolveOfficialSkillId(creativeSkillId: string): Promise<string | null>;
  /** 技能域信息（forced 激活守卫用）：任意域 creative_skill_id → 域与 owner；
   *  未知 ID/表缺失 → null（按不可用处理，不泄露存在性）。 */
  findAssetDomainInfo(
    creativeSkillId: string,
  ): Promise<{ asset_domain: string; owner_user_id: string } | null>;
  /** 加入「我的」（内部 id，调用方先 resolve）：ON DUPLICATE KEY 恢复逻辑删行 + 刷 auto=false（对齐 Java upsert）。 */
  addReference(userId: string, skillId: string): Promise<void>;
  /** 以 creative_skill_id 移除引用：resolve 后逻辑删（对齐 Java @TableLogic）；未 resolve 到返回 false。 */
  removeReferenceByCreativeSkillId(
    userId: string,
    creativeSkillId: string,
  ): Promise<boolean>;
  /** 以 creative_skill_id 改 auto 开关（仅未删行）；未 resolve 到返回 false。 */
  updateAutoByCreativeSkillId(
    userId: string,
    creativeSkillId: string,
    auto: boolean,
  ): Promise<boolean>;
  /** 名下个人技能（asset_domain='personal'），按 creative_skill_id asc。 */
  listPersonalByOwner(userId: string): Promise<PersonalSkillView[]>;
  /** owner 视角单行个人技能视图；非 owner 0 命中返回 null（不泄露存在性）。 */
  findPersonalView(
    ownerUserId: string,
    creativeSkillId: string,
  ): Promise<PersonalSkillView | null>;
  /** 物理删除个人技能本体及其 creative_skill_version 行；
   *  asset_domain='personal' + owner 谓词保护，0 命中返回 false；写失败抛错。 */
  deletePersonal(ownerUserId: string, creativeSkillId: string): Promise<boolean>;
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

/** 解析 official 域 creative_skill_id → 内部 skill.id；表不存在/个人域/未知/已删 → null。 */
async function resolveOfficialSourceSkillId(
  prisma: PrismaClient,
  creativeSkillId: string,
): Promise<string | null> {
  let rows: { source_skill_id: bigint }[];
  try {
    rows = await prisma.$queryRawUnsafe<{ source_skill_id: bigint }[]>(
      `SELECT source_skill_id FROM creative_skill WHERE creative_skill_id = ? AND asset_domain = 'official'`,
      creativeSkillId,
    );
  } catch {
    return null;
  }
  const sourceSkillId = rows[0]?.source_skill_id;
  if (sourceSkillId == null) return null;
  const c = await prisma.skill.count({
    where: { id: sourceSkillId, is_delete: 0 },
  });
  return c > 0 ? sourceSkillId.toString() : null;
}

/** 名下个人技能白名单行（asset_domain='personal'，按 creative_skill_id asc）；
 *  表不存在/查询失败 → 空数组。 */
async function queryPersonalByOwner(
  prisma: PrismaClient,
  userId: string,
): Promise<PersonalSkillView[]> {
  try {
    return await prisma.$queryRawUnsafe<PersonalSkillView[]>(
      `SELECT creative_skill_id, name, description FROM creative_skill WHERE owner_user_id = ? AND asset_domain = 'personal' ORDER BY creative_skill_id ASC`,
      BigInt(userId),
    );
  } catch {
    return [];
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
          creative_skill_id: creativeIds.get(s.id.toString()) ?? null,
          name: s.name,
          description: s.description,
          cover_url: s.cover_url,
          source: s.source,
          asset_domain: "official",
          added: mineIds.has(s.id.toString()),
        })),
        total,
        size: q.pageSize,
        current: q.pageNum,
      };
    },

    async listMine(userId, q) {
      // 官方引用全量（按 skill_id asc），合并个人技能后内存切片分页（规模小，确定性优先）。
      const rels = await prisma.user_skill.findMany({
        where: { user_id: BigInt(userId), is_delete: 0 },
        orderBy: { skill_id: "asc" },
      });

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

      const official: SkillMineView[] = rels.map((r) => {
        const s = skillMap.get(r.skill_id.toString());
        return {
          creative_skill_id: s
            ? (creativeIds.get(s.id.toString()) ?? null)
            : null,
          auto: r.auto === 1,
          name: s?.name ?? null,
          description: s?.description ?? null,
          cover_url: s?.cover_url ?? null,
          source: s?.source ?? null,
          asset_domain: "official",
        };
      });
      const personal: SkillMineView[] = (
        await queryPersonalByOwner(prisma, userId)
      ).map((p) => ({
        creative_skill_id: p.creative_skill_id,
        auto: false,
        name: p.name,
        description: p.description,
        cover_url: null,
        source: null,
        asset_domain: "personal",
      }));

      const merged = [...official, ...personal];
      const start = (q.pageNum - 1) * q.pageSize;
      return {
        records: merged.slice(start, start + q.pageSize),
        total: merged.length,
        size: q.pageSize,
        current: q.pageNum,
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
          `SELECT asset_domain, owner_user_id FROM creative_skill WHERE creative_skill_id = ?`,
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
      // 原生 upsert：ON DUPLICATE KEY 恢复逻辑删行 + 刷 auto（绕开 @TableLogic 过滤，对齐 Java）。
      await prisma.$executeRaw`INSERT INTO user_skill (user_id, skill_id, auto, version, is_delete) VALUES (${BigInt(userId)}, ${BigInt(skillId)}, 0, 0, 0) ON DUPLICATE KEY UPDATE auto = VALUES(auto), is_delete = 0`;
    },

    async removeReferenceByCreativeSkillId(userId, creativeSkillId) {
      const skillId = await resolveOfficialSourceSkillId(
        prisma,
        creativeSkillId,
      );
      if (skillId === null) return false;
      const r = await prisma.user_skill.updateMany({
        where: { user_id: BigInt(userId), skill_id: BigInt(skillId), is_delete: 0 },
        data: { is_delete: 1 },
      });
      return r.count > 0;
    },

    async updateAutoByCreativeSkillId(userId, creativeSkillId, auto) {
      const skillId = await resolveOfficialSourceSkillId(
        prisma,
        creativeSkillId,
      );
      if (skillId === null) return false;
      const r = await prisma.user_skill.updateMany({
        where: { user_id: BigInt(userId), skill_id: BigInt(skillId), is_delete: 0 },
        data: { auto: auto ? 1 : 0 },
      });
      return r.count > 0;
    },

    async listPersonalByOwner(userId) {
      return queryPersonalByOwner(prisma, userId);
    },

    async findPersonalView(ownerUserId, creativeSkillId) {
      try {
        const rows = await prisma.$queryRawUnsafe<PersonalSkillView[]>(
          `SELECT creative_skill_id, name, description FROM creative_skill WHERE owner_user_id = ? AND creative_skill_id = ? AND asset_domain = 'personal'`,
          BigInt(ownerUserId),
          creativeSkillId,
        );
        return rows[0] ?? null;
      } catch {
        return null;
      }
    },

    async deletePersonal(ownerUserId, creativeSkillId) {
      // 先删本体（asset_domain/owner 谓词保护），0 命中即不动版本行。
      const deleted = await prisma.$executeRawUnsafe(
        `DELETE FROM creative_skill WHERE creative_skill_id = ? AND asset_domain = 'personal' AND owner_user_id = ?`,
        creativeSkillId,
        BigInt(ownerUserId),
      );
      if (deleted === 0) return false;
      await prisma.$executeRawUnsafe(
        `DELETE FROM creative_skill_version WHERE creative_skill_id = ?`,
        creativeSkillId,
      );
      return true;
    },
  };
}
