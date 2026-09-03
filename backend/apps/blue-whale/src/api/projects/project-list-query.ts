/** GET /api/projects：无参全量；page+size 成对分页；缺一非法。非法数字软夹到 ≥1。 */
export function resolveProjectListQuery(
  query: Record<string, string>,
):
  | { kind: "all" }
  | { kind: "page"; page: number; size: number }
  | { kind: "invalid" } {
  const hasPage = Object.hasOwn(query, "page");
  const hasSize = Object.hasOwn(query, "size");
  if (hasPage !== hasSize) return { kind: "invalid" };
  if (!hasPage) return { kind: "all" };
  return {
    kind: "page",
    page: Math.max(1, Number(query.page) || 1),
    size: Math.max(1, Number(query.size) || 1),
  };
}
