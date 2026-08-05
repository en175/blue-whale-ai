/**
 * 管理端查询参数解析（IK6JXI 契约 4.x：page 默认 1；pageSize 默认 20、上限 100）。
 */

export function parsePageParam(raw: string | null): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

export function parsePageSizeParam(raw: string | null): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? Math.min(n, 100) : 20;
}
