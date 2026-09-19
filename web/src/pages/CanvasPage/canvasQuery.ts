/** Query key for the current canvas. Product copy says 画布; the API entity is project. */
export const CANVAS_QUERY_KEY = 'project';

/** Read the canvas id from URL search params. Empty string when absent. */
export function readCanvasIdFromSearch(searchParams: URLSearchParams): string {
  return searchParams.get(CANVAS_QUERY_KEY)?.trim() ?? '';
}

/** Return a copy of search params with the canvas id set or removed. */
export function withCanvasId(searchParams: URLSearchParams, canvasId: string): URLSearchParams {
  const next = new URLSearchParams(searchParams);
  const id = canvasId.trim();
  if (id) next.set(CANVAS_QUERY_KEY, id);
  else next.delete(CANVAS_QUERY_KEY);
  return next;
}

/** Location.search for a canvas id, preserving other query keys. Empty when nothing remains. */
export function canvasLocationSearch(searchParams: URLSearchParams, canvasId: string): string {
  const qs = withCanvasId(searchParams, canvasId).toString();
  return qs ? `?${qs}` : '';
}

/** 恢复落点候选：查询参数 > 上次打开 > 最新创建 > 首项（置顶排序后首项可能是置顶组头，第三级按 created_at 取）。 */
export function pickCanvasIdAfterLoad(
  queryId: string,
  projectIds: readonly string[],
  lastOpenedId?: string,
  latestCreatedId?: string,
): string {
  if (queryId && projectIds.includes(queryId)) return queryId;
  if (lastOpenedId && projectIds.includes(lastOpenedId)) return lastOpenedId;
  if (latestCreatedId && projectIds.includes(latestCreatedId)) return latestCreatedId;
  return projectIds[0] ?? '';
}

/** 从项目列表挑出 last_opened_at 最新的一项 id；全空或空列表返回空串（ISO 字典序即时间序）。 */
export function findLastOpenedProjectId(
  projects: readonly { id: string | number; last_opened_at: string | null }[],
): string {
  let best: { id: string | number; last_opened_at: string } | null = null;
  for (const p of projects) {
    if (!p.last_opened_at) continue;
    if (!best || p.last_opened_at > best.last_opened_at) {
      best = { id: p.id, last_opened_at: p.last_opened_at };
    }
  }
  return best ? String(best.id) : '';
}

/** 从项目列表挑出 created_at 最新的一项 id（三级兜底第三级「最新创建」，与置顶排序无关）；空列表返回空串。 */
export function findLatestCreatedProjectId(
  projects: readonly { id: string | number; created_at: string | null }[],
): string {
  let best: { id: string | number; created_at: string } | null = null;
  for (const p of projects) {
    if (!p.created_at) continue;
    if (!best || p.created_at > best.created_at) {
      best = { id: p.id, created_at: p.created_at };
    }
  }
  return best ? String(best.id) : '';
}

/** Deleting the current canvas returns the user to the project list. */
export function shouldReturnToProjectsAfterDelete(currentId: string, deletedId: string): boolean {
  return currentId === deletedId;
}
