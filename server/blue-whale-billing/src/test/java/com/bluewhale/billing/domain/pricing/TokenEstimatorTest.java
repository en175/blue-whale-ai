package com.bluewhale.billing.domain.pricing;

import com.bluewhale.billing.application.CatalogCompiler;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import java.util.List;
import java.util.Map;
import java.time.LocalDateTime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class TokenEstimatorTest {

    private static final int OFFICIAL_FPS = 24;
    private static final int OFFICIAL_DIVISOR = 1024;

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

    private static Map<String, String> specsOf(String tier, String ratio) {
        String wh = OFFICIAL_DIMENSIONS.get(tier + "|" + ratio);
        if (wh == null) {
            throw new IllegalArgumentException("官方表里没有这一格：" + tier + "|" + ratio);
        }
        String[] parts = wh.split("x");
        return Map.of("resolution", tier, "aspect_ratio", ratio,
                "output_width", parts[0], "output_height", parts[1]);
    }

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

    @Test
    @DisplayName("480p 16:9 10 秒：官方表写 97,000，公式给 97,200（表自身不自洽，已记录待确认）")
    void 官方表里唯一不自洽的那一格() {
        Long tokens = officialEstimator().estimateVideoTokens(specsOf("480p", "16:9"), 10L, 1);

        assertThat(tokens).isEqualTo(97_200L);
        assertThat(tokens).isEqualTo(48_600L * 2);
    }

    @Nested
    @DisplayName("取不到就说取不到：不兜别的档位、不按 0 算")
    class 取不到 {

        @Test
        @DisplayName("规格里没有冻结的输出宽高 → null（预扣推不出，调用方按「契约量取不到」处理）")
        void 缺宽高() {
            assertThat(officialEstimator().estimateVideoTokens(
                    Map.of("resolution", "1080p", "aspect_ratio", "21:9"), 5L, 1))
                    .isNull();
        }

        @Test
        @DisplayName("规格里压根没有 resolution（比如新建的模型还没配像素表）→ null")
        void 缺档位() {
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

            assertThat(engine.compute(request, Usage.contractFrom(rule(), specs),
                    java.time.LocalDateTime.now()).credits()).isEqualTo(57L);
        }

        @Test
        @DisplayName("结算：按 worker 上报的**上游真实 token** 计价，估算值不参与")
        void 结算用真值() {
            PricingRequest request = new PricingRequest(1L, "m", "video",
                    Map.of("resolution", "720p", "aspect_ratio", "16:9", "video", "0"), "free");
            PricingEngine engine = PricingEngine.forMedia((modelId, taskType) -> rule(), DiscountResolver.NONE);

            Usage upstream = Usage.ofKeys("m", "video",
                    Map.of("usage.c", 216_900L, "usage.succeededSlots", 1L));

            assertThat(engine.compute(request, upstream, java.time.LocalDateTime.now()).credits())
                    .isEqualTo(120L);
        }

        @Test
        @DisplayName("含视频输入：单价按规则里的另一档（330,000 mc/百万 token）走")
        void 含视频输入单价() {
            PricingRequest request = new PricingRequest(1L, "m", "video",
                    Map.of("resolution", "720p", "aspect_ratio", "16:9", "video", "1"), "free");
            PricingEngine engine = PricingEngine.forMedia((modelId, taskType) -> rule(), DiscountResolver.NONE);

            assertThat(engine.compute(request,
                    Usage.ofKeys("m", "video", Map.of("usage.c", 216_900L)),
                    java.time.LocalDateTime.now()).credits()).isEqualTo(72L);
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

        private static final String W = "1248";
        private static final String H = "704";

        @Test
        @DisplayName("★ 含视频输入：输入时长加进公式（5s 输出 + 5s 输入 = 10s 的量）")
        void 输入时长进公式() {
            TokenEstimator estimator = CatalogCompiler.compileRuleSnapshot(RULE_20).tokenEstimator();

            assertThat(estimator.estimateVideoTokens(
                    Map.of("resolution", "720p", "aspect_ratio", "16:9",
                            "output_width", W, "output_height", H, "video", "0"), 5L, 1))
                    .isEqualTo(102_960L);
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
            assertThatThrownBy(() -> Usage.contractFrom(rule, Map.of(
                    "resolution", "720p", "aspect_ratio", "16:9",
                    "output_width", W, "output_height", H,
                    "video", "1", "duration", "5", "expected_output_count", "1")))
                    .isInstanceOf(Usage.ContractQuantityUnavailableException.class);
        }

        @Test
        @DisplayName("★ 没配 inputSecondsKey 的规则不受影响（那一项压根不加，也不会因此被拒）")
        void 未配输入时长项则不加() {
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

            assertThatThrownBy(() -> engine.compute(request, contract, java.time.LocalDateTime.now()))
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

            CompiledRule priced = CatalogCompiler.compileRuleSnapshot(RULE_25
                    .replace("\"kind\": \"unset\", \"by\": [\"video\"]",
                            "\"kind\": \"table\", \"table\": { \"video=0\": 1234000 }"));
            PricingEngine engine = PricingEngine.forMedia((m, t) -> priced, DiscountResolver.NONE);

            assertThat(engine.compute(request, Usage.contractFrom(priced, specs),
                    java.time.LocalDateTime.now()).credits()).isEqualTo(127L);
        }
    }

    @Nested
    @DisplayName("最低 token 用量（官方明文规则：含视频输入时，估算 < 下限 ⇒ 按下限计费）")
    class 最低token用量 {

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

        private static final long FORMULA_5S = 48_600L;

        private static final String W = "864";
        private static final String H = "480";

        private static Map<String, String> withVideoInput(String duration) {
            return Map.of("resolution", "480p", "aspect_ratio", "16:9",
                    "output_width", W, "output_height", H,
                    "video", "1", "duration", duration, "video_input_seconds", duration);
        }

        @Test
        @DisplayName("★ 含视频输入且估算 < 下限 → 按下限计（官方：按最低 token 用量计算视频价格）")
        void 估算低于下限按下限() {
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
            assertThat(engine.compute(request, contract, java.time.LocalDateTime.now()).credits())
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
        assertThat(new TokenEstimator(1024, 24, null, Map.of()).minimumTokens()).isEmpty();
        assertThatThrownBy(() -> new TokenEstimator(1024, 24, null, Map.of("resolution=480p", 0L)))
                .hasMessageContaining("必须为正");
        assertThatThrownBy(() -> new TokenEstimator.Dimensions(0, 480))
                .hasMessageContaining("宽高必须为正");
    }
}
