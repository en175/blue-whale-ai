/**
 * 充值档位定价耦合常量与派生（服务端 + 前端共用，单一出处）。
 *
 * QUOTA_PER_UNIT 对齐 Go new-api 的 QuotaPerUnit（测试环境实测 500000）：
 * 到账积分 = N × QuotaPerUnit，N = 档位原价（美元额度，正整数）。
 * ⚠️ Go 侧调整 QuotaPerUnit 必须同步修改此常量，否则档位表单展示的到账积分
 * 将与实际到账不符。见 docs/research/IK51OP-go-recharge-amount-discount-coordination.md
 * 「耦合常量提醒」。
 */
export const QUOTA_PER_UNIT = 500_000;

/** 档位到账积分：N × QuotaPerUnit（与 Go 到账公式 N × QuotaPerUnit 一致）。 */
export function deriveTierAmount(originalPrice: number): number {
  return Math.round(originalPrice) * QUOTA_PER_UNIT;
}

/**
 * 解析档位原价：只接受正整数，其余（小数 / 非正数 / 非数字 / NaN）→ null。
 * 依据：N 是 Go int64 美元额度；amount_discount 按整数 N 做 key；
 * 非整数原价会造成 UI 积分、折扣 key 与实际计费三口径错位。
 */
export function parseTierOriginalPrice(raw: unknown): number | null {
  const n = typeof raw === "string" ? Number(raw) : raw;
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

/** 解析折扣比例：只接受 (0, 1] 的有限数字（实付倍率，直填 Go），其余 → null。 */
export function parseTierDiscount(raw: unknown): number | null {
  const n = typeof raw === "string" ? Number(raw) : raw;
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  if (n <= 0 || n > 1) return null;
  return n;
}
