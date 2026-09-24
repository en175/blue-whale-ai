package com.bluewhale.billing.pricing;

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

    /** 媒介类（图片 / 视频 / 音频 / 按次）的默认装配。 */
    public static PricingEngine forMedia(CatalogLookup catalog) {
        return new PricingEngine(catalog, new MediaPricingCalculator());
    }

    /**
     * 计价。
     *
     * @return 整数积分 + 命中明细
     * @throws RuleNotFoundException 该 (model, taskType) 未配规则——**拒绝，不降级为 0**
     */
    public PricingResult compute(PricingRequest request, Usage usage, Instant submitAt) {
        CompiledRule rule = catalog.lookup(request.modelId(), request.taskType());
        if (rule == null) {
            // 与 BasePriceResolver 的「查不到规格」同一立场：配置缺失是错误，不是免费。
            // 降级为 0 会让漏配变成白送，且没有任何信号。
            throw new RuleNotFoundException(request.modelId(), request.taskType());
        }
        var ctx = new PricingContext(rule, request, usage, submitAt);
        var outcome = calculator.computeDetailed(ctx);
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
