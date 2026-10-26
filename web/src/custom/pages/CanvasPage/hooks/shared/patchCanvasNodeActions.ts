export function syncCanvasNodeActions<A extends object>(target: A, patch: Partial<A>): void {
  Object.assign(target, patch);
}
