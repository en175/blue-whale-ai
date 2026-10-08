package com.bluewhale.billing.domain.pricing;

import com.bluewhale.billing.application.CatalogCompiler;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class SeedAudioPerSecondPricingTest {

    private static final String RULE_JSON = """
            {"baseUnit":"usage.seconds",
             "basePrice":{"kind":"const","value":75},
             "unitDenominator":1,
             "minCredits":1,
             "maxCredits":12}
            """;

    private static final Instant T = Instant.parse("2026-09-26T15:00:00+08:00");

    private static final double OFFICIAL_YUAN_PER_MINUTE = 0.3;
    private static final double CREDITS_PER_YUAN = 15.0;

    private static final CompiledRule RULE = CatalogCompiler.compileRuleSnapshot(RULE_JSON);

    private static PricingEngine engine() {
        return PricingEngine.forMedia((model, task) -> RULE, DiscountResolver.NONE);
    }

    private static PricingRequest req() {
        return new PricingRequest(42L, "seed-audio-1.0", "audio", Map.of(), "free");
    }

    private static long settledWithSeconds(long seconds) {
        Usage usage = Usage.ofKeys("seed-audio-1.0", "audio", Map.of("usage.seconds", seconds));
        return engine().compute(req(), usage, T).credits();
    }

    private static double officialYuan(long seconds) {
        return OFFICIAL_YUAN_PER_MINUTE / 60.0 * seconds;
    }

    @Test
    @DisplayName("★ 规则文本本身能编译 —— 迁移里那段 JSON 不是脏配置")
    void 规则可编译() {
        assertThat(RULE.baseUnit()).isEqualTo(UsageDim.SECONDS);
        assertThat(RULE.maxCredits()).isEqualTo(12L);
    }

    @Test
    @DisplayName("★ 单价就是官方的 0.3 元/分钟：120 秒 = 0.6 元（整数积分为 9）")
    void 上限档与官方完全一致() {
        assertThat(settledWithSeconds(120)).isEqualTo(9L);
        assertThat(9L / CREDITS_PER_YUAN).isEqualTo(officialYuan(120));
    }

    @Test
    @DisplayName("★ 按真实秒数线性计费（不是按次 —— 这正是这次改动要修的那个错）")
    void 按时长线性变化() {
        assertThat(settledWithSeconds(120)).isGreaterThan(settledWithSeconds(60));
        assertThat(settledWithSeconds(60)).isGreaterThan(settledWithSeconds(30));
        assertThat(settledWithSeconds(30)).isEqualTo(2L);
    }

    @Test
    @DisplayName("★ 60 秒那一档与官方价逐一对齐（1 分钟 = 0.3 元 = 4.5 积分 → 进位 5）")
    void 一分钟档() {
        long credits = settledWithSeconds(60);
        assertThat(credits).isEqualTo(5L);
        assertThat(60L * 75.0 / 1000.0).isEqualTo(4.5);
    }

    @Test
    @DisplayName("★ 反推：我们自己实现的 mc/秒 × 60 ÷ 1000 ÷ 15 必须等于 0.3 元/分钟")
    void 单价换算回官方口径() {
        long mcPerSecond = 75L;
        double yuanPerMinute = mcPerSecond * 60.0 / 1000.0 / CREDITS_PER_YUAN;
        assertThat(yuanPerMinute).isEqualTo(OFFICIAL_YUAN_PER_MINUTE);
    }

    @Test
    @DisplayName("★ 极短音频被下限兜到 1 积分（货币粒度，不是配错）")
    void 极短音频兜下限() {
        assertThat(settledWithSeconds(3)).isEqualTo(1L);
        assertThat(RULE.minCredits()).isEqualTo(1L);
    }

    @Test
    @DisplayName("★ 超出上限的输出被 maxCredits 封顶（不会因为上游多吐几秒就超收）")
    void 封顶() {
        assertThat(settledWithSeconds(200)).isEqualTo(12L);
    }

    @Test
    @DisplayName("★ 提交时刻没有 duration → 契约量取不到（这正是 maxCredits 必须存在的原因）")
    void 提交时刻取不到契约量() {
        assertThatThrownBy(() -> Usage.contractFrom(RULE, Map.of()))
                .isInstanceOf(Usage.ContractQuantityUnavailableException.class)
                .hasMessageContaining("usage.seconds");

        assertThat(RULE.maxCredits()).isNotNull();
        assertThat(engine().computeAtCap(req(), T).credits()).isEqualTo(12L);
    }

    @Test
    @DisplayName("★ 预扣 ≥ 实收：官方整个取值区间内都不会出现「结算超出预扣」（那笔钱会记成应收=真少收）")
    void 预扣不小于实收() {
        long cap = engine().computeAtCap(req(), T).credits();
        for (long seconds = 1; seconds <= 120; seconds++) {
            assertThat(settledWithSeconds(seconds))
                    .as("第 %d 秒的实收超过了预扣上限 %d", seconds, cap)
                    .isLessThanOrEqualTo(cap);
        }
    }
}
