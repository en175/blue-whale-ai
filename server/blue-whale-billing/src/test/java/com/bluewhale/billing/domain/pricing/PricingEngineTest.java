package com.bluewhale.billing.domain.pricing;

import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 定价引擎（《计费逻辑详细设计》§4.5 计算管线 / §4.6 模块设计）。
 *
 * <p>纯函数测试，不起 Spring、不连 DB——计价正确性不该依赖环境。
 */
class PricingEngineTest {

    private static final Instant T = Instant.parse("2026-10-15T22:30:00+08:00");

    // ── 夹具：三种模态的规则，取自《计费逻辑详细设计》§2.5.1 的示例 ──

    /** seedream：按尺寸档单价 × 张数。 */
    private static CompiledRule seedream() {
        return CompiledRule.of(
                UsageDim.SUCCEEDED_SLOTS,
                new BasePriceResolver.Table(Map.of(
                        "size=1k", 2_000L,
                        "size=2k", 5_000L,
                        "size=4k", 10_000L)),
                1L);
    }

    /** seedance：按秒 × 分辨率单价，参考素材加成。 */
    private static CompiledRule seedance() {
        return CompiledRule.of(
                        UsageDim.SECONDS,
                        new BasePriceResolver.Table(Map.of(
                                "size=1024x1024", 2_000L,
                                "size=1792x1024", 3_332L)),
                        1L)
                .withMultiplier(UsageDim.REFERENCE_COUNT, 12_000);
    }

    /** mediakit 抠图：按次，固定 3 积分。 */
    private static CompiledRule cutout() {
        return CompiledRule.of(UsageDim.CONSTANT_ONE, new BasePriceResolver.Constant(3_000L), 1L);
    }

    /** 文本：每百万 token 2 积分，输出是输入的 4 倍（本期不启用，但引擎要支持）。 */
    private static CompiledRule doubao() {
        return new CompiledRule(
                UsageDim.PROMPT_TOKENS,
                new BasePriceResolver.Constant(2_000L),
                Map.of(UsageDim.COMPLETION_TOKENS, 4_000),
                Map.of(),
                Map.of(),
                1_000_000L, 1L, null, new RoundingPolicy.HalfUp(), null);
    }

    /** 测试目录：模型/任务 → 规则。真实实现从 billing_pricing_catalogs 编译而来。 */
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

    // ══════════════════════════════════════════════════════════════════

    @Nested
    class 各模态计价 {

        @Test
        void 图片_按尺寸档单价乘张数() {
            var usage = Usage.of(UsageDim.SUCCEEDED_SLOTS, 3);

            long credits = engine().compute(
                    req("seedream-4.0", "text2image", Map.of("size", "2k")), usage, T).credits();

            // 5000 mc/张 × 3 张 = 15000 mc = 15 积分
            assertThat(credits).isEqualTo(15);
        }

        @Test
        void 视频_按秒乘分辨率单价_再加参考素材倍率() {
            var usage = new Usage(null, null, Map.of(
                    UsageDim.SECONDS, 5L,
                    UsageDim.REFERENCE_COUNT, 2L));

            long credits = engine().compute(
                    req("seedance-2.5", "text2video", Map.of("size", "1792x1024")), usage, T).credits();

            // 3332 mc/秒 × 5 秒 = 16660 mc；参考素材 2 个 × 1.2 = 2.4×
            // 16660 × 24000 / 10000 = 39984 mc → 39984/1000 = 39.984 → 四舍五入 40
            assertThat(credits).isEqualTo(40);
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
                    UsageDim.PROMPT_TOKENS, 1_000_000L,   // 输入 1M
                    UsageDim.COMPLETION_TOKENS, 100_000L)); // 输出 0.1M

            long credits = engine().compute(
                    req("doubao-1.5-pro", "chat", Map.of()), usage, T).credits();

            // 等效 = 1_000_000 + 100_000×4000/10000 = 1_040_000
            // mc = 1_040_000 × 2000 / 1_000_000 = 2080 mc → 2.08 → 四舍五入 2
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

            // 同一个规格的两种写法必须等价——这正是「大小写不匹配空表」的防线
            assertThat(a).isEqualTo(b).isEqualTo(5);
        }

        @Test
        void 请求里多出的维度不参与查表() {
            // 表只按 size 定价；请求多传 duration 不应导致查不到
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
            // 目录漏配一个尺寸档 → 必须炸，不能变成「免费」
            assertThatThrownBy(() -> engine().compute(
                    req("seedream-4.0", "text2image", Map.of("size", "8k")),
                    Usage.of(UsageDim.SUCCEEDED_SLOTS, 1), T))
                    .isInstanceOf(BasePriceResolver.UnpriceableSpecException.class)
                    .hasMessageContaining("size=8k");
        }
    }

    /**
     * **免费模型**（单价配成 0）的既有处置 —— 「免费」在目录里要配两个字段，缺一不可。
     *
     * <p>火山官方写 {@code doubao-seedream-5.0-flash} 免费（本仓暂无该模型；这组只钉机制）。
     * 运营若把单价配成 0 而忘了 {@code minCredits}，算出来**不是 0 而是 1 积分**——
     * 因为出口那次舍入是 {@code max(minCredits, ...)}，而 {@code minCredits} 的缺省是 1。
     * 于是「免费」变成「每次 1 积分」，账面上看不出哪里不对。
     *
     * <p>真正的 0 价（{@code basePrice=0} **且** {@code minCredits=0}）走
     * {@code BillingApplicationService#hold} 的既有分支：**不冻结、不建预留**
     * （建了反而会让结算侧去解冻一笔不存在的钱）。这里断言的是**计价出口**那一步，
     * 预扣侧那个分支由 {@code BillingApplicationServiceTest} 钉。
     */
    @Nested
    class 零价模型 {

        private CompiledRule free(long minCredits) {
            return new CompiledRule(UsageDim.SUCCEEDED_SLOTS,
                    new BasePriceResolver.Constant(0L), Map.of(), Map.of(), Map.of(), 1L,
                    minCredits, null, new RoundingPolicy.HalfUp(), null);
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

        /** seedream：封顶 10 积分（每槽 5 积分，2 张就顶到）。 */
        private PricingEngine engineWith(DiscountResolver discounts) {
            return PricingEngine.forMedia(
                    (m, t) -> seedream().withMaxCredits(10L), discounts);
        }

        @Test
        void 上限即价格_与用量无关() {
            // 契约量取不到时（duration=-1 之类）按上限冻：规格是 4k、按常规价要 10 积分/张
            long credits = engineWith(DiscountResolver.NONE).computeAtCap(
                    req("seedream-4.0", "text2image", Map.of("size", "4k")), T).credits();

            assertThat(credits).isEqualTo(10);
        }

        @Test
        void 折扣在封顶之后生效_与常规计价同一条通道() {
            var engine = engineWith(ctx -> new DiscountResolver.Discount(
                    9_000, java.util.List.of(DiscountResolver.AppliedDiscount.member(17L, 9_000))));

            var result = engine.computeAtCap(req("seedream-4.0", "text2image", Map.of("size", "2k")), T);

            // 上限 10 积分 → 九折 = 9：兜底也要走出折扣与舍入那一步（不是直接冻 maxCredits）
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
            // 上限是常数、与单价无关，但结算会按真实用量重新计价：漏配的价必须当场暴露
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
            var capped = seedream().withMaxCredits(5L).withMultiplier(UsageDim.REFERENCE_COUNT, 10_000);
            var engine = PricingEngine.forMedia((m, t) -> capped, DiscountResolver.NONE);

            // 4 张 4k = 40 积分，封顶 5
            long credits = engine.compute(
                    req("seedream-4.0", "text2image", Map.of("size", "4k")),
                    Usage.of(UsageDim.SUCCEEDED_SLOTS, 4), T).credits();

            assertThat(credits).isEqualTo(5);
        }

        @Test
        void 不足一个积分时_按下限兜底() {
            // 每百万 token 2 积分，只用了 100 token → 0.0002 积分 → 下限 1
            var usage = new Usage(null, null, Map.of(UsageDim.PROMPT_TOKENS, 100L));
            long credits = engine().compute(req("doubao-1.5-pro", "chat", Map.of()), usage, T).credits();

            assertThat(credits).isEqualTo(1);
        }

        @Test
        void 四舍五入而非向上取整() {
            // 4.4 积分 → 四舍五入 4（ceil 会得 5）
            assertThat(new RoundingPolicy.HalfUp().round(4_400L, 1L)).isEqualTo(4);
            // 4.5 → 5
            assertThat(new RoundingPolicy.HalfUp().round(4_500L, 1L)).isEqualTo(5);
            // 对照：ceil 在 4.4 上偏平台
            assertThat(new RoundingPolicy.Ceil().round(4_400L, 1L)).isEqualTo(5);
        }
    }

    @Nested
    class 折扣 {

        /** 九折的会员折扣。 */
        private final DiscountResolver tenPercentOff = ctx -> new DiscountResolver.Discount(
                9_000, java.util.List.of(DiscountResolver.AppliedDiscount.member(17L, 9_000)));

        @Test
        void 折扣在封顶之后_下限之前生效() {
            var engine = new PricingEngine(
                    (m, t) -> seedream(), new MediaPricingCalculator(tenPercentOff));

            // 2k × 1 张 = 5 积分 → 九折 = 4.5 → 四舍五入 5（让利恰好 0.5，卡边界）
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

            // 10 积分 × 0.9 = 9
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
                    UsageDim.SECONDS, new BasePriceResolver.Constant(1L), Map.of(), Map.of(), Map.of(),
                    1L, 10L, 5L, new RoundingPolicy.HalfUp(), null))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessageContaining("maxCredits");
        }

        @Test
        void unitDenominator_必须为正() {
            assertThatThrownBy(() -> new CompiledRule(
                    UsageDim.SECONDS, new BasePriceResolver.Constant(1L), Map.of(), Map.of(), Map.of(),
                    0L, 1L, null, new RoundingPolicy.HalfUp(), null))
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
            assertThatThrownBy(() -> UsageDim.of("usage.tokens"))  // 拼错的键
                    .isInstanceOf(UsageDim.UnknownUsageDimException.class)
                    .hasMessageContaining("usage.tokens");
        }
    }
}
