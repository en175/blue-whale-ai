package com.bluewhale.billing.domain.pricing;

import com.bluewhale.billing.application.CatalogCompiler;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.LocalDateTime;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class SeedAudioCharacterTierPricingTest {

    private static final String RULE_JSON = """
            {"baseUnit":"usage.characters",
             "basePrice":{"kind":"const","value":19000},
             "unitDenominator":100,
             "quantityStep":100,
             "rounding":"halfUp",
             "minCredits":1}
            """;

    private static final LocalDateTime T = LocalDateTime.parse("2026-10-22T16:00:00");

    private static final CompiledRule RULE = CatalogCompiler.compileRuleSnapshot(RULE_JSON);

    private static PricingEngine engine() {
        return PricingEngine.forMedia((model, task) -> RULE, DiscountResolver.NONE);
    }

    private static PricingRequest req() {
        return new PricingRequest(42L, "seed-audio-1.0", "audio", Map.of(), "free");
    }

    private static long settledWithCharacters(long characters) {
        Usage usage = Usage.ofKeys("seed-audio-1.0", "audio",
                Map.of("usage.characters", characters));
        return engine().compute(req(), usage, T).credits();
    }

    @Test
    @DisplayName("规则能编译：按字符、每 100 字一档、没有上限")
    void 规则可编译() {
        assertThat(RULE.baseUnit()).isEqualTo(UsageDim.CHARACTERS);
        assertThat(RULE.quantityStep()).isEqualTo(100L);
        assertThat(RULE.unitDenominator()).isEqualTo(100L);
        assertThat(RULE.maxCredits()).isNull();
    }

    @Test
    @DisplayName("★ 每 100 字一档向上取整：19 积分/档")
    void 分档边界() {
        assertThat(settledWithCharacters(1)).isEqualTo(19L);
        assertThat(settledWithCharacters(99)).isEqualTo(19L);
        assertThat(settledWithCharacters(100)).isEqualTo(19L);
        assertThat(settledWithCharacters(101)).isEqualTo(38L);
        assertThat(settledWithCharacters(199)).isEqualTo(38L);
        assertThat(settledWithCharacters(200)).isEqualTo(38L);
        assertThat(settledWithCharacters(2750)).isEqualTo(532L);
    }

    @Test
    @DisplayName("★ 提交时刻字数已知：不需要 maxCredits 也能算预扣")
    void 提交时刻可计算() {
        Usage usage = Usage.contractFrom(RULE, Map.of("prompt_characters", "101"));
        assertThat(engine().compute(req(), usage, T).credits()).isEqualTo(38L);
    }

    @Test
    @DisplayName("★ 参考图片/参考音频不额外收费")
    void 参考素材不上浮() {
        Usage usage = Usage.contractFrom(RULE, Map.of(
                "prompt_characters", "101",
                "reference_count", "4",
                "reference_seconds", "120",
                "image_reference", "1"));
        assertThat(engine().compute(req(), usage, T).credits()).isEqualTo(38L);
    }

    @Test
    @DisplayName("空文本只落到下限（正常提交由 prompt 必填挡住）")
    void 空文本兜下限() {
        assertThat(settledWithCharacters(0)).isEqualTo(1L);
    }

    @Test
    @DisplayName("没有上限，不能按上限计价")
    void 不按上限计价() {
        assertThatThrownBy(() -> engine().computeAtCap(req(), T))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
