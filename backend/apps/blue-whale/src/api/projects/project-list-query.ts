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
