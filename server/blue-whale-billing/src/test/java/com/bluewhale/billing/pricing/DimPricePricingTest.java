package com.bluewhale.billing.pricing;

import com.bluewhale.billing.catalog.CatalogCompiler;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 维度的**绝对**加价（{@code dimPrices}）与「首张免费」—— Seedream 5.0 Pro 的参考图计费。
 *
 * <h2>要解决的问题</h2>
 *
 * 火山官方对 Pro 的计费是两项相加：
 * <pre>
 *   费用 = 输出图 × 档位单价(0.3 / 0.6 元)  +  max(0, 参考图张数 - 1) × 0.02 元
 * </pre>
 * 第二项用原来的 {@code dims}（相对万分比）**表达不了**，两条独立的理由：
 * <ol>
 *   <li>{@code dims} 的金额 = 万分比 × basePrice —— 而 Pro 的 basePrice 有两个档，
 *       同一个「0.02 元」在两档下要两个不同的万分比，一个字段装不下。</li>
 *   <li>线性公式给的是 {@code n}，官方要的是 {@code n-1}（首张免费）。</li>
 * </ol>
 *
 * <p>所以本文件分两组：**机制**（在无舍入干扰的数上钉住 n-1 与跨档一致）与
 * **真实规则**（拿迁移 045 写下的那段 JSON，对官方金额）。
 */
class DimPricePricingTest {

    private static final Instant T = Instant.parse("2026-09-26T16:00:00+08:00");

    private static long creditsOf(CompiledRule rule, Map<String, String> specs, long refCount, long slots) {
        PricingEngine engine = PricingEngine.forMedia((m, t) -> rule, DiscountResolver.NONE);
        Usage usage = Usage.ofKeys("m", "image", Map.of(
                "usage.referenceCount", refCount,
                "usage.succeededSlots", slots));
        return engine.compute(new PricingRequest(42L, "m", "image", specs, "free"), usage, T).credits();
    }

    /* ══ 机制 ══════════════════════════════════════════════════════════════════
     * 这一组刻意用「单价是 1000 的整数倍」的数：mc → 积分的换算因此不含零头，
     * 断言看到的就是算术本身，而不是舍入的副产物。
     */
    @Nested
    class 机制 {

        /** 每张 1 积分，首张免费，输出图固定 1 积分。 */
        private CompiledRule rule() {
            return CompiledRule.of(UsageDim.SUCCEEDED_SLOTS, new BasePriceResolver.Constant(1_000L), 1L)
                    .withDimPrice(UsageDim.REFERENCE_COUNT, 1_000L, true);
        }

        @Test
        @DisplayName("★ 首张免费：0 张与 1 张同价，第 2 张起每张 +1")
        void 首张免费() {
            // 这正是线性 dims 做不到的那一个 -1 —— 少了它，第一张参考图会被多收一次。
            assertThat(creditsOf(rule(), Map.of(), 0, 1)).isEqualTo(1L);
            assertThat(creditsOf(rule(), Map.of(), 1, 1)).isEqualTo(1L);
            assertThat(creditsOf(rule(), Map.of(), 2, 1)).isEqualTo(2L);
            assertThat(creditsOf(rule(), Map.of(), 5, 1)).isEqualTo(5L);
            assertThat(creditsOf(rule(), Map.of(), 20, 1)).isEqualTo(20L);
        }

        @Test
        @DisplayName("★ dimPrices 是**绝对**加价：跨 basePrice 档位时加价部分完全相同")
        void 跨档一致() {
            // 这是「必须走绝对单价」的核心论据。basePrice 差一档（1 积分 vs 2 积分），
            // 无论参考图几张，**两个规则的差额恒等于档位差** —— 也就是说加价那部分
            // 在两档下一模一样。用相对万分比的话，差额会随参考图张数线性放大。
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
            // succeededSlots 是基准维度（主价 × 张数），参考加价与它无关 ——
            // 传 3 张参考图出 3 张图，参考费仍是 (3-1) 份，不是 ×3。
            assertThat(creditsOf(rule(), Map.of(), 3, 1)).isEqualTo(3L); // 1 + 2
            assertThat(creditsOf(rule(), Map.of(), 3, 3)).isEqualTo(5L); // 3 + 2
        }

        @Test
        @DisplayName("★ 没有 dimPrices 的规则：算术与这个字段不存在时逐字相同")
        void 空加价不影响金额() {
            var plain = CompiledRule.of(UsageDim.SUCCEEDED_SLOTS, new BasePriceResolver.Constant(7_000L), 1L);
            assertThat(plain.dimPrices()).isEmpty();
            // 传多少参考图都一样 —— 现存 19 条规则全在这个形态里
            for (long refs : new long[]{0, 1, 5, 100}) {
                assertThat(creditsOf(plain, Map.of(), refs, 1)).isEqualTo(7L);
            }
        }

        @Test
        @DisplayName("★ 加价受**封顶**作用不了：maxCredits 与 dimPrices 不允许同时配")
        void 封顶与加价互斥() {
            // 上限路径跳过用量计算 ⇒ 冻的是不含加价的上限，而结算会把加价算进去 ⇒
            // 超出部分记应收（少收且静默）。所以这个组合从构造上就不成立。
            assertThatThrownBy(() -> CompiledRule
                    .of(UsageDim.SUCCEEDED_SLOTS, new BasePriceResolver.Constant(1_000L), 1L)
                    .withDimPrice(UsageDim.REFERENCE_COUNT, 1_000L, true)
                    .withMaxCredits(50L))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessageContaining("maxCredits");
        }
    }

    /* ══ 真实规则：迁移 045 写下的那段 JSON ════════════════════════════════════ */

    /**
     * Seedream 5.0 Pro 的规则，**逐字**抄自迁移 045。
     * 改动它等于改动线上收多少钱 —— 不会报错，只会收错。
     */
    private static final String PRO_RULE_JSON = """
            {"baseUnit":"usage.succeededSlots",
             "basePrice":{"kind":"table","by":["size"],
                          "table":{"size=1k":4500,"size=1.5k":4500,"size=2k":9000}},
             "unitDenominator":1,
             "minCredits":1,
             "dimPrices":{"usage.referenceCount":{"unitMc":300,"firstFree":true}}}
            """;

    /** 官方：参考图第 2 张起 0.02 元/张 = 0.3 积分 = 300 mc。 */
    private static final long OFFICIAL_MC_PER_EXTRA_REF = 300L;

    @Test
    @DisplayName("★ 迁移里那段 JSON 能编译，且参考图单价就是官方的 0.02 元")
    void pro规则可编译() {
        CompiledRule rule = CatalogCompiler.compileRuleSnapshot(PRO_RULE_JSON);
        assertThat(rule.baseUnit()).isEqualTo(UsageDim.SUCCEEDED_SLOTS);
        assertThat(rule.dimPrices()).containsKey(UsageDim.REFERENCE_COUNT);
        assertThat(rule.dimPrices().get(UsageDim.REFERENCE_COUNT).unitMc())
                .isEqualTo(OFFICIAL_MC_PER_EXTRA_REF);
        // 反推回官方价：300 mc ÷ 1000 = 0.3 积分；0.3 积分 ÷ 15 积分/元 = 0.02 元
        assertThat(OFFICIAL_MC_PER_EXTRA_REF / 1000.0 / 15).isEqualTo(0.02);
    }

    @Test
    @DisplayName("★ 端到端金额：输出档 + 首张免费的参考费（与官方逐项对）")
    void pro金额() {
        CompiledRule rule = CatalogCompiler.compileRuleSnapshot(PRO_RULE_JSON);
        Map<String, String> k1 = Map.of("size", "1k");
        Map<String, String> k2 = Map.of("size", "2k");

        // ≤236 万像素档：输出 0.3 元 = 4.5 积分 → halfUp → 5
        assertThat(creditsOf(rule, k1, 0, 1)).isEqualTo(5L);
        assertThat(creditsOf(rule, k1, 1, 1)).isEqualTo(5L); // 首张免费，与 0 张同价
        // 10 张参考图：输出 0.3 + 9 × 0.02 = 0.48 元 = 7.2 积分 → halfUp → 7
        assertThat(creditsOf(rule, k1, 10, 1)).isEqualTo(7L);

        // >236 万像素档：输出 0.6 元 = 9 积分
        assertThat(creditsOf(rule, k2, 1, 1)).isEqualTo(9L);
        // 0.6 + 9 × 0.02 = 0.78 元 = 11.7 积分 → halfUp → 12
        assertThat(creditsOf(rule, k2, 10, 1)).isEqualTo(12L);
    }

    @Test
    @DisplayName("★ 老快照（没有 dimPrices）照样编译，且金额与这个字段不存在时相同")
    void 老快照可编译() {
        // 预留行里冻的是**逐字原文**，历史行都没有这个键。新增字段必须向前兼容，
        // 否则老单子结算时直接编译失败 → 死信 → 那笔预扣永远冻着。
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
        // 0 等于「这个维度免费」，而免费应当由「不写这个维度」表达 —— 写 0 出来
        // 读的人只会当成配漏了。宁可当场拒。
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
