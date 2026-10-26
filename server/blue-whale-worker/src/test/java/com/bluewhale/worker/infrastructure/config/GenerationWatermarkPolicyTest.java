package com.bluewhale.worker.infrastructure.config;

import com.bluewhale.worker.infrastructure.config.GenerationWatermarkConfig.GenerationWatermarkPolicy;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;

class GenerationWatermarkPolicyTest {

    @Test
    @DisplayName("读的键固定为 system_settings.watermark")
    void readsFixedSettingKey() {
        AtomicReference<String> seen = new AtomicReference<>();
        GenerationWatermarkPolicy policy = new GenerationWatermarkPolicy(key -> {
            seen.set(key);
            return null;
        });

        assertThat(policy.enabled()).isFalse();
        assertThat(seen.get()).isEqualTo("watermark");
    }

    @Test
    @DisplayName("enabled=true → 开启")
    void enabledTrue() {
        GenerationWatermarkPolicy policy =
                new GenerationWatermarkPolicy(key -> "{\"enabled\":true}");
        assertThat(policy.enabled()).isTrue();
    }

    @Test
    @DisplayName("enabled=false → 关闭")
    void enabledFalse() {
        GenerationWatermarkPolicy policy =
                new GenerationWatermarkPolicy(key -> "{\"enabled\":false}");
        assertThat(policy.enabled()).isFalse();
    }

    @Test
    @DisplayName("缺行 → 关闭")
    void missingRowIsDisabled() {
        assertThat(new GenerationWatermarkPolicy(key -> null).enabled()).isFalse();
        assertThat(new GenerationWatermarkPolicy(key -> "  ").enabled()).isFalse();
    }

    @Test
    @DisplayName("字段缺失 / 类型不是布尔 → 关闭（上游只认 true）")
    void malformedFieldIsDisabled() {
        assertThat(new GenerationWatermarkPolicy(key -> "{}").enabled()).isFalse();
        assertThat(new GenerationWatermarkPolicy(key -> "{\"enabled\":\"true\"}").enabled()).isFalse();
        assertThat(new GenerationWatermarkPolicy(key -> "{\"enabled\":1}").enabled()).isFalse();
    }

    @Test
    @DisplayName("坏 JSON → 关闭，不阻断生成")
    void brokenJsonIsDisabled() {
        assertThat(new GenerationWatermarkPolicy(key -> "{not-json").enabled()).isFalse();
    }

    @Test
    @DisplayName("读库异常 → 关闭，不阻断生成")
    void readFailureIsDisabled() {
        GenerationWatermarkPolicy policy = new GenerationWatermarkPolicy(key -> {
            throw new IllegalStateException("db down");
        });
        assertThat(policy.enabled()).isFalse();
    }
}
