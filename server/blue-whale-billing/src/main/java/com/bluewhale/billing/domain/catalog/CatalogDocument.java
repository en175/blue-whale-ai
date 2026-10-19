package com.bluewhale.billing.domain.catalog;

import java.util.List;
import java.util.Map;

public record CatalogDocument(
        int schemaVersion,
        String currency,
        int creditsPerYuan,
        DiscountPolicy discountPolicy
) {

    public static final int SUPPORTED_SCHEMA_VERSION = 1;

    public static final int SUPPORTED_RULE_SCHEMA_VERSION = 1;

    public static final int MIN_CREDITS_PER_YUAN = 1;
    public static final int MAX_CREDITS_PER_YUAN = 100_000;

    public record TaskRule(
            String usageSemantic,
            String baseUnit,
            BasePrice basePrice,
            Map<String, Integer> dims,
            Map<String, Integer> multipliers,
            Map<String, DimPrice> dimPrices,
            Long unitDenominator,
            Long minCredits,
            Long maxCredits,
            String rounding,
            Long quantityOffset,
            Long quantityStep,
            Integer schemaVersion
    ) {}

    public record DimPrice(Long unitMc, Boolean firstFree) {}

    public record BasePrice(
            String kind,
            Long value,
            List<String> by,
            Map<String, Long> table
    ) {}

    public record DiscountPolicy(String stackMode, Integer floorFactorBp) {

        public static final String MULTIPLY = "multiply";
        public static final String BEST = "best";

        public String stackModeOrDefault() {
            return stackMode == null || stackMode.isBlank() ? MULTIPLY : stackMode;
        }

        public int floorFactorBpOrDefault() {
            return floorFactorBp == null ? 3_000 : floorFactorBp;
        }
    }
}
