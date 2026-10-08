package com.bluewhale.billing.domain.pricing;

import java.time.Instant;

public final class PricingEngine {

    @FunctionalInterface
    public interface CatalogLookup {
        CompiledRule lookup(String modelId, String taskType);
    }

    private final CatalogLookup catalog;
    private final AbstractPricingCalculator calculator;

    public PricingEngine(CatalogLookup catalog, AbstractPricingCalculator calculator) {
        this.catalog = catalog;
        this.calculator = calculator;
    }

    public static PricingEngine forMedia(CatalogLookup catalog, DiscountResolver discounts) {
        return new PricingEngine(catalog, new MediaPricingCalculator(discounts));
    }

    public PricingResult compute(PricingRequest request, Usage usage, Instant submitAt) {
        var outcome = calculator.computeDetailed(context(request, usage, submitAt));
        return resultOf(request, outcome);
    }

    public PricingResult computeAtCap(PricingRequest request, Instant submitAt) {
        var outcome = calculator.capDetailed(context(request, Usage.empty(), submitAt));
        return resultOf(request, outcome);
    }

    private PricingContext context(PricingRequest request, Usage usage, Instant submitAt) {
        CompiledRule rule = catalog.lookup(request.modelId(), request.taskType());
        if (rule == null) {
            throw new RuleNotFoundException(request.modelId(), request.taskType());
        }
        return new PricingContext(rule, request, usage, submitAt);
    }

    private static PricingResult resultOf(PricingRequest request, AbstractPricingCalculator.Outcome outcome) {
        return new PricingResult(outcome.credits(), outcome.discount(),
                request.modelId(), request.taskType());
    }

    public static class RuleNotFoundException extends RuntimeException {
        public RuleNotFoundException(String modelId, String taskType) {
            super("未配置计价规则：" + modelId + "/" + taskType);
        }
    }
}
