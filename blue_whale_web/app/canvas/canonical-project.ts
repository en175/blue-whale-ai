export function canonicalCanvasHref(projectId: string): string {
  return `/canvas?project=${encodeURIComponent(projectId)}`;
}
