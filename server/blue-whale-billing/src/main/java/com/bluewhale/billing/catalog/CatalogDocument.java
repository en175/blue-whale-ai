package com.bluewhale.billing.catalog;

import java.util.List;
import java.util.Map;

/**
 * 定价目录 JSON 的 Java 形态（《计费逻辑详细设计》§2.5.1）。
 *
 * <p>**这是 wire/存储形态，不是领域形态**——编译成 {@code CompiledRule} 后才进引擎。
 * 分成两层是因为：JSON 要容忍运营写得不规范（大小写、额外字段），
 * 而领域对象必须严格（构造即校验）。
 *
 * <p>用 record + Jackson 直接反序列化；未知字段由 {@code FAIL_ON_UNKNOWN_PROPERTIES=false}
 * 容忍（向前兼容：运营端先加字段、服务端后升级）。
 */
public record CatalogDocument(
        int schemaVersion,
        String currency,
        int creditsPerYuan,
        /** modelId → taskType → 规则 */
        Map<String, Map<String, TaskRule>> models,
        DiscountPolicy discountPolicy
) {

    public static final int SUPPORTED_SCHEMA_VERSION = 1;

    public CatalogDocument {
        models = models == null ? Map.of() : Map.copyOf(models);
    }

    /**
     * 单个 (model, taskType) 的计价规则。
     *
     * @param usageSemantic   仅文本/多模态用：{@code openai} | {@code claude}。本期不启用
     * @param baseUnit        ★ 基准维度键，如 {@code usage.seconds}
     * @param basePrice       ★ 基准单价：常数或按轴查表
     * @param dims            按数量加权的其他维度 → **万分比**（4000 = 4.0 倍）
     * @param multipliers     整单连乘的倍率 → **万分比**（12000 = 1.2 倍）
     * @param unitDenominator 「每多少个单位多少钱」：1000000 = 每百万 token，1 = 每秒/每张/每次
     * @param minCredits      下限（整数积分）
     * @param maxCredits      上限，null = 不封顶
     * @param rounding        {@code halfUp}（默认）| {@code ceil} | {@code floor}
     */
    public record TaskRule(
            String usageSemantic,
            String baseUnit,
            BasePrice basePrice,
            Map<String, Integer> dims,
            Map<String, Integer> multipliers,
            Long unitDenominator,
            Long minCredits,
            Long maxCredits,
            String rounding
    ) {}

    /**
     * 基准单价的两种形态。
     *
     * @param kind  {@code const} | {@code table}
     * @param value {@code const} 时的单价（mc）
     * @param by    {@code table} 时声明的定价轴（仅供校验与文档，查表靠 table 的键）
     * @param table {@code table} 时的价格表：规格键 → 单价（mc）
     */
    public record BasePrice(
            String kind,
            Long value,
            List<String> by,
            Map<String, Long> table
    ) {}

    /**
     * 折扣策略（折扣规则本身在两张独立 live 表，不在这里）。
     *
     * @param stackMode    {@code multiply}（默认，会员再享活动）| {@code best}（两者取优）
     * @param floorFactorBp 底线，10000 = 不打折。最低不低于它，防配错亏本
     */
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
