/** 对齐 Go new-api QuotaPerUnit：到账积分 = N × QuotaPerUnit（N = 档位原价美元额度）。 */
export const QUOTA_PER_UNIT = 500_000;

/** 档位到账积分：N × QuotaPerUnit（与 Go 到账公式一致）。 */
export function deriveTierAmount(originalPrice: number): number {
  return Math.round(originalPrice) * QUOTA_PER_UNIT;
}

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
