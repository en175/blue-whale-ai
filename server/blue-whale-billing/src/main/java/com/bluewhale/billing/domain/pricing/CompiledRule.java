package com.bluewhale.billing.domain.pricing;

import java.util.Map;

public record CompiledRule(
        UsageDim baseUnit,
        BasePriceResolver basePrice,
        Map<UsageDim, Integer> dims,
        long unitDenominator,
        long minCredits,
        Long maxCredits,
        RoundingPolicy rounding,
        long quantityOffset,
        long quantityStep
) {

    public CompiledRule(UsageDim baseUnit, BasePriceResolver basePrice,
                        Map<UsageDim, Integer> dims, long unitDenominator,
                        long minCredits, Long maxCredits, RoundingPolicy rounding) {
        this(baseUnit, basePrice, dims, unitDenominator, minCredits, maxCredits, rounding, 0L, 1L);
    }

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
        if (quantityOffset < 0) {
            throw new IllegalArgumentException("quantityOffset 不能为负：" + quantityOffset);
        }
        if (quantityStep < 0) {
            throw new IllegalArgumentException(
                    "quantityStep 不能为负（0/1 = 不取整）：" + quantityStep);
        }
        dims = dims == null ? Map.of() : Map.copyOf(dims);
        requireNonNegativeBasePrice(basePrice);
        for (var e : dims.entrySet()) {
            if (e.getValue() < 0) {
                throw new IllegalArgumentException(
                        "dims 的倍率不能为负：" + e.getKey().key() + " → " + e.getValue()
                                + "（负倍率把等效数量拉低，等于少收）");
            }
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
        return new CompiledRule(baseUnit, basePrice, Map.of(), unitDenominator,
                1L, null, new RoundingPolicy.HalfUp(), 0L, 1L);
    }

    public CompiledRule withMaxCredits(long max) {
        return new CompiledRule(baseUnit, basePrice, dims, unitDenominator,
                minCredits, max, rounding, quantityOffset, quantityStep);
    }
}
