import { createHash, randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

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
 *    search_keywords（绝不匹配 content）；usage_count = 激活埋点表 COUNT(DISTINCT user_id)；
 *    官方目录规模小，过滤/排序/分页在内存完成（同 listMine，确定性优先）。
 *  creative_skill / creative_skill_version 已入 Node-owned schema（prisma/schema.prisma +
 *  schema/001_baseline.sql，Java 链已退役）；读路径保留 raw SQL + 查询失败回退空
 *  （旧库缺表/缺列不阻塞主路径）；写路径 deletePersonal 不容错，失败直接抛错；
 *  recordActivation 为埋点写，best-effort 容错，不阻塞消息接纳主路径。 */

export type SkillLibraryCategory = "all" | "film" | "marketing" | "other";
export type SkillLibrarySort = "featured" | "most_used" | "newest";
export type SkillLibraryLang = "zh" | "en";

/** 成功激活埋点（契约 §11.3）：稳定 ID、用户、AgentRun、当次固定版本、来源。 */
export interface SkillActivationInput {
  creativeSkillId: string;
  userId: string;
  agentRunId: string;
  skillVersion: number;
  activationSource: "forced" | "auto";
}

export interface SkillLibraryView {
  creative_skill_id: string | null;
  name: string;
  description: string | null;
  cover_url: string | null;
  source: string;
  asset_domain: "official";
  added: boolean;
  category: string;
  usage_count: number;
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

/** 个人技能创建结果（IK60WU）。 */
export interface PersonalSkillCreateResult {
  creative_skill_id: string;
  name: string;
  description: string;
}

/** 个人技能名称冲突（同用户下已有同 Name Key 的个人技能）。 */
export class SkillNameConflictError extends Error {
  constructor(public nameKey: string) {
    super(`个人技能同名冲突: ${nameKey}`);
    this.name = "SkillNameConflictError";
  }
}

/** 个人技能名称与官方技能保留名冲突（契约 §5.2）。 */
export class SkillNameReservedError extends Error {
  constructor(public nameKey: string) {
    super(`名称与官方技能冲突: ${nameKey}`);
    this.name = "SkillNameReservedError";
  }
}

/** 添加官方技能与同账户个人技能 Name Key 冲突（契约 §5.4，IK60WX）；
 *  携带官方显示名供 BFF 组装解释文案。 */
export class SkillAddConflictError extends Error {
  constructor(public officialSkillName: string) {
    super(`官方技能与个人技能同名，无法添加: ${officialSkillName}`);
    this.name = "SkillAddConflictError";
  }
}

/** Name Key 归一化（契约 §5.1）：trim → 合并连续空白 → Unicode NFC → toLowerCase。
 *  Name Key 只用于冲突判断，原始显示名原样保留。 */
export function normalizeNameKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").normalize("NFC").toLowerCase();
}

/** DJB2 字符串哈希（确定性，用于 creative_skill_id 生成和封面选色）。 */
function djb2Hash(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/** 从显示名生成 creative_skill_id 候选（slugify）：
 *  - 提取 [a-z0-9] 字符，空格/连字符 → 下划线，小写
 *  - 全非 ASCII 或结果太短 → 回退到 s_ + base36(hash)
 *  - 截断到 79 字符（数据库 VARCHAR(80)） */
function slugifyForCreativeSkillId(name: string): string {
  const ascii = name
    .toLowerCase()
    .replace(/[\s\-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
  if (ascii.length >= 3 && /^[a-z]/.test(ascii)) {
    return ascii.slice(0, 79);
  }
  return `s_${djb2Hash(name).toString(36).slice(0, 10)}`.slice(0, 79);
}

/** 生成全局唯一的 creative_skill_id（碰撞追加 _2/_3…，最多 99 次重试）。 */
async function generateCreativeSkillId(
  prisma: PrismaClient,
  name: string,
): Promise<string> {
  const base = slugifyForCreativeSkillId(name);
  for (let suffix = 0; suffix < 100; suffix++) {
    const candidate = suffix === 0 ? base : `${base}_${suffix + 1}`;
    try {
      const rows = await prisma.$queryRawUnsafe<{ c: bigint }[]>(
        `SELECT COUNT(*) AS c FROM creative_skill WHERE creative_skill_id = ?`,
        candidate,
      );
      if (Number(rows[0]?.c ?? 0) === 0) return candidate;
    } catch {
      return candidate;
    }
  }
  return `${base}_${Date.now().toString(36)}`.slice(0, 79);
}

/** 个人技能 Name Key 可用性校验（契约 §5.2）：官方保留名 → "reserved"；
 *  同用户已有同 Name Key 个人技能 → "conflict"；否则 "ok"。
 *  部署前置：存量库必须先执行 §10 v3 补列 SQL（ADD COLUMN name_key）。
 *  若旧库无 name_key 列：校验查询失败被容错按可用放行，但随后 INSERT 含 name_key 列也会失败 → 500。
 *  全新环境由 001_baseline.sql 含列，无需补列。 */
async function checkPersonalNameKeyAvailable(
  prisma: PrismaClient,
  userId: string,
  nameKey: string,
): Promise<"ok" | "conflict" | "reserved"> {
  const officialNames = await prisma.skill.findMany({
    where: { is_delete: 0 },
    select: { name: true },
  });
  const officialNameKeys = new Set(
    officialNames.map((s) => normalizeNameKey(s.name)),
  );
  if (officialNameKeys.has(nameKey)) return "reserved";

  try {
    const conflicts = await prisma.$queryRawUnsafe<{ c: bigint }[]>(
      `SELECT COUNT(*) AS c FROM creative_skill WHERE owner_user_id = ? AND asset_domain = 'personal' AND name_key = ?`,
      BigInt(userId),
      nameKey,
    );
    if (Number(conflicts[0]?.c ?? 0) > 0) return "conflict";
  } catch {
    // 表缺列不阻塞（旧库无 name_key），按可用继续
  }
  return "ok";
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
    q: {
      keyword?: string;
      category?: SkillLibraryCategory;
      sort?: SkillLibrarySort;
      lang?: SkillLibraryLang;
      pageNum: number;
      pageSize: number;
    },
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
  /** 个人技能本体 auto_match 开关（契约 §16.1，IK60X2）：
   *  asset_domain='personal' + owner 谓词保护，0 命中返回 false（不泄露存在性）。 */
  updatePersonalAutoByCreativeSkillId(
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
  /** owner 查看个人技能正文（契约 §13.1，IK60WZ）：owner + personal 谓词
   *  JOIN 版本行取最新 body；非 owner/官方域/未知 → null（不泄露存在性），读路径容错。 */
  findPersonalContent(
    ownerUserId: string,
    creativeSkillId: string,
  ): Promise<{ name: string; description: string | null; body: string } | null>;
  /** 物理删除个人技能本体及其 creative_skill_version 行；
   *  asset_domain='personal' + owner 谓词保护，0 命中返回 false；写失败抛错。 */
  deletePersonal(ownerUserId: string, creativeSkillId: string): Promise<boolean>;
  /** 创建个人技能（IK60WU）：校验名称冲突 → 生成稳定身份 → 写入 creative_skill + version。
   *  名称与官方保留名冲突 → SkillNameReservedError；
   *  同用户下已有同 Name Key → SkillNameConflictError。 */
  createPersonalSkill(
    userId: string,
    input: { name: string; description: string; body: string },
  ): Promise<PersonalSkillCreateResult>;
  /** 个人技能名称可用性预检（IK60X1 总结管道提议名服务端验证，契约 §15.4）：
   *  与 createPersonalSkill 同一套校验（官方保留名 + 同用户 Name Key 唯一）。 */
  checkPersonalNameAvailable(
    userId: string,
    name: string,
  ): Promise<"ok" | "conflict" | "reserved">;
  /** 成功激活埋点（契约 §11.3）：只增不改，best-effort（失败/旧库缺表不阻塞主路径）。 */
  recordActivation(rec: SkillActivationInput): Promise<void>;
}

type SkillRow = {
  id: bigint;
  name: string;
  description: string | null;
  cover_url: string | null;
  source: string;
  category: string;
  sort_order: number;
  gmt_create: Date;
  name_en: string | null;
  name_zh: string | null;
  description_en: string | null;
  description_zh: string | null;
  search_keywords: string | null;
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

/** 批量聚合激活埋点 → creativeSkillId → 去重使用人数（契约 §11.3：COUNT(DISTINCT user_id)）。
 *  表不存在/查询失败 → 空 Map（旧库缺表时 usage_count 记 0，不阻塞主路径）。 */
async function mapUsageCounts(
  prisma: PrismaClient,
  creativeSkillIds: string[],
): Promise<Map<string, number>> {
  if (creativeSkillIds.length === 0) return new Map();
  try {
    const placeholders = creativeSkillIds.map(() => "?").join(",");
    const rows = await prisma.$queryRawUnsafe<
      { creative_skill_id: string; usage_count: bigint }[]
    >(
      `SELECT creative_skill_id, COUNT(DISTINCT user_id) AS usage_count FROM creative_skill_activation WHERE creative_skill_id IN (${placeholders}) GROUP BY creative_skill_id`,
      ...creativeSkillIds,
    );
    return new Map(
      rows.map((r) => [r.creative_skill_id, Number(r.usage_count)]),
    );
  } catch {
    return new Map();
  }
}

/** NULL/空串视同缺失（契约 §11.4）。 */
function nonEmpty(value: string | null): string | null {
  return value !== null && value !== "" ? value : null;
}

/** 语言解析（契约 §11.4）：取请求语言列，空则回退英文列，再回退既有单语字段。 */
function resolveName(lang: SkillLibraryLang, row: SkillRow): string {
  return lang === "zh"
    ? (nonEmpty(row.name_zh) ?? nonEmpty(row.name_en) ?? row.name)
    : (nonEmpty(row.name_en) ?? row.name);
}

function resolveDescription(
  lang: SkillLibraryLang,
  row: SkillRow,
): string | null {
  return lang === "zh"
    ? (nonEmpty(row.description_zh) ??
      nonEmpty(row.description_en) ??
      row.description)
    : (nonEmpty(row.description_en) ?? row.description);
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

/** 名下个人技能白名单行（asset_domain='personal'，按 gmt_create desc，对齐 listMine §12.5）；
 *  表不存在/查询失败 → 空数组。 */
async function queryPersonalByOwner(
  prisma: PrismaClient,
  userId: string,
): Promise<PersonalSkillView[]> {
  try {
    return await prisma.$queryRawUnsafe<PersonalSkillView[]>(
      `SELECT creative_skill_id, name, description FROM creative_skill WHERE owner_user_id = ? AND asset_domain = 'personal' ORDER BY gmt_create DESC`,
      BigInt(userId),
    );
  } catch {
    return [];
  }
}

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

      // 语言解析（§11.4），keyword 只命中解析后的 name/description 与 search_keywords（§11.4，绝不匹配 content）。
      const resolved = rows.map((row) => ({
        row,
        name: resolveName(lang, row),
        description: resolveDescription(lang, row),
      }));
      const matched = q.keyword
        ? resolved.filter(
            (r) =>
              r.name.includes(q.keyword as string) ||
              (r.description?.includes(q.keyword as string) ?? false) ||
              (r.row.search_keywords?.includes(q.keyword as string) ?? false),
          )
        : resolved;

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
            asset_domain: "official" as const,
            added: mineIds.has(row.id.toString()),
            category: row.category,
            usage_count: usageOf(row.id),
          })),
        total: matched.length,
        size: q.pageSize,
        current: q.pageNum,
      };
    },

    async listMine(userId, q) {
      // 官方引用全量（按 user_skill.gmt_create desc），合并个人技能后统一按时间倒序、内存切片分页。
      const rels = await prisma.user_skill.findMany({
        where: { user_id: BigInt(userId), is_delete: 0 },
        orderBy: { gmt_create: "desc" },
        select: { skill_id: true, auto: true, gmt_create: true },
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

      const official: (SkillMineView & { sort_time: Date })[] = rels.map((r) => {
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
          sort_time: r.gmt_create,
        };
      });
      // 个人技能按 gmt_create desc 取回（含 auto_match 本体开关，契约 §16.1）
      let personal: (SkillMineView & { sort_time: Date })[] = [];
      try {
        const personalRows = await prisma.$queryRawUnsafe<
          { creative_skill_id: string; name: string; description: string | null; auto_match: number; gmt_create: Date }[]
        >(
          `SELECT creative_skill_id, name, description, auto_match, gmt_create FROM creative_skill WHERE owner_user_id = ? AND asset_domain = 'personal' ORDER BY gmt_create DESC`,
          BigInt(userId),
        );
        personal = personalRows.map((p) => ({
          creative_skill_id: p.creative_skill_id,
          auto: p.auto_match === 1,
          name: p.name,
          description: p.description,
          cover_url: null,
          source: null,
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

    async updatePersonalAutoByCreativeSkillId(userId, creativeSkillId, auto) {
      // 个人本体开关（契约 §16.1）：asset_domain='personal' + owner 谓词保护，
      // 跨用户/官方域/未知 ID 均 0 命中 → false（不泄露存在性，§7）。
      const r = await prisma.creative_skill.updateMany({
        where: {
          creative_skill_id: creativeSkillId,
          asset_domain: "personal",
          owner_user_id: BigInt(userId),
        },
        data: { auto_match: auto ? 1 : 0 },
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

    async recordActivation(rec) {
      // 埋点只增不改、best-effort：旧库缺表/写失败不阻塞消息接纳主路径（契约 §11.3）。
      try {
        await prisma.creative_skill_activation.create({
          data: {
            creative_skill_id: rec.creativeSkillId,
            user_id: BigInt(rec.userId),
            agent_run_id: rec.agentRunId,
            skill_version: rec.skillVersion,
            activation_source: rec.activationSource,
          },
        });
      } catch {
        // 吞掉：埋点失败不改变既有校验与错误语义。
      }
    },
  };
}
