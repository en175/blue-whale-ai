// IK74V8：从 skill-repo.ts 拆出（≤800 行硬线）。逐块搬运，语义不变。
// 共享工具：名称归一化/冲突检查、creative_skill_id 生成、行投影与语言解析。
import type { Prisma, PrismaClient } from "@prisma/client";
import {
  agentRunPinSchema,
  type AgentRunPin,
} from "@blue-whale/contracts";

import type {
  SkillLibraryLang,
} from "./skill-repo-types.js";

export function normalizeNameKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").normalize("NFC").toLowerCase();
}

/** DJB2 字符串哈希（确定性，用于 creative_skill_id 生成和封面选色）。 */
export function djb2Hash(str: string): number {
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
export function slugifyForCreativeSkillId(name: string): string {
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
export async function generateCreativeSkillId(
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
export async function checkPersonalNameKeyAvailable(
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

export type SkillRow = {
  id: bigint;
  name: string;
  description: string | null;
  cover_url: string | null;
  source: string;
  skill_code: string | null;
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
export async function mapCreativeSkillIds(
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
export async function mapUsageCounts(
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
export function nonEmpty(value: string | null): string | null {
  return value !== null && value !== "" ? value : null;
}

/** 语言解析（契约 §11.4）：取请求语言列，空则回退英文列，再回退既有单语字段。 */
export function resolveName(lang: SkillLibraryLang, row: SkillRow): string {
  return lang === "zh"
    ? (nonEmpty(row.name_zh) ?? nonEmpty(row.name_en) ?? row.name)
    : (nonEmpty(row.name_en) ?? row.name);
}

export function resolveDescription(
  lang: SkillLibraryLang,
  row: SkillRow,
): string | null {
  return lang === "zh"
    ? (nonEmpty(row.description_zh) ??
      nonEmpty(row.description_en) ??
      row.description)
    : (nonEmpty(row.description_en) ?? row.description);
}

/** 把 keyword 按空白拆成单词列表（折叠空白；空串/全空白 → 空数组）。
 *  IKBMA3：技能库搜索由整串子串匹配升级为「空白拆词 + 全词命中」，
 *  单词即退化为整串 includes 语义（完全兼容既有行为）。 */
export function splitSearchTerms(keyword: string): string[] {
  return keyword.trim().split(/\s+/).filter((t) => t.length > 0);
}

/** 分词模糊命中判定（契约 §11.4，IKBMA3）：
 *  - 无词 → 全部命中（keyword 为空时不筛）；
 *  - 每个词都需出现在解析语言的 name/description 或 search_keywords 之一；
 *  - 匹配面与整串 includes 时代一致（绝不匹配正文 content）。 */
export function matchLibraryKeyword(
  keyword: string | undefined,
  name: string,
  description: string | null,
  searchKeywords: string | null,
): boolean {
  const terms = splitSearchTerms(keyword ?? "");
  if (terms.length === 0) return true;
  return terms.every((term) =>
    name.includes(term) ||
    (description?.includes(term) ?? false) ||
    (searchKeywords?.includes(term) ?? false),
  );
}

/** 解析 official 域 creative_skill_id → 内部 skill.id；表不存在/个人域/未知/已删 → null。 */
export async function resolveOfficialSourceSkillId(
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

/** JSON_SEARCH 的 search 串通配符转义（契约 §13.2，IK6B2H）：
 *  creative_skill_id 字符集含 `_`（JSON_SEARCH 视作任意单字符通配），加反斜杠转义为
 *  字面量，避免误匹配形态相近的其它技能 ID（字符集不含 `%`/`\`，无需处理）。 */
export function escapeJsonSearchTerm(creativeSkillId: string): string {
  return creativeSkillId.replace(/_/g, "\\_");
}

/** 引用该技能的进行中 AgentRun 数（fail-closed 写法，契约 §13.2）：
 *  终态之外一律视作进行中（含 queued/running/awaiting_input/awaiting_job/
 *  recovery_failed 与未来新增状态），命中即禁删。 */
export async function countActiveRunReferences(
  tx: Prisma.TransactionClient,
  creativeSkillId: string,
): Promise<number> {
  const rows = await tx.$queryRawUnsafe<{ c: bigint }[]>(
    `SELECT COUNT(*) AS c FROM agent_runs WHERE is_delete = 0 AND status NOT IN ('completed', 'failed', 'cancelled') AND JSON_SEARCH(run_pin, 'one', ?) IS NOT NULL`,
    escapeJsonSearchTerm(creativeSkillId),
  );
  return Number(rows[0]?.c ?? 0);
}

/** 终态 run 的 run_pin 解码（quaint 读 JSON 列可能返回字符串或已解析对象）：
 *  统一防御解析 + schema 自检；任何失败 → null（跳过该行，不阻塞删除主线）。 */
export function decodeTerminalRunPin(
  raw: unknown,
): { pin: AgentRunPin; serialized: string } | null {
  const serialized = typeof raw === "string" ? raw : JSON.stringify(raw);
  if (serialized === undefined) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    return null;
  }
  const result = agentRunPinSchema.safeParse(parsed);
  if (!result.success) return null;
  return { pin: result.data, serialized };
}
