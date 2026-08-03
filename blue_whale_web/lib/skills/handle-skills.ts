import { fail, ok } from "@blue-whale/contracts";
import type {
  SkillLibraryCategory,
  SkillLibraryLang,
  SkillLibrarySort,
  SkillLibraryView,
  SkillMineView,
  SkillRepo,
} from "@blue-whale/persistence";

export interface SkillLibraryQuery {
  keyword?: string;
  category?: SkillLibraryCategory;
  sort?: SkillLibrarySort;
  lang?: SkillLibraryLang;
  pageNum?: number;
  pageSize?: number;
}

export interface SkillMineQuery {
  pageNum?: number;
  pageSize?: number;
}

// 契约 §11.5 枚举：非法值按参数错误拒绝（不复用 100100）。
const LIBRARY_CATEGORIES = new Set(["all", "film", "marketing", "other"]);
const LIBRARY_SORTS = new Set(["featured", "most_used", "newest"]);
const LIBRARY_LANGS = new Set(["zh", "en"]);

/** 契约 §3 白名单：响应只透这些字段，content/body/prompt/自增 id 永不出库
 *  （防御纵深：即使 repo 多带字段也不透传）。 */
function pickLibraryView(s: SkillLibraryView): SkillLibraryView {
  return {
    creative_skill_id: s.creative_skill_id,
    name: s.name,
    description: s.description,
    cover_url: s.cover_url,
    source: s.source,
    asset_domain: s.asset_domain,
    added: s.added,
    category: s.category,
    usage_count: s.usage_count,
  };
}

function pickMineView(s: SkillMineView): SkillMineView {
  return {
    creative_skill_id: s.creative_skill_id,
    auto: s.auto,
    name: s.name,
    description: s.description,
    cover_url: s.cover_url,
    source: s.source,
    asset_domain: s.asset_domain,
  };
}

/** POST /api/agent/skills/library：official skill 分页（契约 §11：category 过滤、
 *  featured/most_used/newest 排序、zh/en 语言解析、keyword 搜解析语言 name/description
 *  与 search_keywords）。默认 1/50；非法枚举按参数错误拒绝；响应按 §3 白名单 pick。 */
export async function handleListLibrary(
  userId: string,
  query: SkillLibraryQuery,
  deps: { skills: Pick<SkillRepo, "listLibrary"> },
) {
  if (query.category !== undefined && !LIBRARY_CATEGORIES.has(query.category)) {
    return fail(400, "category 参数非法");
  }
  if (query.sort !== undefined && !LIBRARY_SORTS.has(query.sort)) {
    return fail(400, "sort 参数非法");
  }
  if (query.lang !== undefined && !LIBRARY_LANGS.has(query.lang)) {
    return fail(400, "lang 参数非法");
  }
  const page = await deps.skills.listLibrary(userId, {
    keyword: query.keyword,
    category: query.category,
    sort: query.sort,
    lang: query.lang,
    pageNum: query.pageNum ?? 1,
    pageSize: query.pageSize ?? 50,
  });
  return ok({
    records: page.records.map(pickLibraryView),
    total: page.total,
    size: page.size,
    current: page.current,
  });
}

/** POST /api/agent/skills/mine：官方引用 ∪ 名下个人技能分页（契约 §6 并集）。
 *  默认 1/50；响应按契约 §3 白名单 pick。 */
export async function handleListMine(
  userId: string,
  query: SkillMineQuery,
  deps: { skills: Pick<SkillRepo, "listMine"> },
) {
  const page = await deps.skills.listMine(userId, {
    pageNum: query.pageNum ?? 1,
    pageSize: query.pageSize ?? 50,
  });
  return ok({
    records: page.records.map(pickMineView),
    total: page.total,
    size: page.size,
    current: page.current,
  });
}
