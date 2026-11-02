package com.bluewhale.billing.domain.pricing;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

import java.time.LocalDateTime;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class PricingEngineTest {

    private static final LocalDateTime T = LocalDateTime.parse("2026-10-15T22:30:00");


    private static CompiledRule seedream() {
        return CompiledRule.of(
                UsageDim.SUCCEEDED_SLOTS,
                new BasePriceResolver.Table(Map.of(
                        "size=1k", 2_000L,
                        "size=2k", 5_000L,
                        "size=4k", 10_000L)),
                1L);
    }

    private static CompiledRule seedance() {
        return CompiledRule.of(
                UsageDim.SECONDS,
                new BasePriceResolver.Table(Map.of(
                        "size=1024x1024", 2_000L,
                        "size=1792x1024", 3_332L)),
                1L);
    }

    private static CompiledRule cutout() {
        return CompiledRule.of(UsageDim.CONSTANT_ONE, new BasePriceResolver.Constant(3_000L), 1L);
    }

    private static CompiledRule doubao() {
        return new CompiledRule(
                UsageDim.PROMPT_TOKENS,
                new BasePriceResolver.Constant(2_000L),
                Map.of(UsageDim.COMPLETION_TOKENS, 4_000),
                1_000_000L, 1L, null, new RoundingPolicy.HalfUp());
    }

    private static final Map<String, CompiledRule> CATALOG = Map.of(
            "seedream-4.0/text2image", seedream(),
            "seedance-2.5/text2video", seedance(),
            "mediakit-cutout/cutout", cutout(),
            "doubao-1.5-pro/chat", doubao());

    private static PricingEngine engine() {
        return PricingEngine.forMedia((model, task) -> CATALOG.get(model + "/" + task), DiscountResolver.NONE);
    }

    private static PricingRequest req(String model, String task, Map<String, String> specs) {
        return new PricingRequest(42L, model, task, specs, "free");
    }


    @Nested
    class 各模态计价 {

        @Test
        void 图片_按尺寸档单价乘张数() {
            var usage = Usage.of(UsageDim.SUCCEEDED_SLOTS, 3);

            long credits = engine().compute(
                    req("seedream-4.0", "text2image", Map.of("size", "2k")), usage, T).credits();

            assertThat(credits).isEqualTo(15);
        }

        @Test
        void 视频_按秒乘分辨率单价_参考素材不再参与计价() {
            var usage = new Usage(null, null, Map.of(
                    UsageDim.SECONDS, 5L,
                    UsageDim.REFERENCE_COUNT, 2L));

            long credits = engine().compute(
                    req("seedance-2.5", "text2video", Map.of("size", "1792x1024")), usage, T).credits();

            assertThat(credits).isEqualTo(17);
        }

        @Test
        void 按次_固定价() {
            long credits = engine().compute(
                    req("mediakit-cutout", "cutout", Map.of()), Usage.empty(), T).credits();

            assertThat(credits).isEqualTo(3);
        }

        @Test
        void 文本_多token维加权和() {
            var usage = new Usage(null, null, Map.of(
                    UsageDim.PROMPT_TOKENS, 1_000_000L,
                    UsageDim.COMPLETION_TOKENS, 100_000L));

            long credits = engine().compute(
                    req("doubao-1.5-pro", "chat", Map.of()), usage, T).credits();

            assertThat(credits).isEqualTo(2);
        }
    }

    @Nested
    class 规格规范化 {

        @Test
        void 大小写与空白不敏感() {
            long a = engine().compute(
                    req("seedream-4.0", "text2image", Map.of("Size", "2K")), Usage.of(UsageDim.SUCCEEDED_SLOTS, 1), T).credits();
            long b = engine().compute(
                    req("seedream-4.0", "text2image", Map.of(" size ", " 2k ")), Usage.of(UsageDim.SUCCEEDED_SLOTS, 1), T).credits();

            assertThat(a).isEqualTo(b).isEqualTo(5);
        }

        @Test
        void 请求里多出的维度不参与查表() {
            long credits = engine().compute(
                    req("seedream-4.0", "text2image", Map.of("size", "1k", "duration", "5")),
                    Usage.of(UsageDim.SUCCEEDED_SLOTS, 1), T).credits();

            assertThat(credits).isEqualTo(2);
        }
    }

    @Nested
    class 拒绝而非降级 {

        @Test
        void 未配规则_拒绝() {
            assertThatThrownBy(() -> engine().compute(
                    req("unknown-model", "text2image", Map.of()), Usage.empty(), T))
                    .isInstanceOf(PricingEngine.RuleNotFoundException.class)
                    .hasMessageContaining("unknown-model");
        }

        @Test
        void 未配规格_拒绝而不是算成零() {
            assertThatThrownBy(() -> engine().compute(
                    req("seedream-4.0", "text2image", Map.of("size", "8k")),
                    Usage.of(UsageDim.SUCCEEDED_SLOTS, 1), T))
                    .isInstanceOf(BasePriceResolver.UnpriceableSpecException.class)
                    .hasMessageContaining("size=8k");
        }
    }

    @Nested
    class 零价模型 {

        private CompiledRule free(long minCredits) {
            return new CompiledRule(UsageDim.SUCCEEDED_SLOTS,
                    new BasePriceResolver.Constant(0L), Map.of(), 1L,
                    minCredits, null, new RoundingPolicy.HalfUp());
        }

        private long creditsOf(CompiledRule rule) {
            return PricingEngine.forMedia((m, t) -> rule, DiscountResolver.NONE)
                    .compute(req("free-model", "text2image", Map.of()),
                            Usage.of(UsageDim.SUCCEEDED_SLOTS, 1), T)
                    .credits();
        }

        @Test
        void 单价零且下限零_真的零() {
            assertThat(creditsOf(free(0L))).isZero();
        }

        @Test
        void 单价零但下限仍是缺省的一_变成每次一积分() {
            assertThat(creditsOf(free(1L))).isEqualTo(1L);
        }
    }

    @Nested
    class 按上限计价 {

        private PricingEngine engineWith(DiscountResolver discounts) {
            return PricingEngine.forMedia(
                    (m, t) -> seedream().withMaxCredits(10L), discounts);
        }

        @Test
        void 上限即价格_与用量无关() {
            long credits = engineWith(DiscountResolver.NONE).computeAtCap(
                    req("seedream-4.0", "text2image", Map.of("size", "4k")), T).credits();

            assertThat(credits).isEqualTo(10);
        }

        @Test
        void 折扣在封顶之后生效_与常规计价同一条通道() {
            var engine = engineWith(ctx -> new DiscountResolver.Discount(
                    9_000, java.util.List.of(DiscountResolver.AppliedDiscount.member(17L, 9_000))));

            var result = engine.computeAtCap(req("seedream-4.0", "text2image", Map.of("size", "2k")), T);

            assertThat(result.credits()).isEqualTo(9);
            assertThat(result.isDiscounted()).isTrue();
        }

        @Test
        void 没配上限_拒绝而不是猜一个数() {
            assertThatThrownBy(() -> engine().computeAtCap(
                    req("seedream-4.0", "text2image", Map.of("size", "2k")), T))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessageContaining("没有配上限");
        }

        @Test
        void 规格查不到价仍拒绝_上限不豁免漏配() {
            assertThatThrownBy(() -> engineWith(DiscountResolver.NONE).computeAtCap(
                    req("seedream-4.0", "text2image", Map.of("size", "8k")), T))
                    .isInstanceOf(BasePriceResolver.UnpriceableSpecException.class)
                    .hasMessageContaining("size=8k");
        }

        @Test
        void 未配规则仍拒绝() {
            assertThatThrownBy(() -> engine().computeAtCap(
                    req("unknown-model", "text2image", Map.of("size", "2k")), T))
                    .isInstanceOf(PricingEngine.RuleNotFoundException.class)
                    .hasMessageContaining("unknown-model");
        }
    }

    @Nested
    class 上下限与舍入 {

        @Test
        void 封顶在折扣之前生效() {
            var capped = seedream().withMaxCredits(5L);
            var engine = PricingEngine.forMedia((m, t) -> capped, DiscountResolver.NONE);

            long credits = engine.compute(
                    req("seedream-4.0", "text2image", Map.of("size", "4k")),
                    Usage.of(UsageDim.SUCCEEDED_SLOTS, 4), T).credits();

            assertThat(credits).isEqualTo(5);
        }

        @Test
        void 不足一个积分时_按下限兜底() {
            var usage = new Usage(null, null, Map.of(UsageDim.PROMPT_TOKENS, 100L));
            long credits = engine().compute(req("doubao-1.5-pro", "chat", Map.of()), usage, T).credits();

            assertThat(credits).isEqualTo(1);
        }

        @Test
        void 四舍五入而非向上取整() {
            assertThat(new RoundingPolicy.HalfUp().round(4_400L, 1L)).isEqualTo(4);
            assertThat(new RoundingPolicy.HalfUp().round(4_500L, 1L)).isEqualTo(5);
            assertThat(new RoundingPolicy.Ceil().round(4_400L, 1L)).isEqualTo(5);
        }
    }

    @Nested
    class 折扣 {

        private final DiscountResolver tenPercentOff = ctx -> new DiscountResolver.Discount(
                9_000, java.util.List.of(DiscountResolver.AppliedDiscount.member(17L, 9_000)));

        @Test
        void 折扣在封顶之后_下限之前生效() {
            var engine = new PricingEngine(
                    (m, t) -> seedream(), new MediaPricingCalculator(tenPercentOff));

            long credits = engine.compute(
                    req("seedream-4.0", "text2image", Map.of("size", "2k")),
                    Usage.of(UsageDim.SUCCEEDED_SLOTS, 1), T).credits();

            assertThat(credits).isEqualTo(5);
        }

        @Test
        void 折扣生效时_结果带命中明细() {
            var engine = new PricingEngine(
                    (m, t) -> seedream(), new MediaPricingCalculator(tenPercentOff));

            var result = engine.compute(
                    req("seedream-4.0", "text2image", Map.of("size", "4k")),
                    Usage.of(UsageDim.SUCCEEDED_SLOTS, 1), T);

            assertThat(result.credits()).isEqualTo(9);
            assertThat(result.isDiscounted()).isTrue();
            assertThat(result.appliedDiscounts())
                    .singleElement()
                    .satisfies(d -> {
                        assertThat(d.source()).isEqualTo("member");
                        assertThat(d.id()).isEqualTo(17L);
                    });
        }

        @Test
        void 无折扣时_结果标记为未打折() {
            var result = engine().compute(
                    req("seedream-4.0", "text2image", Map.of("size", "2k")),
                    Usage.of(UsageDim.SUCCEEDED_SLOTS, 1), T);

            assertThat(result.isDiscounted()).isFalse();
            assertThat(result.appliedDiscounts()).isEmpty();
        }
    }

    @Nested
    class 不变量 {

        @Test
        void 同一输入结果确定() {
            var r = req("seedance-2.5", "text2video", Map.of("size", "1792x1024"));
            var u = new Usage(null, null, Map.of(UsageDim.SECONDS, 7L, UsageDim.REFERENCE_COUNT, 3L));

            long first = engine().compute(r, u, T).credits();
            long second = engine().compute(r, u, T).credits();

            assertThat(first).isEqualTo(second);
        }

        @Test
        void 数量增加_金额单调不减() {
            var r = req("seedance-2.5", "text2video", Map.of("size", "1024x1024"));
            long prev = 0;

            for (long seconds = 1; seconds <= 20; seconds++) {
                long credits = engine().compute(r, Usage.of(UsageDim.SECONDS, seconds), T).credits();
                assertThat(credits).isGreaterThanOrEqualTo(prev);
                prev = credits;
            }
        }

        @Test
        void 金额恒非负_且不低于下限() {
            for (long n = 0; n <= 10; n++) {
                long credits = engine().compute(
                        req("seedream-4.0", "text2image", Map.of("size", "1k")),
                        Usage.of(UsageDim.SUCCEEDED_SLOTS, n), T).credits();
                assertThat(credits).isGreaterThanOrEqualTo(1);
            }
        }
    }

    @Nested
    class 配置非法时_构造即失败 {

        @Test
        void maxCredits_小于_minCredits() {
            assertThatThrownBy(() -> new CompiledRule(
                    UsageDim.SECONDS, new BasePriceResolver.Constant(1L), Map.of(),
                    1L, 10L, 5L, new RoundingPolicy.HalfUp()))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessageContaining("maxCredits");
        }

        @Test
        void unitDenominator_必须为正() {
            assertThatThrownBy(() -> new CompiledRule(
                    UsageDim.SECONDS, new BasePriceResolver.Constant(1L), Map.of(),
                    0L, 1L, null, new RoundingPolicy.HalfUp()))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessageContaining("unitDenominator");
        }

        @Test
        void 空价格表_拒绝() {
            assertThatThrownBy(() -> new BasePriceResolver.Table(Map.of()))
                    .isInstanceOf(IllegalArgumentException.class);
        }

        @Test
        void 未知用量维度键_拒绝() {
            assertThatThrownBy(() -> UsageDim.of("usage.tokens"))
                    .isInstanceOf(UsageDim.UnknownUsageDimException.class)
                    .hasMessageContaining("usage.tokens");
        }
    }

    @Nested
    @DisplayName("数量偏移与步长")
    class QuantityOffsetAndStep {

        private long computeCredits(long quantity, long offset, long step) {
            var rule = new CompiledRule(
                    UsageDim.SECONDS, new BasePriceResolver.Constant(1000L),
                    Map.of(), 1L, 1L, null,
                    new RoundingPolicy.HalfUp(), offset, step);
            return PricingEngine.forMedia((m, t) -> rule, DiscountResolver.NONE)
                    .compute(req("tool", "tool", Map.of()), Usage.of(UsageDim.SECONDS, quantity), T)
                    .credits();
        }

        @Test
        @DisplayName("先加偏移再按步长向上取整")
        void addsOffsetThenRoundsUpToStep() {
            assertThat(computeCredits(4, 1, 5)).isEqualTo(5);
            assertThat(computeCredits(5, 1, 5)).isEqualTo(10);
            assertThat(computeCredits(10, 1, 5)).isEqualTo(15);
        }

        @Test
        @DisplayName("分母按分钟折算并最终向上取整")
        void convertsPerMinutePriceAndRoundsUp() {
            var rule = new CompiledRule(
                    UsageDim.SECONDS, new BasePriceResolver.Constant(45000L),
                    Map.of(), 60L, 1L, null,
                    new RoundingPolicy.Ceil(), 0L, 1L);
            long result = PricingEngine.forMedia((m, t) -> rule, DiscountResolver.NONE)
                    .compute(req("tool", "tool", Map.of()), Usage.of(UsageDim.SECONDS, 15), T)
                    .credits();
            assertThat(result).isEqualTo(12);
        }

        @Test
        @DisplayName("零偏移与一步不改变数量（step=0 等价）")
        void zeroOffsetAndStepOneKeepQuantity() {
            assertThat(computeCredits(7, 0, 1)).isEqualTo(7);
            assertThat(computeCredits(7, 0, 0)).isEqualTo(7);
        }

        @Test
        @DisplayName("先取整基准量再加维度，偏移不作用于维度")
        void appliesOffsetBeforeDims() {
            var rule = new CompiledRule(
                    UsageDim.SECONDS, new BasePriceResolver.Constant(1000L),
                    Map.of(UsageDim.COMPLETION_TOKENS, 30000),
                    1L, 1L, null, new RoundingPolicy.HalfUp(), 1L, 5L);
            var usage = new Usage(null, null,
                    Map.of(UsageDim.SECONDS, 4L, UsageDim.COMPLETION_TOKENS, 1L));
            long result = PricingEngine.forMedia((m, t) -> rule, DiscountResolver.NONE)
                    .compute(req("tool", "tool", Map.of()), usage, T)
                    .credits();
            assertThat(result).isEqualTo(8);
        }
    }
}
