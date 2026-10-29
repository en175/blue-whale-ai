import type { Prisma, PrismaClient } from "@prisma/client";
import type {
  SkillLibraryLang,
} from "./skill-repo-types.js";

export function normalizeNameKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").normalize("NFC").toLowerCase();
}

export function djb2Hash(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

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

export async function generateCreativeSkillId(
  prisma: PrismaClient,
  name: string,
): Promise<string> {
  const base = slugifyForCreativeSkillId(name);
  for (let suffix = 0; suffix < 100; suffix++) {
    const candidate = suffix === 0 ? base : `${base}_${suffix + 1}`;
    try {
      const rows = await prisma.$queryRawUnsafe<{ c: bigint }[]>(
        `SELECT COUNT(*) AS c FROM catalog_creative_skills WHERE creative_skill_id = ?`,
        candidate,
      );
      if (Number(rows[0]?.c ?? 0) === 0) return candidate;
    } catch {
      return candidate;
    }
  }
  return `${base}_${Date.now().toString(36)}`.slice(0, 79);
}

export async function checkPersonalNameKeyAvailable(
  prisma: PrismaClient,
  userId: string,
  nameKey: string,
): Promise<"ok" | "conflict" | "reserved"> {
  const officialNames = await prisma.catalog_skills.findMany({
    where: { is_delete: 0 },
    select: { name: true },
  });
  const officialNameKeys = new Set(
    officialNames.map((s) => normalizeNameKey(s.name)),
  );
  if (officialNameKeys.has(nameKey)) return "reserved";

  try {
    const conflicts = await prisma.$queryRawUnsafe<{ c: bigint }[]>(
      `SELECT COUNT(*) AS c FROM catalog_creative_skills WHERE owner_user_id = ? AND asset_domain = 'personal' AND name_key = ?`,
      BigInt(userId),
      nameKey,
    );
    if (Number(conflicts[0]?.c ?? 0) > 0) return "conflict";
  } catch {
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
      `SELECT source_skill_id, creative_skill_id FROM catalog_creative_skills WHERE source_skill_id IN (${placeholders})`,
      ...skillIds,
    );
    return new Map(
      rows.map((r) => [r.source_skill_id.toString(), r.creative_skill_id]),
    );
  } catch {
    return new Map();
  }
}

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

export function nonEmpty(value: string | null): string | null {
  return value !== null && value !== "" ? value : null;
}

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

export function splitSearchTerms(keyword: string): string[] {
  return keyword.trim().split(/\s+/).filter((t) => t.length > 0);
}

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

export async function resolveOfficialSourceSkillId(
  prisma: PrismaClient,
  creativeSkillId: string,
): Promise<string | null> {
  let rows: { source_skill_id: bigint }[];
  try {
    rows = await prisma.$queryRawUnsafe<{ source_skill_id: bigint }[]>(
      `SELECT source_skill_id FROM catalog_creative_skills WHERE creative_skill_id = ? AND asset_domain = 'official'`,
      creativeSkillId,
    );
  } catch {
    return null;
  }
  const sourceSkillId = rows[0]?.source_skill_id;
  if (sourceSkillId == null) return null;
  const c = await prisma.catalog_skills.count({
    where: { id: sourceSkillId, is_delete: 0 },
  });
  return c > 0 ? sourceSkillId.toString() : null;
}



