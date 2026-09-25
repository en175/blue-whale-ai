/** 解析档位原价：只接受正整数，其余 → null。 */
export function parseTierOriginalPrice(raw: unknown): number | null {
  const n = typeof raw === "string" ? Number(raw) : raw;
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

/** 解析折扣比例：只接受 (0, 1] 的有限数字，其余 → null。 */
export function parseTierDiscount(raw: unknown): number | null {
  const n = typeof raw === "string" ? Number(raw) : raw;
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  if (n <= 0 || n > 1) return null;
  return n;
}
