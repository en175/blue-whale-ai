package com.bluewhale.billing.domain.pricing;

import java.time.Instant;

/**
 * 计价引擎入口（《计费逻辑详细设计》§4.5.3）。
 *
 * <p>调用方只看到一行 {@code compute}；骨架、策略、折扣都在内部。
 *
 * <p><b>规则从哪来</b>由 {@link CatalogLookup} 注入——本类**不关心**规则是来自
 * 内存副本、DB 还是测试夹具。这让引擎可以被纯函数地测试，而不必先起 DB。
 */
public final class PricingEngine {

    /** 规则查询。目录加载器实现它（内存索引 / DB / 测试夹具都行）。 */
    @FunctionalInterface
    public interface CatalogLookup {
        /**
         * @return 该 (model, taskType) 的规则；**没有就返回 null**（引擎会拒绝计价）
         */
        CompiledRule lookup(String modelId, String taskType);
    }

    private final CatalogLookup catalog;
    private final AbstractPricingCalculator calculator;

    public PricingEngine(CatalogLookup catalog, AbstractPricingCalculator calculator) {
        this.catalog = catalog;
        this.calculator = calculator;
    }

    /**
     * 媒介类（图片 / 视频 / 音频 / 按次）的默认装配。
     *
     * <p>⚠️ {@code discounts} **刻意是必填参数，不提供只传 catalog 的重载**：
     * 曾经有过一个 {@code forMedia(catalog)} 的重载，内部默默用
     * {@link DiscountResolver#NONE} 装配——于是任何用它接线的路径都会**静默地不打折**，
     * 用户按原价被扣，且没有任何信号。折扣是这套系统的一部分，不该有一条「忘了它就按原价」的暗道。
     *
     * <p>确实不需要折扣的场景（纯计价单测）显式写 {@code DiscountResolver.NONE}，
     * 让「这里不做折扣」变成写在调用处的一个决定。
     */
    public static PricingEngine forMedia(CatalogLookup catalog, DiscountResolver discounts) {
        return new PricingEngine(catalog, new MediaPricingCalculator(discounts));
    }

    /**
     * 计价。
     *
     * @return 整数积分 + 命中明细
     * @throws RuleNotFoundException 该 (model, taskType) 未配规则——**拒绝，不降级为 0**
     */
    public PricingResult compute(PricingRequest request, Usage usage, Instant submitAt) {
        var outcome = calculator.computeDetailed(context(request, usage, submitAt));
        return resultOf(request, outcome);
    }

    /**
     * **按规则上限**计价 —— 契约量取不到时的兜底（调用方见
     * {@code BillingApplicationService#priceAtCap}）。
     *
     * <p>上限是规则里配的一个常数，**与用量无关**：这里传 {@link Usage#empty()} 而不是
     * 编一个用量出来——编出来的数量会进加权和与倍率，而上限本来就是「不管用量多少都封到这里」。
     *
     * @throws RuleNotFoundException 该 (model, taskType) 未配规则——与 {@link #compute} 同一立场
     * @throws IllegalArgumentException 该规则没配上限（调用方须先判 {@code maxCredits}）
     * @throws BasePriceResolver.UnpriceableSpecException 该规格组合查不到价——
     *         **上限计价不豁免这一条**：结算同样算不出价，漏配必须当场暴露
     */
    public PricingResult computeAtCap(PricingRequest request, Instant submitAt) {
        var outcome = calculator.capDetailed(context(request, Usage.empty(), submitAt));
        return resultOf(request, outcome);
    }

    /** 查规则并装配上下文；**没有规则就抛**（两个入口共用同一处判定）。 */
    private PricingContext context(PricingRequest request, Usage usage, Instant submitAt) {
        CompiledRule rule = catalog.lookup(request.modelId(), request.taskType());
        if (rule == null) {
            // 与 BasePriceResolver 的「查不到规格」同一立场：配置缺失是错误，不是免费。
            // 降级为 0 会让漏配变成白送，且没有任何信号。
            throw new RuleNotFoundException(request.modelId(), request.taskType());
        }
        return new PricingContext(rule, request, usage, submitAt);
    }

    private static PricingResult resultOf(PricingRequest request, AbstractPricingCalculator.Outcome outcome) {
        return new PricingResult(outcome.credits(), outcome.discount(),
                request.modelId(), request.taskType());
    }

    /** 该 (model, taskType) 未配置计价规则——目录漏配，是配置错误。 */
    public static class RuleNotFoundException extends RuntimeException {
        public RuleNotFoundException(String modelId, String taskType) {
            super("未配置计价规则：" + modelId + "/" + taskType);
        }
    }
}
