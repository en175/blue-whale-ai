import { ok } from "@blue-whale/contracts";
import type { SkillRepo } from "@blue-whale/persistence";

export interface SkillLibraryQuery {
  keyword?: string;
  pageNum?: number;
  pageSize?: number;
}

export interface SkillMineQuery {
  pageNum?: number;
  pageSize?: number;
}

/** POST /api/agent/skills/library：official skill 分页（keyword 搜 name/description）。
 *  对齐 Java SkillServiceImpl.listLibrary，默认 1/50。 */
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
  return ok(page);
}

/** POST /api/agent/skills/mine：我的 skills 分页（关系 join 快照）。
 *  对齐 Java SkillServiceImpl.listMine，默认 1/50。 */
export async function handleListMine(
  userId: string,
  query: SkillMineQuery,
  deps: { skills: Pick<SkillRepo, "listMine"> },
) {
  const page = await deps.skills.listMine(userId, {
    pageNum: query.pageNum ?? 1,
    pageSize: query.pageSize ?? 50,
  });
  return ok(page);
}
