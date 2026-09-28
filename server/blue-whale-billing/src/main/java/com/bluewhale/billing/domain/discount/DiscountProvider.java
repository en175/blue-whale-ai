package com.bluewhale.billing.domain.discount;

import com.bluewhale.billing.domain.pricing.DiscountResolver;
import com.bluewhale.billing.domain.pricing.PricingContext;

import java.util.List;
import java.util.Optional;

/**
 * 折扣来源（《计费逻辑详细设计》§4.6.3）。
 *
 * <p>一个来源 = 一张表 / 一类规则。**来源之间互不感知**——新增「优惠券」「企业协议价」
 * 只需加一个实现，叠加策略由 {@link com.bluewhale.billing.application.CompositeDiscountResolver} 统一裁决。
 */
public interface DiscountProvider {

    /**
     * 解析本来源在本次计价中命中的折扣。
     *
     * @return 无命中返回 {@link Optional#empty()}；**不返回 null**
     */
    Optional<DiscountResolver.AppliedDiscount> resolve(PricingContext ctx);

    /** 来源标识，写进定价快照的 appliedDiscounts。 */
    String source();

    /**
     * 候选的**最小公共形状**。各来源可以带自己的额外字段（营销活动的时段、
     * 会员的等级），只要实现本接口——基类只关心公共部分。
     */
    interface Candidate {
        long id();

        /** 业务码（营销活动用；会员折扣为 null）。 */
        String code();

        /** 折扣，万分比（9000 = 9 折）。 */
        int discountBp();

        /**
         * 模型匹配模式**集合**。
         *
         * <p>是集合而不是单值：营销活动天然是「对这几个模型打折」
         * （{@code ["seedance-*", "seedream-4.0"]}），单个 pattern 表达不了。
         *
         * <p>null / 空集合 = 不限（与「配了但都不匹配」不同，见 {@link Patterns#isRestricted}）。
         */
        List<String> modelPatterns();

        List<String> taskPatterns();

        boolean enabled();
    }

    /**
     * 折扣提供者骨架：**拉候选 → 过滤 → 取最优**（模板方法）。
     *
     * <p>泛型 {@code C} 是各来源自己的候选类型——基类只碰 {@link Candidate} 的公共部分，
     * 子类在 {@link #matchesScope} 里访问自己的额外字段。
     *
     * <p><b>取最优而不叠加</b>：同一来源内命中多条时取折扣最大的那条。
     * 叠加会出离谱折扣（三个 7 折 = 34 折），且用户算不清自己享受了什么。
     */
    abstract class Abstract<C extends Candidate> implements DiscountProvider {

        /**
         * 模板方法：**final**，子类不改过滤链的形状。
         */
        @Override
        public final Optional<DiscountResolver.AppliedDiscount> resolve(PricingContext ctx) {
            return loadCandidates(ctx).stream()
                    .filter(Candidate::enabled)
                    .filter(c -> Patterns.matchesAny(c.modelPatterns(), ctx.request().modelId()))
                    .filter(c -> Patterns.matchesAny(c.taskPatterns(), ctx.request().taskType()))
                    .filter(c -> matchesScope(c, ctx))
                    // 万分比越小折扣越大 —— 取最小即取最优
                    .min(java.util.Comparator.comparingInt(Candidate::discountBp))
                    .map(c -> new DiscountResolver.AppliedDiscount(
                            source(), c.id(), c.code(), c.discountBp()));
        }

        /** 从存储拉候选。子类实现（查表 / 查缓存 / 测试夹具）。 */
        protected abstract List<C> loadCandidates(PricingContext ctx);

        /**
         * 额外的适用范围过滤。默认不限。
         *
         * <p>子类在此访问自己的额外字段（营销活动的时段与等级范围）。
         */
        protected boolean matchesScope(C candidate, PricingContext ctx) {
            return true;
        }
    }
}
