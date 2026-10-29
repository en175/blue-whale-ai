export const PROJECT_LIST_LIMIT_MAX = 20;
export const PROJECT_LIST_KEYWORD_MAX = 64;

export type ProjectSource = "dialog" | "canvas";

export type ProjectListQuery =
  | { kind: "all"; keyword?: string; source?: ProjectSource }
  | {
      kind: "page";
      page: number;
      size: number;
      keyword?: string;
      source?: ProjectSource;
    }
  | { kind: "limit"; limit: number; keyword?: string; source?: ProjectSource }
  | { kind: "invalid"; reason: string };

export function resolveProjectListQuery(
  query: Record<string, string>,
): ProjectListQuery {
  const keyword = (query.keyword ?? "").trim();
  if (keyword.length > PROJECT_LIST_KEYWORD_MAX) {
    return { kind: "invalid", reason: `keyword 长度不得超过 ${PROJECT_LIST_KEYWORD_MAX}` };
  }
  const keywordOption = keyword ? { keyword } : {};
  const rawSource = (query.source ?? "").trim();
  if (rawSource && rawSource !== "dialog" && rawSource !== "canvas") {
    return { kind: "invalid", reason: "source 仅支持 dialog/canvas" };
  }
  const sourceOption = rawSource
    ? { source: rawSource as ProjectSource }
    : {};
  const hasPage = Object.hasOwn(query, "page");
  const hasSize = Object.hasOwn(query, "size");
  const hasLimit = Object.hasOwn(query, "limit");
  if (hasLimit && (hasPage || hasSize)) {
    return { kind: "invalid", reason: "limit 不能与 page/size 同时使用" };
  }
  if (hasPage !== hasSize) {
    return { kind: "invalid", reason: "page 与 size 必须成对出现" };
  }
  if (hasLimit) {
    const limit = Number(query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > PROJECT_LIST_LIMIT_MAX) {
      return { kind: "invalid", reason: `limit 必须在 1-${PROJECT_LIST_LIMIT_MAX} 之间` };
    }
    return { kind: "limit", limit, ...keywordOption, ...sourceOption };
  }
  if (!hasPage) return { kind: "all", ...keywordOption, ...sourceOption };
  return {
    kind: "page",
    page: Math.max(1, Number(query.page) || 1),
    size: Math.max(1, Number(query.size) || 1),
    ...keywordOption,
    ...sourceOption,
  };
}
