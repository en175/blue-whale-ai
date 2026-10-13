export function patchCanvasNodeActions<A>(current: A, patch: Partial<A>): A {
  return { ...current, ...patch };
}
