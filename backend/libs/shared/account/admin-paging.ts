
export function parsePageParam(raw: string | null | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

export function parsePageSizeParam(raw: string | null | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? Math.min(n, 100) : 20;
}
