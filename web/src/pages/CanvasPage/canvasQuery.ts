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

/** Keep a query id that is still in the list; otherwise fall back to the first canvas. */
export function pickCanvasIdAfterLoad(queryId: string, projectIds: readonly string[]): string {
  if (queryId && projectIds.includes(queryId)) return queryId;
  return projectIds[0] ?? '';
}

/**
 * After deleting a canvas: keep the current id if it remains; otherwise the latest
 * remaining item (list head; GET /api/projects is created_at desc). Empty when none remain.
 */
export function pickCanvasIdAfterDelete(
  currentId: string,
  deletedId: string,
  projectIds: readonly string[],
): string {
  return pickCanvasIdAfterLoad(
    currentId,
    projectIds.filter((id) => id !== deletedId),
  );
}
