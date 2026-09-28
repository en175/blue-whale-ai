package com.bluewhale.billing.domain.pricing;

import com.bluewhale.billing.application.CatalogCompiler;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 视频 token 预扣估算 —— 与**火山方舟官方对照表**逐格对齐。
 *
 * <h2>这张表是本单唯一能证明「没编」的东西</h2>
 *
 * 上一版把视频计价拍成了 {@code constant:1}（每次固定 100 积分），那是**编的**：它与火山
 * 口径没有任何关系。本测试拿官方文档给出的 (档位, 比例, 时长) → token 数对照表当用例，
 * 断言我们算出来的是同一批数——公式、除数、帧率、宽高任何一处编错，这里都会红。
 *
 * <pre>
 *   token ≈ 输出宽 × 输出高 × 输出帧率 × 输出时长 ÷ 1024      （24fps，官方对照表）
 * </pre>
 *
 * <p>⚠️ <b>输出宽高由规格快照带进来</b>（能力行的 {@code features.video_dimensions}，
 * 由接纳侧按档位+比例查好后冻成 {@code output_width} / {@code output_height} 两个标量），
 * 所以本测试把官方那张「档位 + 比例 → 宽高」的表放在**夹具**里，用 {@link #specsOf}
 * 把它折成规格——与生产路径同形。
 *
 * <p>⚠️ 表里 <b>480p 16:9 / 10 秒</b> 一格官方写 97,000，而公式（= 5 秒那格 × 2）给 97,200。
 * 其余 15 格全部逐字相符，且官方自己的 5 秒格 48,600 × 2 = 97,200 —— 故按公式实现，
 * 并把这一格单列出来（{@link #官方表里唯一不自洽的那一格()}），等口径确认后改。
 */
class TokenEstimatorTest {

    /** 官方对照表用 24fps。 */
    private static final int OFFICIAL_FPS = 24;
    /** 官方公式的除数字。 */
    private static final int OFFICIAL_DIVISOR = 1024;

    /**
     * 官方对照表的「档位 + 比例 → 输出宽高」。
     *
     * <p>⚠️ 生产上这张表住在**模型能力行**（{@code features.video_dimensions}），
     * 由接纳侧查好后把宽高冻进规格；本测试把它放在夹具里，只为把官方对照表的用例
     * 折成「规格里带了什么宽高」。
     */
    private static final Map<String, String> OFFICIAL_DIMENSIONS = Map.ofEntries(
            Map.entry("480p|16:9", "864x480"),
            Map.entry("480p|4:3", "736x544"),
            Map.entry("480p|1:1", "640x640"),
            Map.entry("480p|21:9", "960x416"),
            Map.entry("720p|16:9", "1248x704"),
            Map.entry("720p|4:3", "1120x832"),
            Map.entry("720p|1:1", "960x960"),
            Map.entry("1080p|16:9", "1920x1088"),
            Map.entry("4k|16:9", "3840x2160"));

    /**
     * 一次产出用到的规格：档位 + 比例 + **折算好的输出宽高**。
     *
     * <p>宽高取官方表那一格——它就是接纳侧会冻进来的那两个标量。
     */
    private static Map<String, String> specsOf(String tier, String ratio) {
        String wh = OFFICIAL_DIMENSIONS.get(tier + "|" + ratio);
        if (wh == null) {
            throw new IllegalArgumentException("官方表里没有这一格：" + tier + "|" + ratio);
        }
        String[] parts = wh.split("x");
        return Map.of("resolution", tier, "aspect_ratio", ratio,
                "output_width", parts[0], "output_height", parts[1]);
    }

    /** 官方对照表：{@code 档位, 比例, 时长, 期望 token}。 */
    @ParameterizedTest(name = "{0} {1} {2}s → {3} token")
    @CsvSource({
            "480p,  16:9,  5,   48600",
            "480p,  16:9, 10,   97200",
            "480p,  4:3,   5,   46920",
            "480p,  4:3,  10,   93840",
            "480p,  1:1,   5,   48000",
            "480p,  1:1,  10,   96000",
            "480p,  21:9,  5,   46800",
            "480p,  21:9, 10,   93600",
            "720p,  16:9,  5,  102960",
            "720p,  16:9, 10,  205920",
            "720p,  4:3,   5,  109200",
            "720p,  4:3,  10,  218400",
            "720p,  1:1,   5,  108000",
            "720p,  1:1,  10,  216000",
            "1080p, 16:9,  5,  244800",
            "1080p, 16:9, 10,  489600",
            // 另两个官方参考点（不在上面的表里）
            "720p,  16:9, 15,  308880",
            "4k,    16:9,  5,  972000",
    })
    @DisplayName("官方对照表：我们算出的 token 与官方逐格一致")
    void officialTable(String tier, String ratio, long seconds, long expectedTokens) {
        TokenEstimator estimator = officialEstimator();

        assertThat(estimator.estimateVideoTokens(specsOf(tier, ratio), seconds, 1))
                .as("%s %s %ds（官方 %d）", tier, ratio, seconds, expectedTokens)
                .isEqualTo(expectedTokens);
    }

    /**
     * 官方表里唯一与自己不自洽的一格 —— 单列出来，不混在参数化用例里。
     *
     * <p>官方表把 480p 16:9 的 10 秒写成 97,000；而它自己的 5 秒格是 48,600，按公式线性翻倍
     * 只能是 97,200。我们按**公式**实现（97,200），因为公式是官方给的、且另外 15 格全对得上。
     */
    @Test
    @DisplayName("480p 16:9 10 秒：官方表写 97,000，公式给 97,200（表自身不自洽，已记录待确认）")
    void 官方表里唯一不自洽的那一格() {
        Long tokens = officialEstimator().estimateVideoTokens(specsOf("480p", "16:9"), 10L, 1);

        assertThat(tokens).isEqualTo(97_200L);
        // 与官方 5 秒格的关系：正是它的一倍
        assertThat(tokens).isEqualTo(48_600L * 2);
    }

    @Nested
    @DisplayName("取不到就说取不到：不兜别的档位、不按 0 算")
    class 取不到 {

        @Test
        @DisplayName("规格里没有冻结的输出宽高 → null（预扣推不出，调用方按「契约量取不到」处理）")
        void 缺宽高() {
            // 官方表里没有 1080p|21:9 这一格，接纳侧因此冻不出宽高 —— 规格里也就没有这两个键
            assertThat(officialEstimator().estimateVideoTokens(
                    Map.of("resolution", "1080p", "aspect_ratio", "21:9"), 5L, 1))
                    .isNull();
        }

        @Test
        @DisplayName("规格里压根没有 resolution（比如新建的模型还没配像素表）→ null")
        void 缺档位() {
            // 没有档位就查不出像素，也就没有宽高可冻——这条与上一条是同一个判据（宽高在不在）
            assertThat(officialEstimator().estimateVideoTokens(
                    Map.of("aspect_ratio", "16:9"), 5L, 1))
                    .isNull();
        }

        @Test
        @DisplayName("时长未知（duration=-1 的自动时长传进来是 null）→ null，绝不按 0 估")
        void 时长未知() {
            assertThat(officialEstimator().estimateVideoTokens(specsOf("720p", "16:9"), null, 1))
                    .isNull();
        }
    }

    @Test
    @DisplayName("片段数按乘数生效（官方公式的「× 片段数」）")
    void 片段数() {
        TokenEstimator estimator = officialEstimator();

        assertThat(estimator.estimateVideoTokens(specsOf("480p", "16:9"), 5L, 2))
                .isEqualTo(48_600L * 2);
    }

    @Nested
    @DisplayName("规则 JSON → 契约量 → 计价：整条链路")
    class 整条链路 {

        /**
         * 一份最小视频规则 —— 参数全在 JSON 里（公式的除数、帧率、单价都不在代码里）。
         *
         * <p>单价 555,000 mc / 百万 token = 37 元/百万 token × 15 积分/元 × 1000 mc/积分，
         * 即火山官方 doubao-seedance-2-0-fast「无视频输入」档。
         *
         * <p>⚠️ 形态就是能力行的 {@code pricing} 列：
         * 随 Hold / Quote 作为 {@code rule_snapshot} 送来的那一串。
         */
        private static final String RULE = """
                {
                  "baseUnit": "usage.c",
                  "basePrice": { "kind": "table", "table": {
                      "video=0": 555000,
                      "video=1": 330000
                  } },
                  "unitDenominator": 1000000,
                  "minCredits": 1,
                  "tokenEstimate": { "divisor": 1024, "fps": 24 }
                }
                """;

        private static CompiledRule rule() {
            return CatalogCompiler.compileRuleSnapshot(RULE);
        }

        @Test
        @DisplayName("预扣：契约量是**估**出来的官方 token 数，不是 0、也不是别的档位")
        void 预扣用估算() {
            Usage contract = Usage.contractFrom(rule(), Map.of(
                    "resolution", "720p", "aspect_ratio", "16:9",
                    "output_width", "1248", "output_height", "704",
                    "duration", "5", "expected_output_count", "1",
                    "video", "0"));

            assertThat(contract.quantityOf(UsageDim.COMPLETION_TOKENS)).isEqualTo(102_960L);
        }

        @Test
        @DisplayName("预扣价 = 官方 token × 官方单价（720p 16:9 5s → 102,960 token → 57 积分）")
        void 预扣价() {
            Map<String, String> specs = Map.of(
                    "resolution", "720p", "aspect_ratio", "16:9",
                    "output_width", "1248", "output_height", "704",
                    "duration", "5", "expected_output_count", "1",
                    "video", "0");
            PricingRequest request = new PricingRequest(1L, "m", "video", specs, "free");
            PricingEngine engine = PricingEngine.forMedia((modelId, taskType) -> rule(), DiscountResolver.NONE);

            // 102,960 token × 555,000 mc / 1,000,000 = 57,142.8 mc → 57 积分
            assertThat(engine.compute(request, Usage.contractFrom(rule(), specs),
                    java.time.Instant.now()).credits()).isEqualTo(57L);
        }

        @Test
        @DisplayName("结算：按 worker 上报的**上游真实 token** 计价，估算值不参与")
        void 结算用真值() {
            PricingRequest request = new PricingRequest(1L, "m", "video",
                    Map.of("resolution", "720p", "aspect_ratio", "16:9", "video", "0"), "free");
            PricingEngine engine = PricingEngine.forMedia((modelId, taskType) -> rule(), DiscountResolver.NONE);

            // 实测：720p 16:9 带音频，上游报 216,900（估算是 205,920）——结算按真值走
            Usage upstream = Usage.ofKeys("m", "video",
                    Map.of("usage.c", 216_900L, "usage.succeededSlots", 1L));

            // 216,900 × 555,000 / 1,000,000 = 120,379.5 mc → 120 积分
            assertThat(engine.compute(request, upstream, java.time.Instant.now()).credits())
                    .isEqualTo(120L);
        }

        @Test
        @DisplayName("含视频输入：单价按规则里的另一档（330,000 mc/百万 token）走")
        void 含视频输入单价() {
            PricingRequest request = new PricingRequest(1L, "m", "video",
                    Map.of("resolution", "720p", "aspect_ratio", "16:9", "video", "1"), "free");
            PricingEngine engine = PricingEngine.forMedia((modelId, taskType) -> rule(), DiscountResolver.NONE);

            // 216,900 × 330,000 / 1,000,000 = 71,577 mc → 72 积分
            assertThat(engine.compute(request,
                    Usage.ofKeys("m", "video", Map.of("usage.c", 216_900L)),
                    java.time.Instant.now()).credits()).isEqualTo(72L);
        }

        @Test
        @DisplayName("规则没配 tokenEstimate → 推理不出契约量（拒绝，而不是按 0 冻下限）")
        void 没配估算参数() {
            CompiledRule noEstimate = new CompiledRule(
                    UsageDim.COMPLETION_TOKENS, new BasePriceResolver.Constant(555_000L),
                    Map.of(), Map.of(), Map.of(), 1_000_000L, 1L, null, new RoundingPolicy.HalfUp(), null);

            assertThatThrownBy(() -> Usage.contractFrom(noEstimate, Map.of(
                    "resolution", "720p", "aspect_ratio", "16:9", "duration", "5")))
                    .isInstanceOf(Usage.ContractQuantityUnavailableException.class);
        }
    }

    @Nested
    @DisplayName("编译期校验：半配的估算会算出「像那么回事」的数，所以保存时即拒")
    class 编译期校验 {

        @Test
        @DisplayName("缺 divisor / fps → 拒绝")
        void 半配拒绝() {
            assertThatThrownBy(() -> compileWith("\"tokenEstimate\": {\"fps\": 24}"))
                    .hasMessageContaining("divisor");
            assertThatThrownBy(() -> compileWith("\"tokenEstimate\": {\"divisor\": 1024}"))
                    .hasMessageContaining("fps");
            // 两个都配齐就通过（宽高不在这里——它是模型属性，由接纳侧冻进规格）
            compileWith("\"tokenEstimate\": {\"divisor\": 1024, \"fps\": 24}");
        }

        @Test
        @DisplayName("inputSecondsKey 是空白串 → 拒绝（配了个查不到的键，比不配更坏）")
        void 输入时长键空白拒绝() {
            assertThatThrownBy(() -> compileWith(
                    "\"tokenEstimate\": {\"divisor\": 1024, \"fps\": 24, \"inputSecondsKey\": \"  \"}"))
                    .hasMessageContaining("inputSecondsKey");
        }

        @Test
        @DisplayName("★ 单价待配（kind=unset）**编译得过** —— 它是空位，不是非法配置")
        void 单价待配编译得过() {
            // 关键区别：空位允许**规则存进去**（否则运营连别处都改不了），
            // 拒绝发生在计价那一刻（见下面「单价待配」那组用例）。
            CompiledRule rule = CatalogCompiler.compileRuleSnapshot("""
                    {
                      "baseUnit": "usage.c",
                      "basePrice": { "kind": "unset", "by": ["video"] },
                      "unitDenominator": 1000000
                    }
                    """);

            assertThat(rule.basePrice()).isInstanceOf(BasePriceResolver.Unset.class);
        }

        @Test
        @DisplayName("未知 basePrice.kind → 拒绝（错误信息列出合法值）")
        void 未知kind拒绝() {
            assertThatThrownBy(() -> CatalogCompiler.compileRuleSnapshot("""
                    {
                      "baseUnit": "usage.c",
                      "basePrice": { "kind": "free" },
                      "unitDenominator": 1000000
                    }
                    """))
                    .hasMessageContaining("合法值：const | table | unset");
        }

        private static CompiledRule compileWith(String tokenEstimateJson) {
            String rule = """
                    {
                      "baseUnit": "usage.c",
                      "basePrice": { "kind": "const", "value": 555000 },
                      "unitDenominator": 1000000,
                      %s
                    }
                    """.formatted(tokenEstimateJson);
            return CatalogCompiler.compileRuleSnapshot(rule);
        }
    }

    @Nested
    @DisplayName("含视频输入的输入时长、单价待配（unset）、以及 2.5 与 2.0 同公式不同单价")
    class 视频输入与单价空位 {

        /**
         * 2.0 与 2.5 两条规则：**同一套 tokenEstimate**（同一个公式、同样的参数），
         * 只有单价不同 —— 「计费方式相同、单价不同」在配置里天然就是两条规则，不必另造机制。
         *
         * <p>⚠️ 2.5 的单价火山**没有给**，所以这里写的是 {@code unset}（待运营填的空位）——
         * 下面那条 1,234,000 只出现在**测试夹具**里，用来证明「同一套参数换个单价就换出另一个价」，
         * **不是**我们给 2.5 定的价（规则里它是空位，提交即拒）。
         */
        private static final String RULE_20 = """
                {
                  "baseUnit": "usage.c",
                  "basePrice": { "kind": "table", "table": {
                      "video=0": 555000,
                      "video=1": 330000
                  } },
                  "unitDenominator": 1000000,
                  "minCredits": 1,
                  "tokenEstimate": { "divisor": 1024, "fps": 24,
                                      "inputSecondsKey": "video_input_seconds" }
                }
                """;

        private static final String RULE_25 = """
                {
                  "baseUnit": "usage.c",
                  "basePrice": { "kind": "unset", "by": ["video"] },
                  "unitDenominator": 1000000,
                  "minCredits": 1,
                  "tokenEstimate": { "divisor": 1024, "fps": 24,
                                      "inputSecondsKey": "video_input_seconds" }
                }
                """;

        /** 720p 16:9 的输出宽高 —— 接纳侧按能力行的像素表查好后冻进规格。 */
        private static final String W = "1248";
        private static final String H = "704";

        @Test
        @DisplayName("★ 含视频输入：输入时长加进公式（5s 输出 + 5s 输入 = 10s 的量）")
        void 输入时长进公式() {
            TokenEstimator estimator = CatalogCompiler.compileRuleSnapshot(RULE_20).tokenEstimator();

            // 官方口径：无视频输入时输入时长按 0 计，所以 video=0 那档仍是 102,960
            assertThat(estimator.estimateVideoTokens(
                    Map.of("resolution", "720p", "aspect_ratio", "16:9",
                            "output_width", W, "output_height", H, "video", "0"), 5L, 1))
                    .isEqualTo(102_960L);
            // 含视频输入：输入 5s + 输出 5s = 10s 的量 = 205,920
            assertThat(estimator.estimateVideoTokens(
                    Map.of("resolution", "720p", "aspect_ratio", "16:9",
                            "output_width", W, "output_height", H,
                            "video", "1", "video_input_seconds", "5"), 5L, 1))
                    .isEqualTo(205_920L);
        }

        @Test
        @DisplayName("★ 含视频输入却量不到输入时长 → 取不到（不按 0 估、不静默少冻）")
        void 量不到输入时长不按零估() {
            CompiledRule rule = CatalogCompiler.compileRuleSnapshot(RULE_20);

            assertThat(rule.tokenEstimator().estimateVideoTokens(
                    Map.of("resolution", "720p", "aspect_ratio", "16:9",
                            "output_width", W, "output_height", H, "video", "1"), 5L, 1))
                    .isNull();
            // 走完整链路：契约量取不到 → 拒绝（该规则没配 maxCredits，没有上限可依）
            assertThatThrownBy(() -> Usage.contractFrom(rule, Map.of(
                    "resolution", "720p", "aspect_ratio", "16:9",
                    "output_width", W, "output_height", H,
                    "video", "1", "duration", "5", "expected_output_count", "1")))
                    .isInstanceOf(Usage.ContractQuantityUnavailableException.class);
        }

        @Test
        @DisplayName("★ 没配 inputSecondsKey 的规则不受影响（那一项压根不加，也不会因此被拒）")
        void 未配输入时长项则不加() {
            // 少数模型不按「输入时长」那一项加价：不写这个字段，含视频输入的任务照旧估得出来
            CompiledRule rule = CatalogCompiler.compileRuleSnapshot("""
                    {
                      "baseUnit": "usage.c",
                      "basePrice": { "kind": "const", "value": 555000 },
                      "unitDenominator": 1000000,
                      "tokenEstimate": { "divisor": 1024, "fps": 24 }
                    }
                    """);

            assertThat(rule.tokenEstimator().estimateVideoTokens(
                    Map.of("resolution", "720p", "aspect_ratio", "16:9",
                            "output_width", W, "output_height", H, "video", "1"), 5L, 1))
                    .isEqualTo(102_960L);
        }

        @Test
        @DisplayName("★ 单价待配（unset）：规则存得下、token 也估得出，但**计价必拒**（不是按 0 免费）")
        void 单价待配拒绝计价() {
            CompiledRule rule = CatalogCompiler.compileRuleSnapshot(RULE_25);

            // 估算本身是好的（2.5 与 2.0 用的是同一套参数）
            assertThat(rule.tokenEstimator().estimateVideoTokens(
                    Map.of("resolution", "720p", "aspect_ratio", "16:9",
                            "output_width", W, "output_height", H, "video", "0"), 5L, 1))
                    .isEqualTo(102_960L);

            PricingRequest request = new PricingRequest(1L, "seedance-2.5", "video",
                    Map.of("resolution", "720p", "aspect_ratio", "16:9",
                            "output_width", W, "output_height", H,
                            "duration", "5", "expected_output_count", "1", "video", "0"),
                    "free");
            PricingEngine engine = PricingEngine.forMedia((m, t) -> rule, DiscountResolver.NONE);
            Usage contract = Usage.contractFrom(rule, request.specs());

            assertThatThrownBy(() -> engine.compute(request, contract, java.time.Instant.now()))
                    .isInstanceOf(BasePriceResolver.UnpriceableSpecException.class)
                    .hasMessageContaining("单价");
        }

        @Test
        @DisplayName("★ 同一套参数、不同单价 → 同一个 token 数换出不同的价（单价可设）")
        void 同公式不同单价() {
            Map<String, String> specs = Map.of("resolution", "720p", "aspect_ratio", "16:9",
                    "output_width", W, "output_height", H,
                    "duration", "5", "expected_output_count", "1", "video", "0");
            PricingRequest request = new PricingRequest(1L, "m", "video", specs, "free");

            // 夹具：把 2.5 的空位换成单价 1,234,000（**只是夹具**，规则里 2.5 仍是 unset 空位）
            CompiledRule priced = CatalogCompiler.compileRuleSnapshot(RULE_25
                    .replace("\"kind\": \"unset\", \"by\": [\"video\"]",
                            "\"kind\": \"table\", \"table\": { \"video=0\": 1234000 }"));
            PricingEngine engine = PricingEngine.forMedia((m, t) -> priced, DiscountResolver.NONE);

            // 102,960 × 1,234,000 / 1,000,000 = 127,052.64 mc → 127 积分
            assertThat(engine.compute(request, Usage.contractFrom(priced, specs),
                    java.time.Instant.now()).credits()).isEqualTo(127L);
        }
    }

    @Nested
    @DisplayName("最低 token 用量（官方明文规则：含视频输入时，估算 < 下限 ⇒ 按下限计费）")
    class 最低token用量 {

        /**
         * 夹具：官方口径的表在规则里（键 = 分辨率 + 宽高比 + 输出时长）。
         *
         * <p>⚠️ 这两行的**数**是**测试夹具**，不是我们抄来的官方值 —— 官方原页只给了
         * 「最低 token 用量表格」的飞书链接，没有公开可抄的形态（见
         * {@code CatalogDocument.TokenEstimate#minimumTokens}）。这里用 200,000 / 150,000
         * 只为证明机制（下限生效、只在含视频输入时生效、逐段生效）。
         */
        private static final String RULE = """
                {
                  "baseUnit": "usage.c",
                  "basePrice": { "kind": "const", "value": 555000 },
                  "unitDenominator": 1000000,
                  "tokenEstimate": {
                    "divisor": 1024, "fps": 24,
                    "inputSecondsKey": "video_input_seconds",
                    "minimumTokens": {
                      "resolution=480p|aspect_ratio=16:9|duration=5": 200000,
                      "resolution=480p|aspect_ratio=16:9|duration=10": 150000
                    }
                  }
                }
                """;

        private static TokenEstimator estimator() {
            return CatalogCompiler.compileRuleSnapshot(RULE).tokenEstimator();
        }

        /** 480p 16:9 5 秒的公式值：864 × 480 × 24 × 5 ÷ 1024 = 48,600 —— 远低于下限 200,000。 */
        private static final long FORMULA_5S = 48_600L;

        /** 480p 16:9 的输出宽高（能力行像素表里那一格，由接纳侧冻进规格）。 */
        private static final String W = "864";
        private static final String H = "480";

        /**
         * 含视频输入的规格（{@code video_input_seconds} 必给：{@code inputSecondsKey} 配了它，
         * 缺了会先走「输入时长取不到」那条路，测不到下限）。
         */
        private static Map<String, String> withVideoInput(String duration) {
            return Map.of("resolution", "480p", "aspect_ratio", "16:9",
                    "output_width", W, "output_height", H,
                    "video", "1", "duration", duration, "video_input_seconds", duration);
        }

        @Test
        @DisplayName("★ 含视频输入且估算 < 下限 → 按下限计（官方：按最低 token 用量计算视频价格）")
        void 估算低于下限按下限() {
            // 公式值：(5 + 5) × 864 × 480 × 24 ÷ 1024 = 97,200 < 200,000 → 取下限
            assertThat(estimator().estimateVideoTokens(withVideoInput("5"), 5L, 1))
                    .isEqualTo(200_000L);
        }

        @Test
        @DisplayName("★ 不含视频输入（video=0）→ 下限不生效（官方限定语是「当输入包含视频时」）")
        void 不含视频输入不受下限约束() {
            assertThat(estimator().estimateVideoTokens(
                    Map.of("resolution", "480p", "aspect_ratio", "16:9",
                            "output_width", W, "output_height", H,
                            "video", "0", "duration", "5"),
                    5L, 1))
                    .isEqualTo(FORMULA_5S);
        }

        @Test
        @DisplayName("★ 估算已高于下限 → 用估算值（下限是下限，不是单价）")
        void 估算高于下限用估算() {
            TokenEstimator low = TokenEstimator.from(1024, 24, null,
                    Map.of("resolution=480p|aspect_ratio=16:9|duration=5", 10_000L));

            assertThat(low.estimateVideoTokens(
                    Map.of("resolution", "480p", "aspect_ratio", "16:9",
                            "output_width", W, "output_height", H,
                            "video", "1", "duration", "5"),
                    5L, 1))
                    .isEqualTo(FORMULA_5S);
        }

        @Test
        @DisplayName("★ 逐段生效：下限是「一条视频」的口径，片段数乘在外面（2 段 → 2 × 下限）")
        void 下限逐段生效() {
            assertThat(estimator().estimateVideoTokens(withVideoInput("5"), 5L, 2))
                    .isEqualTo(400_000L);
        }

        @Test
        @DisplayName("★ 配了下限表但这一格查不到 → 取不到（不当作「没有下限」静默少冻）")
        void 配了表但这一格没有() {
            // 表里只有 duration=5 / duration=10，问一个 duration=8 的
            assertThat(estimator().estimateVideoTokens(withVideoInput("8"), 8L, 1))
                    .isNull();
        }

        @Test
        @DisplayName("没配下限表 → 估算照旧，不因缺配置被拒")
        void 未配下限行为不变() {
            assertThat(officialEstimator().minimumTokens()).isEmpty();
            assertThat(officialEstimator().hasMinimumTokens()).isFalse();
            assertThat(officialEstimator().estimateVideoTokens(
                    Map.of("resolution", "480p", "aspect_ratio", "16:9",
                            "output_width", W, "output_height", H, "video", "1"), 5L, 1))
                    .isEqualTo(FORMULA_5S);
        }

        @Test
        @DisplayName("整条链路：含视频输入 + 估算低于下限 → 契约量 = 下限 → 预扣按下限计价")
        void 整条链路按下限预扣() {
            CompiledRule rule = CatalogCompiler.compileRuleSnapshot(RULE);
            Map<String, String> specs = Map.of(
                    "resolution", "480p", "aspect_ratio", "16:9",
                    "output_width", W, "output_height", H,
                    "video", "1", "duration", "5", "expected_output_count", "1",
                    "video_input_seconds", "5");
            Usage contract = Usage.contractFrom(rule, specs);

            assertThat(contract.quantityOf(UsageDim.COMPLETION_TOKENS)).isEqualTo(200_000L);

            PricingRequest request = new PricingRequest(1L, "m", "video", specs, "free");
            PricingEngine engine = PricingEngine.forMedia((m, t) -> rule, DiscountResolver.NONE);
            // 200,000 × 555,000 / 1,000,000 = 111,000 mc → 111 积分
            assertThat(engine.compute(request, contract, java.time.Instant.now()).credits())
                    .isEqualTo(111L);
        }

        @Test
        @DisplayName("编译期：下限为 0 / 负数 / 键不规范 / 等价键 → 保存即拒")
        void 编译期校验() {
            assertThatThrownBy(() -> compileWith("\"minimumTokens\": {\"resolution=480p\": 0}"))
                    .hasMessageContaining("必须为正");
            assertThatThrownBy(() -> compileWith("\"minimumTokens\": {\"resolution=480p\": -1}"))
                    .hasMessageContaining("必须为正");
            assertThatThrownBy(() -> compileWith("\"minimumTokens\": {\"noseparator\": 100}"))
                    .hasMessageContaining("缺少 '='");
            assertThatThrownBy(() -> compileWith(
                    "\"minimumTokens\": {\"Resolution=480P\": 100, \" resolution = 480p \": 200}"))
                    .hasMessageContaining("等价键");
        }

        private static TokenEstimator compileWith(String minimumTokensJson) {
            String rule = """
                    {
                      "baseUnit": "usage.c",
                      "basePrice": { "kind": "const", "value": 555000 },
                      "unitDenominator": 1000000,
                      "tokenEstimate": {
                        "divisor": 1024, "fps": 24,
                        %s
                      }
                    }
                    """.formatted(minimumTokensJson);
            return CatalogCompiler.compileRuleSnapshot(rule).tokenEstimator();
        }
    }

    @Nested
    @DisplayName("输出宽高只从规格里取：取不到就是取不到，不凑一个尺寸")
    class 规格里的冻结宽高 {

        @Test
        @DisplayName("规格带完整宽高 → 按它算（官方公式）")
        void 规格带宽高() {
            Map<String, String> specs = Map.of(
                    "resolution", "720p", "aspect_ratio", "16:9",
                    "output_width", "1280", "output_height", "720");

            assertThat(officialEstimator().estimateVideoTokens(specs, 5L, 1))
                    .isEqualTo(1280L * 720L * OFFICIAL_FPS * 5L / OFFICIAL_DIVISOR);
        }

        @Test
        @DisplayName("只带一个 / 非正 / 非数字 → null，**不拿其中一个值凑**一个尺寸")
        void 半配则取不到() {
            for (Map<String, String> broken : List.of(
                    Map.of("resolution", "720p", "aspect_ratio", "16:9", "output_width", "1280"),
                    Map.of("resolution", "720p", "aspect_ratio", "16:9", "output_height", "720"),
                    Map.of("resolution", "720p", "aspect_ratio", "16:9",
                            "output_width", "0", "output_height", "720"),
                    Map.of("resolution", "720p", "aspect_ratio", "16:9",
                            "output_width", "1280", "output_height", "-704"),
                    Map.of("resolution", "720p", "aspect_ratio", "16:9",
                            "output_width", "abc", "output_height", "720"))) {
                assertThat(officialEstimator().estimateVideoTokens(broken, 5L, 1))
                        .as("半配的宽高应取不到，而不是拿其中一个值凑：%s", broken)
                        .isNull();
            }
        }

        @Test
        @DisplayName("规格里压根没有宽高 → null（推不出），不是构造期炸")
        void 都取不到则null() {
            assertThat(officialEstimator().estimateVideoTokens(
                    Map.of("resolution", "480p", "aspect_ratio", "16:9"), 5L, 1))
                    .isNull();
        }
    }

    /** 官方对照表的估算器：参数与官方一致（1024 / 24fps），不含最低用量表。 */
    static TokenEstimator officialEstimator() {
        return TokenEstimator.from(OFFICIAL_DIVISOR, OFFICIAL_FPS, null, null);
    }

    @Test
    @DisplayName("估算器本身拒绝非法参数（编译期就炸，不进运行期）")
    void 构造校验() {
        assertThatThrownBy(() -> new TokenEstimator(0, 24, null, Map.of()))
                .hasMessageContaining("divisor");
        assertThatThrownBy(() -> new TokenEstimator(1024, 0, null, Map.of()))
                .hasMessageContaining("fps");
        // 最低用量表为空 = 不做下限；非法值（0 / 负数）在构造期就拒
        assertThat(new TokenEstimator(1024, 24, null, Map.of()).minimumTokens()).isEmpty();
        assertThatThrownBy(() -> new TokenEstimator(1024, 24, null, Map.of("resolution=480p", 0L)))
                .hasMessageContaining("必须为正");
        assertThatThrownBy(() -> new TokenEstimator.Dimensions(0, 480))
                .hasMessageContaining("宽高必须为正");
    }
}
