package com.bluewhale.billing.domain.pricing;

import com.bluewhale.billing.application.CatalogCompiler;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

import java.time.LocalDateTime;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class DimPricePricingTest {

    private static final LocalDateTime T = LocalDateTime.parse("2026-09-26T16:00:00");

    private static long creditsOf(CompiledRule rule, Map<String, String> specs, long refCount, long slots) {
        PricingEngine engine = PricingEngine.forMedia((m, t) -> rule, DiscountResolver.NONE);
        Usage usage = Usage.ofKeys("m", "image", Map.of(
                "usage.referenceCount", refCount,
                "usage.succeededSlots", slots));
        return engine.compute(new PricingRequest(42L, "m", "image", specs, "free"), usage, T).credits();
    }

    @Nested
    class 机制 {

        private CompiledRule rule() {
            return CompiledRule.of(UsageDim.SUCCEEDED_SLOTS, new BasePriceResolver.Constant(1_000L), 1L)
                    .withDimPrice(UsageDim.REFERENCE_COUNT, 1_000L, true);
        }

        @Test
        @DisplayName("★ 首张免费：0 张与 1 张同价，第 2 张起每张 +1")
        void 首张免费() {
            assertThat(creditsOf(rule(), Map.of(), 0, 1)).isEqualTo(1L);
            assertThat(creditsOf(rule(), Map.of(), 1, 1)).isEqualTo(1L);
            assertThat(creditsOf(rule(), Map.of(), 2, 1)).isEqualTo(2L);
            assertThat(creditsOf(rule(), Map.of(), 5, 1)).isEqualTo(5L);
            assertThat(creditsOf(rule(), Map.of(), 20, 1)).isEqualTo(20L);
        }

        @Test
        @DisplayName("★ dimPrices 是**绝对**加价：跨 basePrice 档位时加价部分完全相同")
        void 跨档一致() {
            CompiledRule cheap = CompiledRule.of(UsageDim.SUCCEEDED_SLOTS,
                            new BasePriceResolver.Table(Map.of("size=1k", 1_000L)), 1L)
                    .withDimPrice(UsageDim.REFERENCE_COUNT, 1_000L, true);
            CompiledRule dear = CompiledRule.of(UsageDim.SUCCEEDED_SLOTS,
                            new BasePriceResolver.Table(Map.of("size=1k", 2_000L)), 1L)
                    .withDimPrice(UsageDim.REFERENCE_COUNT, 1_000L, true);

            Map<String, String> specs = Map.of("size", "1k");
            for (long refs = 0; refs <= 10; refs++) {
                assertThat(creditsOf(dear, specs, refs, 1) - creditsOf(cheap, specs, refs, 1))
                        .as("参考图 %d 张时两档的差额", refs)
                        .isEqualTo(1L);
            }
        }

        @Test
        @DisplayName("★ 加价按**张数**而非输出数：一次出 3 张也按同一个参考数加一次")
        void 加价不随输出数放大() {
            assertThat(creditsOf(rule(), Map.of(), 3, 1)).isEqualTo(3L);
            assertThat(creditsOf(rule(), Map.of(), 3, 3)).isEqualTo(5L);
        }

        @Test
        @DisplayName("★ 没有 dimPrices 的规则：算术与这个字段不存在时逐字相同")
        void 空加价不影响金额() {
            var plain = CompiledRule.of(UsageDim.SUCCEEDED_SLOTS, new BasePriceResolver.Constant(7_000L), 1L);
            assertThat(plain.dimPrices()).isEmpty();
            for (long refs : new long[]{0, 1, 5, 100}) {
                assertThat(creditsOf(plain, Map.of(), refs, 1)).isEqualTo(7L);
            }
        }

        @Test
        @DisplayName("★ 加价受**封顶**作用不了：maxCredits 与 dimPrices 不允许同时配")
        void 封顶与加价互斥() {
            assertThatThrownBy(() -> CompiledRule
                    .of(UsageDim.SUCCEEDED_SLOTS, new BasePriceResolver.Constant(1_000L), 1L)
                    .withDimPrice(UsageDim.REFERENCE_COUNT, 1_000L, true)
                    .withMaxCredits(50L))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessageContaining("maxCredits");
        }
    }


    private static final String PRO_RULE_JSON = """
            {"baseUnit":"usage.succeededSlots",
             "basePrice":{"kind":"table","by":["size"],
                          "table":{"size=1k":4500,"size=1.5k":4500,"size=2k":9000}},
             "unitDenominator":1,
             "minCredits":1,
             "dimPrices":{"usage.referenceCount":{"unitMc":300,"firstFree":true}}}
            """;

    private static final long OFFICIAL_MC_PER_EXTRA_REF = 300L;

    @Test
    @DisplayName("★ 迁移里那段 JSON 能编译，且参考图单价就是官方的 0.02 元")
    void pro规则可编译() {
        CompiledRule rule = CatalogCompiler.compileRuleSnapshot(PRO_RULE_JSON);
        assertThat(rule.baseUnit()).isEqualTo(UsageDim.SUCCEEDED_SLOTS);
        assertThat(rule.dimPrices()).containsKey(UsageDim.REFERENCE_COUNT);
        assertThat(rule.dimPrices().get(UsageDim.REFERENCE_COUNT).unitMc())
                .isEqualTo(OFFICIAL_MC_PER_EXTRA_REF);
        assertThat(OFFICIAL_MC_PER_EXTRA_REF / 1000.0 / 15).isEqualTo(0.02);
    }

    @Test
    @DisplayName("★ 端到端金额：输出档 + 首张免费的参考费（与官方逐项对）")
    void pro金额() {
        CompiledRule rule = CatalogCompiler.compileRuleSnapshot(PRO_RULE_JSON);
        Map<String, String> k1 = Map.of("size", "1k");
        Map<String, String> k2 = Map.of("size", "2k");

        assertThat(creditsOf(rule, k1, 0, 1)).isEqualTo(5L);
        assertThat(creditsOf(rule, k1, 1, 1)).isEqualTo(5L);
        assertThat(creditsOf(rule, k1, 10, 1)).isEqualTo(7L);

        assertThat(creditsOf(rule, k2, 1, 1)).isEqualTo(9L);
        assertThat(creditsOf(rule, k2, 10, 1)).isEqualTo(12L);
    }

    @Test
    @DisplayName("★ 老快照（没有 dimPrices）照样编译，且金额与这个字段不存在时相同")
    void 老快照可编译() {
        String legacy = """
                {"baseUnit":"usage.succeededSlots",
                 "basePrice":{"kind":"table","by":["size"],"table":{"size=1k":4500}},
                 "unitDenominator":1,"minCredits":1}
                """;
        CompiledRule rule = CatalogCompiler.compileRuleSnapshot(legacy);
        assertThat(rule.dimPrices()).isEmpty();
        assertThat(creditsOf(rule, Map.of("size", "1k"), 10, 1)).isEqualTo(5L);
    }

    @Test
    @DisplayName("★ 编译期拒绝：unitMc 缺失 / 非正 / 维度键不认识")
    void 脏配置拒在编译期() {
        assertThatThrownBy(() -> CatalogCompiler.compileRuleSnapshot(
                "{\"baseUnit\":\"usage.succeededSlots\",\"basePrice\":{\"kind\":\"const\",\"value\":1000},"
                        + "\"dimPrices\":{\"usage.referenceCount\":{\"unitMc\":0}}}"))
                .isInstanceOf(CatalogCompiler.CompileException.class)
                .hasMessageContaining("unitMc");

        assertThatThrownBy(() -> CatalogCompiler.compileRuleSnapshot(
                "{\"baseUnit\":\"usage.succeededSlots\",\"basePrice\":{\"kind\":\"const\",\"value\":1000},"
                        + "\"dimPrices\":{\"usage.nosuchDim\":{\"unitMc\":300}}}"))
                .isInstanceOf(CatalogCompiler.CompileException.class);
    }
}
