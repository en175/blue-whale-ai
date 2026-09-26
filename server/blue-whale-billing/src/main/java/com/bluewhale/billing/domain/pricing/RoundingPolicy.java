package com.bluewhale.billing.domain.pricing;

/**
 * 舍入策略（《计费逻辑详细设计》§1.1 / §4.6.4）。
 *
 * <p><b>出口只舍入一次</b>，且在**写账本之前**。这是「用户看到的 = 实际扣的」这条
 * 硬规则的实现保证——展示层不得再做第二次舍入。
 *
 * <p>默认 {@link HalfUp}（四舍五入），不是向上取整：
 * ceil 永远偏向平台，且让折扣更难生效（让利要 ≥ 1 积分才看得出；
 * 四舍五入只要 &gt; 0.5 积分）。见 §1.2 的对照表。
 */
public sealed interface RoundingPolicy permits RoundingPolicy.HalfUp, RoundingPolicy.Ceil, RoundingPolicy.Floor {

    /**
     * @param mc 微积分金额（1 积分 = 1000 mc）
     * @param minCredits 下限（整数积分），结果不低于它
     * @return 整数积分
     */
    long round(long mc, long minCredits);

    /** ★ 默认：四舍五入（HALF_UP）。{@code mc + 500} 后整数除法截断；金额恒正，无负数边界。 */
    record HalfUp() implements RoundingPolicy {
        @Override
        public long round(long mc, long minCredits) {
            return Math.max(minCredits, (mc + 500L) / 1000L);
        }
    }

    /** 备选：向上取整。偏平台，且让折扣更难生效（§1.2）。 */
    record Ceil() implements RoundingPolicy {
        @Override
        public long round(long mc, long minCredits) {
            return Math.max(minCredits, Math.floorDiv(mc + 999L, 1000L));
        }
    }

    /** 备选：向下取整。偏用户。 */
    record Floor() implements RoundingPolicy {
        @Override
        public long round(long mc, long minCredits) {
            return Math.max(minCredits, Math.floorDiv(mc, 1000L));
        }
    }

    /**
     * 折扣生效性校验必须复用**同一个**舍入函数，否则会出现
     * 「校验说生效、线上算出来没生效」这种最难查的偏差（§4.5.6）。
     */
    static long roundHalfUpMc(long mc) {
        return (mc + 500L) / 1000L;
    }
}
