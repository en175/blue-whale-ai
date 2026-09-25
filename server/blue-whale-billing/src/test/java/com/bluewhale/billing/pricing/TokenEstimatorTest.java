package com.bluewhale.billing.pricing;

import com.bluewhale.billing.catalog.CatalogCompiler;
import com.bluewhale.billing.catalog.CatalogDocument;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import java.util.LinkedHashMap;
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
 * 断言我们算出来的是同一批数——公式、除数、帧率、宽高映射任何一处编错，这里都会红。
 *
 * <pre>
 *   token ≈ 输出宽 × 输出高 × 输出帧率 × 输出时长 ÷ 1024      （24fps，官方对照表）
 * </pre>
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
     * 官方对照表：{@code 档位|比例|宽|高|5s|10s}。
     *
     * <p>值取自火山方舟视频生成计费文档的 24fps 对照表（本单的输入证据）。
     */
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
        Map<String, String> specs = Map.of("resolution", tier, "aspect_ratio", ratio);

        assertThat(estimator.estimateVideoTokens(specs, seconds, 1))
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
        Long tokens = officialEstimator().estimateVideoTokens(
                Map.of("resolution", "480p", "aspect_ratio", "16:9"), 10L, 1);

        assertThat(tokens).isEqualTo(97_200L);
        // 与官方 5 秒格的关系：正是它的一倍
        assertThat(tokens).isEqualTo(48_600L * 2);
    }

    @Nested
    @DisplayName("取不到就说取不到：不兜别的档位、不按 0 算")
    class 取不到 {

        @Test
        @DisplayName("档位 + 比例这一组合没配 → null（预扣推不出，调用方按「契约量取不到」处理）")
        void 缺尺寸组合() {
            assertThat(officialEstimator().estimateVideoTokens(
                    Map.of("resolution", "1080p", "aspect_ratio", "21:9"), 5L, 1))
                    .isNull();
        }

        @Test
        @DisplayName("adaptive 比例（首帧/编辑任务，输出跟随输入）→ null")
        void 自适应比例() {
            assertThat(officialEstimator().estimateVideoTokens(
                    Map.of("resolution", "720p", "aspect_ratio", "adaptive"), 5L, 1))
                    .isNull();
        }

        @Test
        @DisplayName("时长未知（duration=-1 的自动时长传进来是 null）→ null，绝不按 0 估")
        void 时长未知() {
            assertThat(officialEstimator().estimateVideoTokens(
                    Map.of("resolution", "720p", "aspect_ratio", "16:9"), null, 1))
                    .isNull();
        }

        @Test
        @DisplayName("规格里压根没有 resolution → null")
        void 缺档位() {
            assertThat(officialEstimator().estimateVideoTokens(
                    Map.of("aspect_ratio", "16:9"), 5L, 1))
                    .isNull();
        }
    }

    @Test
    @DisplayName("片段数按乘数生效（官方公式的「× 片段数」）")
    void 片段数() {
        TokenEstimator estimator = officialEstimator();

        assertThat(estimator.estimateVideoTokens(
                Map.of("resolution", "480p", "aspect_ratio", "16:9"), 5L, 2))
                .isEqualTo(48_600L * 2);
    }

    @Nested
    @DisplayName("目录 JSON → 契约量 → 计价：整条链路")
    class 整条链路 {

        /**
         * 一份最小视频目录 —— 参数全在 JSON 里（公式的除数、帧率、宽高映射、单价都不在代码里）。
         *
         * <p>单价 555,000 mc / 百万 token = 37 元/百万 token × 15 积分/元 × 1000 mc/积分，
         * 即火山官方 doubao-seedance-2-0-fast「无视频输入」档。
         */
        private static final String DOC = """
                {
                  "schemaVersion": 1,
                  "currency": "CNY",
                  "creditsPerYuan": 15,
                  "models": {
                    "doubao-seedance-2-0-fast-260128": {
                      "video": {
                        "baseUnit": "usage.c",
                        "basePrice": { "kind": "table", "table": {
                            "video=0": 555000,
                            "video=1": 330000
                        } },
                        "unitDenominator": 1000000,
                        "minCredits": 1,
                        "tokenEstimate": {
                          "divisor": 1024,
                          "fps": 24,
                          "dimensions": {
                            "resolution=480p|aspect_ratio=16:9": "864x480",
                            "resolution=720p|aspect_ratio=16:9": "1248x704",
                            "resolution=1080p|aspect_ratio=16:9": "1920x1088"
                          }
                        }
                      }
                    }
                  }
                }
                """;

        private static CompiledRule rule() {
            return CatalogCompiler.compile(parse(DOC))
                    .get("doubao-seedance-2-0-fast-260128/video");
        }

        @Test
        @DisplayName("预扣：契约量是**估**出来的官方 token 数，不是 0、也不是别的档位")
        void 预扣用估算() {
            Usage contract = Usage.contractFrom(rule(), Map.of(
                    "resolution", "720p", "aspect_ratio", "16:9",
                    "duration", "5", "expected_output_count", "1",
                    "video", "0"));

            assertThat(contract.quantityOf(UsageDim.COMPLETION_TOKENS)).isEqualTo(102_960L);
        }

        @Test
        @DisplayName("预扣价 = 官方 token × 官方单价（720p 16:9 5s → 102,960 token → 57 积分）")
        void 预扣价() {
            PricingRequest request = new PricingRequest(1L,
                    "doubao-seedance-2-0-fast-260128", "video",
                    Map.of("resolution", "720p", "aspect_ratio", "16:9",
                            "duration", "5", "expected_output_count", "1",
                            "video", "0"),
                    "free");
            PricingEngine engine = PricingEngine.forMedia((modelId, taskType) -> rule(), DiscountResolver.NONE);

            // 102,960 token × 555,000 mc / 1,000,000 = 57,142.8 mc → 57 积分
            assertThat(engine.compute(request, Usage.contractFrom(rule(), request.specs()),
                    java.time.Instant.now()).credits()).isEqualTo(57L);
        }

        @Test
        @DisplayName("结算：按 worker 上报的**上游真实 token** 计价，估算值不参与")
        void 结算用真值() {
            PricingRequest request = new PricingRequest(1L,
                    "doubao-seedance-2-0-fast-260128", "video",
                    Map.of("resolution", "720p", "aspect_ratio", "16:9",
                            "video", "0"),
                    "free");
            PricingEngine engine = PricingEngine.forMedia((modelId, taskType) -> rule(), DiscountResolver.NONE);

            // 实测：720p 16:9 带音频，上游报 216,900（估算是 205,920）——结算按真值走
            Usage upstream = Usage.ofKeys("doubao-seedance-2-0-fast-260128", "video",
                    Map.of("usage.c", 216_900L, "usage.succeededSlots", 1L));

            // 216,900 × 555,000 / 1,000,000 = 120,379.5 mc → 120 积分
            assertThat(engine.compute(request, upstream, java.time.Instant.now()).credits())
                    .isEqualTo(120L);
        }

        @Test
        @DisplayName("含视频输入：单价按目录里的另一档（330,000 mc/百万 token）走")
        void 含视频输入单价() {
            PricingRequest request = new PricingRequest(1L,
                    "doubao-seedance-2-0-fast-260128", "video",
                    Map.of("resolution", "720p", "aspect_ratio", "16:9",
                            "video", "1"),
                    "free");
            PricingEngine engine = PricingEngine.forMedia((modelId, taskType) -> rule(), DiscountResolver.NONE);

            // 216,900 × 330,000 / 1,000,000 = 71,577 mc → 72 积分
            assertThat(engine.compute(request,
                    Usage.ofKeys("doubao-seedance-2-0-fast-260128", "video",
                            Map.of("usage.c", 216_900L)),
                    java.time.Instant.now()).credits()).isEqualTo(72L);
        }

        @Test
        @DisplayName("目录没配 tokenEstimate → 推理不出契约量（拒绝，而不是按 0 冻下限）")
        void 没配估算参数() {
            CompiledRule noEstimate = new CompiledRule(
                    UsageDim.COMPLETION_TOKENS, new BasePriceResolver.Constant(555_000L),
                    Map.of(), Map.of(), 1_000_000L, 1L, null, new RoundingPolicy.HalfUp(), null);

            assertThatThrownBy(() -> Usage.contractFrom(noEstimate, Map.of(
                    "resolution", "720p", "aspect_ratio", "16:9", "duration", "5")))
                    .isInstanceOf(Usage.ContractQuantityUnavailableException.class);
        }
    }

    @Nested
    @DisplayName("编译期校验：半配的估算会算出「像那么回事」的数，所以发布即拒")
    class 编译期校验 {

        @Test
        @DisplayName("缺 divisor / fps / 空尺寸表 → 整份拒绝")
        void 半配拒绝() {
            assertThatThrownBy(() -> compileWith("\"tokenEstimate\": {\"fps\": 24, \"dimensions\": {\"resolution=480p\": \"864x480\"}}"))
                    .hasMessageContaining("divisor");
            assertThatThrownBy(() -> compileWith("\"tokenEstimate\": {\"divisor\": 1024, \"dimensions\": {\"resolution=480p\": \"864x480\"}}"))
                    .hasMessageContaining("fps");
            assertThatThrownBy(() -> compileWith("\"tokenEstimate\": {\"divisor\": 1024, \"fps\": 24, \"dimensions\": {}}"))
                    .hasMessageContaining("dimensions");
        }

        @Test
        @DisplayName("尺寸值不是 宽x高 → 拒绝（不能等到某次预扣才发现）")
        void 尺寸值非法() {
            assertThatThrownBy(() -> compileWith("\"tokenEstimate\": {\"divisor\": 1024, \"fps\": 24, \"dimensions\": {\"resolution=480p\": \"864*480\"}}"))
                    .hasMessageContaining("宽x高");
        }

        @Test
        @DisplayName("两个键规范化后等价（大小写/空白不同）→ 拒绝，不静默覆盖")
        void 等价键拒绝() {
            assertThatThrownBy(() -> compileWith("\"tokenEstimate\": {\"divisor\": 1024, \"fps\": 24, "
                    + "\"dimensions\": {\"resolution=480p\": \"864x480\", \" Resolution = 480P \": \"640x640\"}}"))
                    .hasMessageContaining("等价键");
        }

        @Test
        @DisplayName("inputSecondsKey 是空白串 → 拒绝（配了个查不到的键，比不配更坏）")
        void 输入时长键空白拒绝() {
            assertThatThrownBy(() -> compileWith("\"tokenEstimate\": {\"divisor\": 1024, \"fps\": 24, "
                    + "\"dimensions\": {\"resolution=480p\": \"864x480\"}, \"inputSecondsKey\": \"  \"}}"))
                    .hasMessageContaining("inputSecondsKey");
        }

        @Test
        @DisplayName("★ 单价待配（kind=unset）**编译得过** —— 它是空位，不是非法配置")
        void 单价待配编译得过() {
            // 关键区别：空位允许**整份目录发布**（否则运营连别处都改不了），
            // 拒绝发生在计价那一刻（见下面「单价待配」那组用例）。
            CompiledRule rule = CatalogCompiler.compile(parse("""
                    {
                      "schemaVersion": 1, "currency": "CNY", "creditsPerYuan": 15,
                      "models": { "m": { "video": {
                        "baseUnit": "usage.c",
                        "basePrice": { "kind": "unset", "by": ["video"] },
                        "unitDenominator": 1000000
                      } } }
                    }
                    """)).get("m/video");

            assertThat(rule.basePrice()).isInstanceOf(BasePriceResolver.Unset.class);
        }

        @Test
        @DisplayName("未知 basePrice.kind → 拒绝（错误信息列出合法值）")
        void 未知kind拒绝() {
            assertThatThrownBy(() -> CatalogCompiler.compile(parse("""
                    {
                      "schemaVersion": 1, "currency": "CNY", "creditsPerYuan": 15,
                      "models": { "m": { "video": {
                        "baseUnit": "usage.c",
                        "basePrice": { "kind": "free" },
                        "unitDenominator": 1000000
                      } } }
                    }
                    """)))
                    .hasMessageContaining("合法值：const | table | unset");
        }

        private static CompiledRule compileWith(String tokenEstimateJson) {
            String doc = """
                    {
                      "schemaVersion": 1, "currency": "CNY", "creditsPerYuan": 15,
                      "models": { "m": { "video": {
                        "baseUnit": "usage.c",
                        "basePrice": { "kind": "const", "value": 555000 },
                        "unitDenominator": 1000000,
                        %s
                      } } }
                    }
                    """.formatted(tokenEstimateJson);
            return CatalogCompiler.compile(parse(doc)).get("m/video");
        }
    }

    @Nested
    @DisplayName("含视频输入的输入时长、单价待配（unset）、以及 2.5 与 2.0 同公式不同单价")
    class 视频输入与单价空位 {

        /**
         * 2.0 与 2.5 两条规则：**同一套 tokenEstimate**（同一个公式、同一张官方尺寸表），
         * 只有单价不同 —— 「计费方式相同、单价不同」在目录里天然就是两条规则，不必另造机制。
         *
         * <p>⚠️ 2.5 的单价火山**没有给**，所以这里写的是 {@code unset}（待运营填的空位）——
         * 下面那条 1,234,000 只出现在**测试夹具**里，用来证明「同一张表换个单价就换出另一个价」，
         * **不是**我们给 2.5 定的价（目录里它是空位，提交即拒）。
         */
        private static final String DOC = """
                {
                  "schemaVersion": 1,
                  "currency": "CNY",
                  "creditsPerYuan": 15,
                  "models": {
                    "seedance-2.0": {
                      "video": {
                        "baseUnit": "usage.c",
                        "basePrice": { "kind": "table", "table": {
                            "video=0": 555000,
                            "video=1": 330000
                        } },
                        "unitDenominator": 1000000,
                        "minCredits": 1,
                        "tokenEstimate": {
                          "divisor": 1024,
                          "fps": 24,
                          "inputSecondsKey": "video_input_seconds",
                          "dimensions": {
                            "resolution=720p|aspect_ratio=16:9": "1248x704"
                          }
                        }
                      }
                    },
                    "seedance-2.5": {
                      "video": {
                        "baseUnit": "usage.c",
                        "basePrice": { "kind": "unset", "by": ["video"] },
                        "unitDenominator": 1000000,
                        "minCredits": 1,
                        "tokenEstimate": {
                          "divisor": 1024,
                          "fps": 24,
                          "inputSecondsKey": "video_input_seconds",
                          "dimensions": {
                            "resolution=720p|aspect_ratio=16:9": "1248x704"
                          }
                        }
                      }
                    }
                  }
                }
                """;

        private static Map<String, CompiledRule> catalog() {
            return CatalogCompiler.compile(parse(DOC));
        }

        @Test
        @DisplayName("★ 含视频输入：输入时长加进公式（5s 输出 + 5s 输入 = 10s 的量）")
        void 输入时长进公式() {
            CompiledRule rule = catalog().get("seedance-2.0/video");

            // 官方口径：无视频输入时输入时长按 0 计，所以 video=0 那档仍是 102,960
            assertThat(rule.tokenEstimator().estimateVideoTokens(
                    Map.of("resolution", "720p", "aspect_ratio", "16:9", "video", "0"), 5L, 1))
                    .isEqualTo(102_960L);
            // 含视频输入：输入 5s + 输出 5s = 10s 的量 = 205,920
            assertThat(rule.tokenEstimator().estimateVideoTokens(
                    Map.of("resolution", "720p", "aspect_ratio", "16:9",
                            "video", "1", "video_input_seconds", "5"), 5L, 1))
                    .isEqualTo(205_920L);
        }

        @Test
        @DisplayName("★ 含视频输入却量不到输入时长 → 取不到（不按 0 估、不静默少冻）")
        void 量不到输入时长不按零估() {
            CompiledRule rule = catalog().get("seedance-2.0/video");

            assertThat(rule.tokenEstimator().estimateVideoTokens(
                    Map.of("resolution", "720p", "aspect_ratio", "16:9", "video", "1"), 5L, 1))
                    .isNull();
            // 走完整链路：契约量取不到 → 拒绝（该规则没配 maxCredits，没有上限可依）
            assertThatThrownBy(() -> Usage.contractFrom(rule, Map.of(
                    "resolution", "720p", "aspect_ratio", "16:9",
                    "video", "1", "duration", "5", "expected_output_count", "1")))
                    .isInstanceOf(Usage.ContractQuantityUnavailableException.class);
        }

        @Test
        @DisplayName("★ 没配 inputSecondsKey 的规则不受影响（那一项压根不加，也不会因此被拒）")
        void 未配输入时长项则不加() {
            // 向后兼容：老目录没写 inputSecondsKey，含视频输入的任务照旧估得出来（只是偏低）
            CompiledRule legacy = CatalogCompiler.compile(parse("""
                    {
                      "schemaVersion": 1, "currency": "CNY", "creditsPerYuan": 15,
                      "models": { "m": { "video": {
                        "baseUnit": "usage.c",
                        "basePrice": { "kind": "const", "value": 555000 },
                        "unitDenominator": 1000000,
                        "tokenEstimate": {
                          "divisor": 1024, "fps": 24,
                          "dimensions": { "resolution=720p|aspect_ratio=16:9": "1248x704" }
                        }
                      } } }
                    }
                    """)).get("m/video");

            assertThat(legacy.tokenEstimator().estimateVideoTokens(
                    Map.of("resolution", "720p", "aspect_ratio", "16:9", "video", "1"), 5L, 1))
                    .isEqualTo(102_960L);
        }

        @Test
        @DisplayName("★ 单价待配（unset）：规则在目录里、token 也估得出，但**计价必拒**（不是按 0 免费）")
        void 单价待配拒绝计价() {
            CompiledRule rule = catalog().get("seedance-2.5/video");

            // 估算本身是好的（2.5 与 2.0 用的是同一张官方尺寸表）
            assertThat(rule.tokenEstimator().estimateVideoTokens(
                    Map.of("resolution", "720p", "aspect_ratio", "16:9", "video", "0"), 5L, 1))
                    .isEqualTo(102_960L);

            PricingRequest request = new PricingRequest(1L, "seedance-2.5", "video",
                    Map.of("resolution", "720p", "aspect_ratio", "16:9",
                            "duration", "5", "expected_output_count", "1", "video", "0"),
                    "free");
            PricingEngine engine = PricingEngine.forMedia((m, t) -> rule, DiscountResolver.NONE);
            Usage contract = Usage.contractFrom(rule, request.specs());

            assertThatThrownBy(() -> engine.compute(request, contract, java.time.Instant.now()))
                    .isInstanceOf(BasePriceResolver.UnpriceableSpecException.class)
                    .hasMessageContaining("单价");
        }

        @Test
        @DisplayName("★ 同一张尺寸表、不同单价 → 同一个 token 数换出不同的价（2.5 要的「单价可设」）")
        void 同公式不同单价() {
            Map<String, String> specs = Map.of("resolution", "720p", "aspect_ratio", "16:9",
                    "duration", "5", "expected_output_count", "1", "video", "0");
            PricingRequest request = new PricingRequest(1L, "m", "video", specs, "free");

            // 夹具：2.5 的规则把单价换成 1,234,000（**只是夹具**，目录里 2.5 是 unset 空位）
            CompiledRule priced = CatalogCompiler.compile(parse(DOC
                    .replace("\"kind\": \"unset\", \"by\": [\"video\"]",
                            "\"kind\": \"table\", \"table\": { \"video=0\": 1234000 }")))
                    .get("seedance-2.5/video");
            PricingEngine engine = PricingEngine.forMedia((m, t) -> priced, DiscountResolver.NONE);

            // 102,960 × 1,234,000 / 1,000,000 = 127,052.64 mc → 127 积分
            assertThat(engine.compute(request, Usage.contractFrom(priced, specs),
                    java.time.Instant.now()).credits()).isEqualTo(127L);
        }
    }

    /**
     * 目录 JSON → {@link CatalogDocument}。
     *
     * <p>与 {@code CatalogRepository} 用同一套 Jackson 配置（{@code FAIL_ON_UNKNOWN_PROPERTIES=false}）
     * ——测试里的解析口径与生产线一致，否则「测试绿、线上拒」。
     */
    private static final ObjectMapper JSON = new ObjectMapper()
            .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

    static CatalogDocument parse(String doc) {
        try {
            return JSON.readValue(doc, CatalogDocument.class);
        } catch (Exception e) {
            throw new IllegalArgumentException("测试目录 JSON 解析失败：" + e.getMessage(), e);
        }
    }

    /** 官方对照表的估算器：参数与官方一致（1024 / 24fps），尺寸表取官方文档给的那些。 */
    static TokenEstimator officialEstimator() {
        Map<String, String> dims = new LinkedHashMap<>();
        // 480p
        dims.put("resolution=480p|aspect_ratio=16:9", "864x480");
        dims.put("resolution=480p|aspect_ratio=4:3", "736x544");
        dims.put("resolution=480p|aspect_ratio=1:1", "640x640");
        dims.put("resolution=480p|aspect_ratio=21:9", "960x416");
        // 720p
        dims.put("resolution=720p|aspect_ratio=16:9", "1248x704");
        dims.put("resolution=720p|aspect_ratio=4:3", "1120x832");
        dims.put("resolution=720p|aspect_ratio=1:1", "960x960");
        // 1080p / 4k
        dims.put("resolution=1080p|aspect_ratio=16:9", "1920x1088");
        dims.put("resolution=4k|aspect_ratio=16:9", "3840x2160");
        return TokenEstimator.from(OFFICIAL_DIVISOR, OFFICIAL_FPS, dims);
    }

    @Test
    @DisplayName("估算器本身拒绝非法参数（编译期就炸，不进运行期）")
    void 构造校验() {
        Map<String, TokenEstimator.Dimensions> dims =
                Map.of("resolution=480p", new TokenEstimator.Dimensions(864, 480));

        assertThatThrownBy(() -> new TokenEstimator(0, 24, dims))
                .hasMessageContaining("divisor");
        assertThatThrownBy(() -> new TokenEstimator(1024, 0, dims))
                .hasMessageContaining("fps");
        assertThatThrownBy(() -> new TokenEstimator(1024, 24, Map.of()))
                .hasMessageContaining("尺寸表");
        assertThatThrownBy(() -> TokenEstimator.Dimensions.parse("864"))
                .hasMessageContaining("宽x高");
        assertThatThrownBy(() -> TokenEstimator.Dimensions.parse("宽x高"))
                .hasMessageContaining("不是整数");
        assertThatThrownBy(() -> new TokenEstimator.Dimensions(0, 480))
                .hasMessageContaining("宽高必须为正");
    }
}
