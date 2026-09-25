package com.bluewhale.billing.pricing;

import java.util.Map;

/**
 * 编译后的计价规则（catalog JSON 的运行时形态）。
 *
 * <p>由目录加载器从 {@code billing_pricing_catalogs.document} 编译而来，**不可变**。
 * 计价时只读，无锁——目录切换靠整体替换引用（见 {@code CatalogHolder}）。
 *
 * <p>字段与《计费逻辑详细设计》§2.5.1 的 JSON 一一对应：
 * <pre>
 *   等效数量 = 基准维度数量 + Σ(其他维度数量 × 相对倍率 / 10000)
 *   金额(mc) = 等效数量 × 基准单价 / unitDenominator × Π(整单倍率 / 10000)
 * </pre>
 *
 * @param baseUnit         基准维度：决定「数量」从哪来
 * @param basePrice        基准单价：常数或按轴查表
 * @param dims             按数量加权的其他维度 → 相对基准的**万分比**（4000 = 输出是输入的 4 倍）
 * @param multipliers      整单连乘的倍率 → 万分比（1200 = ×1.2）
 * @param unitDenominator  「每多少个单位多少钱」：1000000 = 每百万 token，1 = 每秒/每张/每次
 * @param minCredits       下限（整数积分）
 * @param maxCredits       上限（整数积分），null = 不封顶。**基础价的封顶，在折扣之前生效**
 * @param rounding         舍入策略
 * @param tokenEstimator   token 估算参数（视频按 token 计价的预扣用），{@code null} = 该规则不做估算；
 *                         非 null 时 {@code usage.c} 的契约量由它从规格推出来（见 {@link Usage#contractFrom}）
 */
public record CompiledRule(
        UsageDim baseUnit,
        BasePriceResolver basePrice,
        Map<UsageDim, Integer> dims,
        Map<UsageDim, Integer> multipliers,
        long unitDenominator,
        long minCredits,
        Long maxCredits,
        RoundingPolicy rounding,
        TokenEstimator tokenEstimator
) {

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
    }

    /** 简化构造：媒介类（图片/视频/音频/按次）常用形态——无 dims，四舍五入，不封顶，不估算。 */
    public static CompiledRule of(UsageDim baseUnit, BasePriceResolver basePrice, long unitDenominator) {
        return new CompiledRule(baseUnit, basePrice, Map.of(), Map.of(), unitDenominator,
                1L, null, new RoundingPolicy.HalfUp(), null);
    }

    /** 带上 token 估算参数（视频按 token 计价时用）。 */
    public CompiledRule withTokenEstimator(TokenEstimator estimator) {
        return new CompiledRule(baseUnit, basePrice, dims, multipliers, unitDenominator,
                minCredits, maxCredits, rounding, estimator);
    }

    public CompiledRule withMultiplier(UsageDim dim, int permille) {
        var next = new java.util.LinkedHashMap<>(multipliers);
        next.put(dim, permille);
        return new CompiledRule(baseUnit, basePrice, dims, next, unitDenominator,
                minCredits, maxCredits, rounding, tokenEstimator);
    }

    public CompiledRule withMaxCredits(long max) {
        return new CompiledRule(baseUnit, basePrice, dims, multipliers, unitDenominator,
                minCredits, max, rounding, tokenEstimator);
    }
}
