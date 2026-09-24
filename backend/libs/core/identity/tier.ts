/**
 * 会员等级（tier）—— **billing 侧折扣的唯一输入，也是它的权威定义处**。
 *
 * <h2>为什么这个文件值得单独存在</h2>
 *
 * `tier` 出现在两个地方：这里（identity，权威）与 billing 的 Hold 请求（消费方）。
 * 两边必须对「有哪些等级、认不出的值怎么办」有完全一致的理解，否则会出现
 * 「identity 认得的等级，billing 当成 free」——用户花钱升了级，折扣却没生效，
 * 而两边各自的日志都是正常的。
 *
 * <h2>两个刻意的决定</h2>
 *
 * ① **认不出的等级按 free 处理，并且必须被看见。**
 *    库里的值写错（`PRO` 大写、`vip` 旧名）时，静默降级成 free 会让用户白丢权益、
 *    且没有任何信号。所以 {@link resolveTier} 把认不出的原始值一并返回，
 *    由调用方记日志/告警——函数本身保持纯粹，不产生副作用。
 *
 * ② **多个有效周期并存时取「最高等级」，不是「最晚到期」。**
 *    用户同时有「明天到期的 max」和「一年后到期的 pro」时，直觉答案是前者：
 *    他现在就是 max，明天才降。取最晚到期会让他今天就被降级，
 *    而他明明还持有 max。
 */

export type Tier = "free" | "basic" | "pro" | "max";

/** 全部合法等级字面值。与 billing 侧 `billing_member_discounts.tier` 用同一套。 */
export const TIERS: readonly Tier[] = ["free", "basic", "pro", "max"];

/**
 * 等级强弱。**只用于「多个周期取哪个」的比较**，不是权限模型——
 * 权限走 identity_roles，不要把它当 role 用。
 */
const RANK: Record<Tier, number> = { free: 0, basic: 1, pro: 2, max: 3 };

/**
 * 解析等级字面值。
 *
 * @returns 认不出时返回 null ——**不返回 "free"**。把「没有会员」与「值写错了」
 *          压成同一个返回值，调用方就再也分不清该不该告警了。
 */
export function parseTier(raw: string): Tier | null {
  return (TIERS as readonly string[]).includes(raw) ? (raw as Tier) : null;
}

/** 一个会员周期。字段名与 `identity_memberships` 对齐（snake_case 已在 repo 层转换）。 */
export interface MembershipPeriod {
  tier: string;
  /** active | expired | cancelled */
  status: string;
  /** null = 永久 */
  expiresAt: Date | null;
}

export interface TierResolution {
  /** 当前生效等级；无有效周期时是 free */
  tier: Tier;
  /**
   * 有效周期里那些**认不出**的原始等级值（去重）。
   *
   * 调用方应当把它记进日志/指标：非空意味着有人在往库里写非法等级，
   * 而受影响的用户此刻正被当成 free。
   */
  unknownTiers: string[];
}

/**
 * 从会员周期推导当前等级。
 *
 * <p>⚠️ 这里会**再过滤一次**有效性，即使调用方（repo）已经在 SQL 里粗筛过。
 * 这不是冗余：SQL 侧的条件是为了走索引，是性能手段；本函数才是「什么算有效」的
 * 权威定义，且它能被纯函数地测试。两处条件一旦漂移，以本函数为准。
 *
 * @param now 判定时刻。**由调用方传入**而不是内部取 `new Date()`——
 *            同一请求里「现在」必须是同一个值，且测试需要固定时间。
 */
export function resolveTier(periods: readonly MembershipPeriod[], now: Date): TierResolution {
  const nowMs = now.getTime();

  const valid = periods.filter(
    (p) =>
      p.status === "active" &&
      // 边界与 SQL 的 `expires_at > NOW()` 一致：**恰好等于**视为已过期
      (p.expiresAt === null || p.expiresAt.getTime() > nowMs),
  );

  const unknownTiers: string[] = [];
  let best: Tier = "free";

  for (const period of valid) {
    const tier = parseTier(period.tier);
    if (tier === null) {
      if (!unknownTiers.includes(period.tier)) unknownTiers.push(period.tier);
      continue;
    }
    if (RANK[tier] > RANK[best]) best = tier;
  }

  return { tier: best, unknownTiers };
}
