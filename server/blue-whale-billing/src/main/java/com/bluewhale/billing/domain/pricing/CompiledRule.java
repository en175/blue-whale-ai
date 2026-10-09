package com.bluewhale.billing.domain.pricing;

import java.util.Map;

public record CompiledRule(
        UsageDim baseUnit,
        BasePriceResolver basePrice,
        Map<UsageDim, Integer> dims,
        Map<UsageDim, Integer> multipliers,
        Map<UsageDim, DimPrice> dimPrices,
        long unitDenominator,
        long minCredits,
        Long maxCredits,
        RoundingPolicy rounding,
        TokenEstimator tokenEstimator
) {

    public record DimPrice(long unitMc, boolean firstFree) {}

    public CompiledRule {
        if (baseUnit == null) {
            throw new IllegalArgumentException("baseUnit 必填");
        }
        if (basePrice == null) {
            throw new IllegalArgumentException("basePrice 必填");
        }
        if (unitDenominator <= 0) {
            throw new IllegalArgumentException("unitDenominator 必须为正：" + unitDenominator);
        }
        if (minCredits < 0) {
            throw new IllegalArgumentException("minCredits 不能为负：" + minCredits);
        }
        if (maxCredits != null && maxCredits < minCredits) {
            throw new IllegalArgumentException("maxCredits(" + maxCredits + ") 不能小于 minCredits(" + minCredits + ")");
        }
        if (rounding == null) {
            throw new IllegalArgumentException("rounding 必填");
        }
        dims = dims == null ? Map.of() : Map.copyOf(dims);
        multipliers = multipliers == null ? Map.of() : Map.copyOf(multipliers);
        dimPrices = dimPrices == null ? Map.of() : Map.copyOf(dimPrices);
        for (var e : dimPrices.entrySet()) {
            if (e.getValue() == null || e.getValue().unitMc() <= 0) {
                throw new IllegalArgumentException(
                        "dimPrices 的单价必须为正：" + e.getKey().key() + " → " + e.getValue());
            }
        }
        requireNonNegativeBasePrice(basePrice);
        for (var e : dims.entrySet()) {
            if (e.getValue() < 0) {
                throw new IllegalArgumentException(
                        "dims 的倍率不能为负：" + e.getKey().key() + " → " + e.getValue()
                                + "（负倍率把等效数量拉低，等于少收）");
            }
        }
        for (var e : multipliers.entrySet()) {
            if (e.getValue() <= 0) {
                throw new IllegalArgumentException(
                        "multipliers 的倍率必须为正：" + e.getKey().key() + " → " + e.getValue()
                                + "（0 会让整单免费；「这一维不参与」应当是不写它）");
            }
        }
        if (maxCredits != null && !dimPrices.isEmpty()) {
            throw new IllegalArgumentException(
                    "maxCredits 与 dimPrices 不能同时配：上限冻结算不到维度绝对加价，"
                            + "结算会超出预扣并记应收（少收且静默）");
        }
    }

    private static void requireNonNegativeBasePrice(BasePriceResolver basePrice) {
        switch (basePrice) {
            case BasePriceResolver.Constant c -> {
                if (c.mc() < 0) {
                    throw new IllegalArgumentException(
                            "basePrice 常数单价不能为负：" + c.mc()
                                    + "（负单价算出的金额经下限兜底后变成 0，整单免费且账面无信号；"
                                    + "要表达「免费」请直接写 0，并用 minCredits 定下限）");
                }
            }
            case BasePriceResolver.Table t -> {
                for (var e : t.table().entrySet()) {
                    if (e.getValue() == null || e.getValue() < 0) {
                        throw new IllegalArgumentException(
                                "basePrice 查表单价不能为负：" + e.getKey() + " → " + e.getValue());
                    }
                }
            }
            case BasePriceResolver.Unset ignored -> {
            }
        }
    }

    public static CompiledRule of(UsageDim baseUnit, BasePriceResolver basePrice, long unitDenominator) {
        return new CompiledRule(baseUnit, basePrice, Map.of(), Map.of(), Map.of(), unitDenominator,
                1L, null, new RoundingPolicy.HalfUp(), null);
    }

    public CompiledRule withTokenEstimator(TokenEstimator estimator) {
        return new CompiledRule(baseUnit, basePrice, dims, multipliers, dimPrices, unitDenominator,
                minCredits, maxCredits, rounding, estimator);
    }

    public CompiledRule withMultiplier(UsageDim dim, int permille) {
        var next = new java.util.LinkedHashMap<>(multipliers);
        next.put(dim, permille);
        return new CompiledRule(baseUnit, basePrice, dims, next, dimPrices, unitDenominator,
                minCredits, maxCredits, rounding, tokenEstimator);
    }

    public CompiledRule withDimPrice(UsageDim dim, long unitMc, boolean firstFree) {
        var next = new java.util.LinkedHashMap<>(dimPrices);
        next.put(dim, new DimPrice(unitMc, firstFree));
        return new CompiledRule(baseUnit, basePrice, dims, multipliers, next, unitDenominator,
                minCredits, maxCredits, rounding, tokenEstimator);
    }

    public CompiledRule withMaxCredits(long max) {
        return new CompiledRule(baseUnit, basePrice, dims, multipliers, dimPrices, unitDenominator,
                minCredits, max, rounding, tokenEstimator);
    }
}
