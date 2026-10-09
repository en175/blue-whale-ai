export const CANVAS_QUERY_KEY = 'project';

export function readCanvasIdFromSearch(searchParams: URLSearchParams): string {
  return searchParams.get(CANVAS_QUERY_KEY)?.trim() ?? '';
}

export function withCanvasId(searchParams: URLSearchParams, canvasId: string): URLSearchParams {
  const next = new URLSearchParams(searchParams);
  const id = canvasId.trim();
  if (id) next.set(CANVAS_QUERY_KEY, id);
  else next.delete(CANVAS_QUERY_KEY);
  return next;
}

export function canvasLocationSearch(searchParams: URLSearchParams, canvasId: string): string {
  const qs = withCanvasId(searchParams, canvasId).toString();
  return qs ? `?${qs}` : '';
}

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

export function shouldReturnToProjectsAfterDelete(currentId: string, deletedId: string): boolean {
  return currentId === deletedId;
}
