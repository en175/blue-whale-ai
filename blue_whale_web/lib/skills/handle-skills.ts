import { ok } from "@blue-whale/contracts";
import type {
  SkillLibraryView,
  SkillMineView,
  SkillRepo,
} from "@blue-whale/persistence";

export interface SkillLibraryQuery {
  keyword?: string;
  pageNum?: number;
  pageSize?: number;
}

export interface SkillMineQuery {
  pageNum?: number;
  pageSize?: number;
}

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

/** POST /api/agent/skills/library：official skill 分页（keyword 搜 name/description）。
 *  默认 1/50；响应按契约 §3 白名单 pick。 */
export async function handleListLibrary(
  userId: string,
  query: SkillLibraryQuery,
  deps: { skills: Pick<SkillRepo, "listLibrary"> },
) {
  const page = await deps.skills.listLibrary(userId, {
    keyword: query.keyword,
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
