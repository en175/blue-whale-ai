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

/** 档位没显式起名时，服务端生成的默认名形态：`<数字>积分`。 */
const AUTO_NAME_RE = /^\d+积分$/;

/**
 * 读档位时的展示名归一。
 *
 * <p>没起名的档位，服务端在**创建那一刻**把名字烘成 `${当时的到账积分}积分`。
 * 而到账积分现在是从定价目录派生的（`原价 × creditsPerYuan`）——**换算口径一改，
 * 老档位的名字就与它旁边那个数字对不上了**：列表里显示「5000000积分」、到账却是 150。
 * 用户和管理员都会当成扣错了。
 *
 * <p>所以读取时：**只对「看起来是自动生成的」名字重新派生**，人工起过的名字一律不动——
 * 名字是运营的表达，「春季特惠」不该被我们改写。
 */
export function displayTierName(storedName: string, derivedAmount: number): string {
  return AUTO_NAME_RE.test(storedName.trim()) ? `${derivedAmount}积分` : storedName;
}
