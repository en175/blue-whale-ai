package com.bluewhale.billing.domain.pricing;

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
 *   金额(mc) = (等效数量 × 基准单价 / unitDenominator + Σ(维度绝对加价)) × Π(整单倍率 / 10000)
 * </pre>
 *
 * @param baseUnit         基准维度：决定「数量」从哪来
 * @param basePrice        基准单价：常数或按轴查表
 * @param dims             按数量加权的其他维度 → 相对基准的**万分比**（4000 = 输出是输入的 4 倍）
 * @param multipliers      整单连乘的倍率 → 万分比（1200 = ×1.2）
 * @param dimPrices        按维度的**绝对**加价 → {@link DimPrice}（每单位多少 mc，**不乘 basePrice**）。
 *                         为空 = 该规则没有绝对加价，**此时算法的每一行都与没有这个字段时逐字相同**
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
        Map<UsageDim, DimPrice> dimPrices,
        long unitDenominator,
        long minCredits,
        Long maxCredits,
        RoundingPolicy rounding,
        TokenEstimator tokenEstimator
) {

    /**
     * 一个维度的绝对加价 —— 与 {@code CatalogDocument.DimPrice} 同形，
     * 但维度键已经解析成封闭枚举 {@link UsageDim}（未知键在编译期就该被拒）。
     *
     * @param unitMc    每单位多少 mc
     * @param firstFree 首单位免费（计费单位数取 {@code max(0, n-1)}）
     */
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
        // ⚠️ 单价的**符号**也要查 —— 这是 2026-09-26 架构评审查出的一个真缺口。
        //    负单价算出的 mc 为负，经出口的 `Math.max(minCredits, …)` 变成 minCredits（通常 0）；
        //    而「计价为 0」在提交侧被当成「不用冻钱」⇒ 不建预留、不冻钱、账面无异常。
        //    一次本该收 200 积分的生成就这样变成**免费**，且没有任何信号。
        //    （`dimPrices.unitMc` 早就拦了这个问题，`basePrice` 当时漏了 —— 属遗漏而非取舍。）
        //    ⚠️ 只拒**负**，0 放行：「零价模型」是被测试钉着的合法配置（见方法注释）。
        //    这是**第二道闸门**：第一道在 backend 的 `constants.ts`（拦「脏配置存不进去」），
        //    这道拦的是「脏配置已经在库里了」。
        requireNonNegativeBasePrice(basePrice);
        // dims 是**相对加量**（折算成基准单位数）：0 表示这一维不加量，等价于不写它，无害；
        // 负数会把等效数量拉低 ⇒ 少收。故只拒负。
        for (var e : dims.entrySet()) {
            if (e.getValue() < 0) {
                throw new IllegalArgumentException(
                        "dims 的倍率不能为负：" + e.getKey().key() + " → " + e.getValue()
                                + "（负倍率把等效数量拉低，等于少收）");
            }
        }
        // multipliers 是**整单连乘**：0 会让整单金额直接归零。与 dims 不同，它的 0 必须拒——
        // 「这一维不参与」的正确写法是**不写它**，而不是写个 0。
        for (var e : multipliers.entrySet()) {
            if (e.getValue() <= 0) {
                throw new IllegalArgumentException(
                        "multipliers 的倍率必须为正：" + e.getKey().key() + " → " + e.getValue()
                                + "（0 会让整单免费；「这一维不参与」应当是不写它）");
            }
        }
        // ⚠️ 上限与绝对加价**不能同时配**：上限路径（capDetailed）跳过用量计算，
        //    算不到绝对加价 ⇒ 预扣冻的是一份不含加价的上限，而结算会把它算进去 ⇒
        //    多出的部分记应收（静默少收）。写闸门也拦这一条，这里是第二道（脏配置可能直接改库进来）。
        if (maxCredits != null && !dimPrices.isEmpty()) {
            throw new IllegalArgumentException(
                    "maxCredits 与 dimPrices 不能同时配：上限冻结算不到维度绝对加价，"
                            + "结算会超出预扣并记应收（少收且静默）");
        }
    }

    /**
     * 基准单价**不能为负**（0 合法）。
     *
     * <h2>为什么 0 合法、负数不合法</h2>
     *
     * <p>「零价模型」是一条**被刻意支持的配置**（{@code PricingEngineTest.零价模型} 用
     * {@code Constant(0L)} 钉着两条：下限 0 时真的收 0，下限缺省 1 时收 1）——
     * 它表达「这个模型不收费」，真正的价格下限由 {@code minCredits} 兜。
     * 所以 0 必须放行，否则会把一条合法配置拦在门外。
     *
     * <p>负数则是纯粹的错配：算出的 mc 为负，经出口的 {@code Math.max(minCredits, …)}
     * 变成 minCredits（通常是 0）—— 一次本该收 200 积分的生成变成免费，**账面无任何异常**
     * （「计价为 0」在提交侧被当成「不用冻钱」⇒ 不建预留、不冻钱）。
     * 这是 2026-09-26 架构评审查出的缺口，也是本类作为**第二道闸门**该拦的东西：
     * 第一道在 backend 的 {@code constants.ts}（拦「脏配置存不进去」），这道拦「已经在库里了」。
     *
     * <p>⚠️ {@link BasePriceResolver.Unset} 那一档**刻意不拦**：它不是「配错」而是「还没配」，
     * 它的 resolve 会抛 {@code UnpriceableSpecException}（拒绝提交，不是按 0 放行）。
     */
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
                    // Table 不复制入参，所以这里仍可能拿到 null
                    if (e.getValue() == null || e.getValue() < 0) {
                        throw new IllegalArgumentException(
                                "basePrice 查表单价不能为负：" + e.getKey() + " → " + e.getValue());
                    }
                }
            }
            case BasePriceResolver.Unset ignored -> {
                // 空位：resolve 时抛 UnpriceableSpecException（拒绝提交，不是免费），不在此拦
            }
        }
    }

    /** 简化构造：媒介类（图片/视频/音频/按次）常用形态——无 dims，四舍五入，不封顶，不估算。 */
    public static CompiledRule of(UsageDim baseUnit, BasePriceResolver basePrice, long unitDenominator) {
        return new CompiledRule(baseUnit, basePrice, Map.of(), Map.of(), Map.of(), unitDenominator,
                1L, null, new RoundingPolicy.HalfUp(), null);
    }

    /** 带上 token 估算参数（视频按 token 计价时用）。 */
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

    /** 带上维度的绝对加价（参考图按张收费等）。 */
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
