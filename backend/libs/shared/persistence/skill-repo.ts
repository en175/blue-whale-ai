// Skill 资产仓储组合入口。类型与内部工具拆分到同目录子模块（IK74V8，≤800 行硬线）；
// 本文件保留读写方法实现与再导出，对外导出面保持不变。
import {createHash, randomUUID} from "node:crypto";
import type {PrismaClient} from "@prisma/client";
import {scrubCreativeSkillFromRunPin} from "./agent-run-pin.js";
import {checkPersonalNameKeyAvailable, countActiveRunReferences, decodeTerminalRunPin, escapeJsonSearchTerm, generateCreativeSkillId, mapCreativeSkillIds, mapUsageCounts, matchLibraryKeyword, normalizeNameKey, resolveDescription, resolveName, resolveOfficialSourceSkillId, type SkillRow} from "./skill-repo-internals.js";
import {SkillAddConflictError, SkillInUseError, SkillNameConflictError, SkillNameReservedError} from "./skill-repo-types.js";
import type {SkillMineView, SkillRepo} from "./skill-repo-types.js";

export * from "./skill-repo-types.js";
export { normalizeNameKey } from "./skill-repo-internals.js";

/** Skill 资产 repo（Prisma-backed），落地 Creative Skill 资产契约
 *  （docs/specs/2026-08-03-creative-skill-asset-contract.md §2/§3/§6/§11）：
 *  - wire 主键一律 creative_skill_id；自增 id/skill_id、content/body/prompt 永不出库；
 *  - mine = 官方引用（user_skill join skill 快照，official）∪ 名下个人技能（personal），
 *    官方引用按 skill_id asc 在前、个人按 creative_skill_id asc 在后，合并后内存切片分页；
 *  - 注册命令（remove/setAuto）以 creative_skill_id 寻址，经 creative_skill.source_skill_id
 *    解析回目录行；个人域/未知/已删 ID 解析失败，一律按不存在处理；
 *  - 个人技能凭 owner_user_id 可见，跨用户读/删 0 命中，不泄露存在性；
 *  - library v2（IK60WT，§11）：category 过滤、featured/most_used/newest 排序、zh/en
 *    语言解析（回退英文列再回退单语字段）、keyword 命中解析语言 name/description 与
 *    search_keywords（绝不匹配 content；IKBMA3：空白拆词 + 全词命中）；usage_count =
 *    激活埋点表 COUNT(DISTINCT user_id)（IKEEFV：埋点表已删，raw SQL 缺表容错 → 恒 0）；
 *    官方目录规模小，过滤/排序/分页在内存完成（同 listMine，确定性优先）。
 *  creative_skill / creative_skill_version 已入 Node-owned schema（prisma/schema.prisma +
 *  schema/001_baseline.sql，Java 链已退役）；读路径保留 raw SQL + 查询失败回退空
 *  （旧库缺表/缺列不阻塞主路径）；写路径 deletePersonal 不容错，失败直接抛错；
 *  IKCKOW：recordActivation 埋点写全仓零调用方，随 creative_skill_activation 表（IKEEFV）一并移除。 */

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
      // 官方目录规模小：全量取回（sort_order asc 保底确定序），语言解析/keyword/排序/分页内存完成。
      const rows: SkillRow[] = await prisma.skill.findMany({
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

      // 语言解析（§11.4），keyword 命中解析后的 name/description 与 search_keywords
      // （§11.4，绝不匹配 content）；IKBMA3：空白拆词 + 全词命中（单词即整串 includes）。
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

      // 批量：我的 skill ids + creative 映射 + 去重使用人数（无 N+1）。
      const mine = await prisma.user_skill.findMany({
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

      // 排序（§11.2）：featured=取回的 sort_order asc；newest=gmt_create desc；
      // most_used=去重人数 desc，人数相同按 sort_order asc 兜底。
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
      const row = await prisma.creative_skill.findFirst({
        where: { creative_skill_id: creativeId, asset_domain: "official" },
        select: { active_version_id: true },
      });
      if (!row?.active_version_id) return null;
      const ver = await prisma.creative_skill_version.findFirst({
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
          // 优先 active version，没有 active 指针时退到最新一版——个人技能建出来时
          // active_version_id 可能还没回填（同 findPersonalContent 的取法）。
          // 中文名在 skill.name_zh（官方目录 108/108 都有），creative_skill.name 是英文标题式
          // （`Ugc Ads Video`）。用户在技能库里看到的、点的都是中文名，agent 回头说「用了哪条」
          // 时必须是同一个名字，否则用户对不上。个人技能没有目录行，退回 creative_skill.name
          // ——那本来就是用户自己起的名。
          `SELECT cs.creative_skill_id,
                  COALESCE(NULLIF(s.name_zh, ''), cs.name) AS name,
                  cs.description,
                  cs.asset_domain,
                  v.body
             FROM creative_skill cs
             JOIN creative_skill_version v ON v.creative_skill_id = cs.creative_skill_id
             LEFT JOIN skill s ON s.id = cs.source_skill_id AND s.is_delete = 0
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
        // 读路径容错，与本文件其余读方法一致：解析不到就是没有，不阻塞产卡主路径。
        return null;
      }
    },

    async listMine(userId, q) {
      // 官方引用全量（按 user_skill.gmt_create desc），合并个人技能后统一按时间倒序、内存切片分页。
      const rels = await prisma.user_skill.findMany({
        where: { user_id: BigInt(userId), is_delete: 0 },
        orderBy: { gmt_create: "desc" },
        select: { skill_id: true, gmt_create: true },
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
          skill_code: true,
          // IKCXOK：语言列一并取回，官方引用标题按 §11.4 中文优先解析
          // （name_zh → name_en → 单语 name），与技能库展示一致，不再直接回退英文标题。
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
      // 个人技能按 gmt_create desc 取回。
      let personal: (SkillMineView & { sort_time: Date })[] = [];
      try {
        const personalRows = await prisma.$queryRawUnsafe<
          { creative_skill_id: string; name: string; description: string | null; gmt_create: Date }[]
        >(
          `SELECT creative_skill_id, name, description, gmt_create FROM creative_skill WHERE owner_user_id = ? AND asset_domain = 'personal' ORDER BY gmt_create DESC`,
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
        // 旧库缺表/缺列不阻塞主路径
      }

      // 统一按 sort_time desc 合并后切片
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
      // 反向冲突检查（契约 §5.4，IK60WX）：官方技能名归一为 Name Key 后与同账户
      // 个人技能撞名 → 拒绝添加（直接使用不受影响）。旧库缺 name_key 列 → 容错跳过
      // （与 createPersonalSkill 同模式）。
      const official = await prisma.skill.findUnique({
        where: { id: BigInt(skillId) },
        select: { name: true },
      });
      if (official) {
        const nameKey = normalizeNameKey(official.name);
        try {
          const conflicts = await prisma.$queryRawUnsafe<{ c: bigint }[]>(
            `SELECT COUNT(*) AS c FROM creative_skill WHERE owner_user_id = ? AND asset_domain = 'personal' AND name_key = ?`,
            BigInt(userId),
            nameKey,
          );
          if (Number(conflicts[0]?.c ?? 0) > 0) {
            throw new SkillAddConflictError(official.name);
          }
        } catch (e) {
          if (e instanceof SkillAddConflictError) throw e;
          // 表缺列不阻塞（旧库无 name_key），继续添加
        }
      }
      // 原生 upsert：ON DUPLICATE KEY 恢复逻辑删行 + 刷 auto（绕开 @TableLogic 过滤，对齐 Java）。
      // 重加时同步刷 gmt_create（IK693G）：listMine 按 user_skill.gmt_create desc 排序，
      // 不刷则重加技能仍按首次添加时间排位、进不了顶部（spec 故事 27/30）。
      await prisma.$executeRaw`INSERT INTO user_skill (user_id, skill_id, auto, version, is_delete) VALUES (${BigInt(userId)}, ${BigInt(skillId)}, 0, 0, 0) ON DUPLICATE KEY UPDATE auto = VALUES(auto), is_delete = 0, gmt_create = CURRENT_TIMESTAMP(3)`;
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

    async findPersonalContent(ownerUserId, creativeSkillId) {
      try {
        const rows = await prisma.$queryRawUnsafe<
          { name: string; description: string | null; body: string }[]
        >(
          `SELECT cs.name, cs.description, v.body FROM creative_skill cs JOIN creative_skill_version v ON v.creative_skill_id = cs.creative_skill_id WHERE cs.owner_user_id = ? AND cs.creative_skill_id = ? AND cs.asset_domain = 'personal' ORDER BY v.id DESC LIMIT 1`,
          BigInt(ownerUserId),
          creativeSkillId,
        );
        return rows[0] ?? null;
      } catch {
        return null;
      }
    },

    async deletePersonal(ownerUserId, creativeSkillId) {
      // 交互事务（先例：createPersonalSkill）：删除本体 + 终态 scrub 原子提交。
      // 顺序 = name SELECT → 禁删检查 → DELETE 本体（X 锁）→ X 锁后复检 → scrub → DELETE 版本行；
      // 复检命中（关闭「检查后新建 run」窗口）抛错整体回滚。残余窗口（复检后提交的新 run）
      // 语义等价现状「快照寿命长于技能行」，pin 正文自足可正常执行（契约 §13.2）。
      return prisma.$transaction(async (tx) => {
        // 1. 存在性 + 名称（owner 谓词保护；0 命中保持「不存在」语义，不泄露存在性）。
        const rows = await tx.$queryRawUnsafe<{ name: string }[]>(
          `SELECT name FROM creative_skill WHERE creative_skill_id = ? AND asset_domain = 'personal' AND owner_user_id = ? LIMIT 1`,
          creativeSkillId,
          BigInt(ownerUserId),
        );
        const skill = rows[0];
        if (!skill) return false;

        // 2. 进行中引用禁删（fail-closed：终态之外一律视作进行中）。
        if ((await countActiveRunReferences(tx, creativeSkillId)) > 0) {
          throw new SkillInUseError(skill.name, creativeSkillId);
        }

        // 3. 删除本体（X 锁 + owner 谓词），0 命中（并发已删）即不动版本行。
        const deleted = await tx.$executeRawUnsafe(
          `DELETE FROM creative_skill WHERE creative_skill_id = ? AND asset_domain = 'personal' AND owner_user_id = ?`,
          creativeSkillId,
          BigInt(ownerUserId),
        );
        if (deleted === 0) return false;

        // 4. X 锁后复检（关闭「检查后新建 run」窗口，命中即抛错整体回滚）。
        if ((await countActiveRunReferences(tx, creativeSkillId)) > 0) {
          throw new SkillInUseError(skill.name, creativeSkillId);
        }

        // 5. 终态 scrub：引用该技能的历史 run 移除正文供应（移除条目而非删字段，
        //    schema 兼容；activations 保留为「曾使用」最小事实）。无变化不写库。
        const refs = await tx.$queryRawUnsafe<
          { id: bigint; run_pin: unknown }[]
        >(
          `SELECT id, run_pin FROM agent_runs WHERE is_delete = 0 AND status IN ('completed', 'failed', 'cancelled') AND JSON_SEARCH(run_pin, 'one', ?) IS NOT NULL`,
          escapeJsonSearchTerm(creativeSkillId),
        );
        for (const ref of refs) {
          const decoded = decodeTerminalRunPin(ref.run_pin);
          if (!decoded) continue;
          const scrubbed = scrubCreativeSkillFromRunPin(
            decoded.pin,
            creativeSkillId,
          );
          const next = JSON.stringify(scrubbed);
          if (next === decoded.serialized) continue;
          await tx.$executeRawUnsafe(
            `UPDATE agent_runs SET run_pin = ?, gmt_modified = CURRENT_TIMESTAMP(3) WHERE id = ?`,
            next,
            ref.id,
          );
        }

        // 6. 删除版本行。
        await tx.$executeRawUnsafe(
          `DELETE FROM creative_skill_version WHERE creative_skill_id = ?`,
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
          `INSERT INTO creative_skill (creative_skill_id, name, description, owner_user_id, asset_domain, name_key, active_version_id) VALUES (?, ?, ?, ?, 'personal', ?, ?)`,
          creativeSkillId,
          input.name,
          input.description,
          BigInt(userId),
          nameKey,
          creativeSkillVersionId,
        );
        await tx.$executeRawUnsafe(
          `INSERT INTO creative_skill_version (creative_skill_version_id, creative_skill_id, display_version, body, content_digest, resource_digest) VALUES (?, ?, '1.0.0', ?, ?, ?)`,
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
