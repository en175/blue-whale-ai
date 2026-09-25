/** 管理端列表的分页参数解析（查询串形态，非法 / 缺省一律回落到第 1 页 / 20 条）。 */

export function parsePageParam(raw: string | null | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

export function parsePageSizeParam(raw: string | null | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? Math.min(n, 100) : 20;
}
