export function openCanvasTab(projectId: number | string): boolean {
  return Boolean(window.open(`/canvas?project=${encodeURIComponent(String(projectId))}`, '_blank'));
}
