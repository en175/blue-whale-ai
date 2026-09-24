package com.bluewhale.billing.pricing;

import java.util.List;

/**
 * 折扣解析（《计费逻辑详细设计》§4.6.3）。
 *
 * <p>实现侧用模板方法基类 {@code AbstractDiscountProvider}（拉候选 → 过滤 → 取最优），
 * 本接口只描述「对计价管线而言折扣是什么」。
 *
 * <p>把这个接口与实现在此分开，是为了让**计价引擎不依赖折扣的存储形态**——
 * 会员折扣与营销折扣从两张表来，未来还会有优惠券、企业协议价，
 * 引擎不该知道这些。
 */
@FunctionalInterface
public interface DiscountResolver {

    /** 不打折。用于未装配折扣能力的场景（如纯计算测试）。 */
    DiscountResolver NONE = ctx -> Discount.none();

    /**
     * 解析本次计价命中的折扣。
     *
     * @return 最终系数与命中明细。**永不返回 null**——无命中返回 {@link Discount#none()}
     */
    Discount resolve(PricingContext ctx);

    /**
     * 计价管线用的便捷入口：在 {@code mc} 上应用折扣。
     *
     * <p>⚠️ 只做乘法，不在此处取整——**舍入是管线的最后一步、且只做一次**（§1.1）。
     */
    default long apply(PricingContext ctx, long mc) {
        return mc * resolve(ctx).factorBp() / 10_000L;
    }

    /**
     * 一次计价命中的折扣。
     *
     * @param factorBp 最终系数（万分比，10000 = 原价）。**已含底线与叠加策略**
     * @param applied  命中明细，写进定价快照供「为什么这个价」的追溯
     */
    record Discount(int factorBp, List<AppliedDiscount> applied) {

        public Discount {
            applied = applied == null ? List.of() : List.copyOf(applied);
        }

        private static final Discount NONE = new Discount(10_000, List.of());

        /** 无匹配 = 原价。**宁可不打折，不可误打折。** */
        public static Discount none() {
            return NONE;
        }

        public boolean isDiscounted() {
            return factorBp < 10_000;
        }
    }

    /**
     * 命中明细。
     *
     * @param source 来源：{@code member} / {@code promotion}（将来：{@code coupon} …）
     * @param id     规则 id
     * @param code   规则业务码（营销活动用；会员折扣为 null）
     * @param factorBp 该规则自身的系数
     */
    record AppliedDiscount(String source, long id, String code, int factorBp) {

        public static AppliedDiscount member(long id, int factorBp) {
            return new AppliedDiscount("member", id, null, factorBp);
        }

        public static AppliedDiscount promotion(long id, String code, int factorBp) {
            return new AppliedDiscount("promotion", id, code, factorBp);
        }
    }
}
