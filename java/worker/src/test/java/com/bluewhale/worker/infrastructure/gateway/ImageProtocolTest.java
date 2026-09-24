package com.bluewhale.worker.infrastructure.gateway;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * {@link ImageProtocol#fromWire} 契约测试（IKF4LI 评审 Important#1）。
 * <p>
 * 关键契约：**认不出就返回 null，不兜底**。「没配」与「配错」必须能被调用方区分开——
 * 兜底成 inline-image 会把配置错误咽成静默降级，回落决策与 WARN 留给
 * {@code ImageChannelMapper.parseImageProtocol}。
 */
class ImageProtocolTest {

    @Test
    @DisplayName("已注册字面值 → 对应枚举，且大小写不敏感、容忍首尾空白")
    void recognizesRegisteredValues() {
        assertThat(ImageProtocol.fromWire("openai-images")).isEqualTo(ImageProtocol.OPENAI_IMAGES);
        assertThat(ImageProtocol.fromWire("  Openai-Images  ")).isEqualTo(ImageProtocol.OPENAI_IMAGES);
        assertThat(ImageProtocol.fromWire("INLINE-IMAGE")).isEqualTo(ImageProtocol.INLINE_IMAGE);
        assertThat(ImageProtocol.fromWire("inline-image")).isEqualTo(ImageProtocol.INLINE_IMAGE);
    }

    @Test
    @DisplayName("缺省 / 空白 / 非字符串 → null（不兜底，由调用方决定回落）")
    void unrecognizedValuesReturnNull() {
        assertThat(ImageProtocol.fromWire(null)).isNull();
        assertThat(ImageProtocol.fromWire("")).isNull();
        assertThat(ImageProtocol.fromWire("   ")).isNull();
        assertThat(ImageProtocol.fromWire("openai_image")).isNull(); // 典型手滑：下划线
        assertThat(ImageProtocol.fromWire("随便写的")).isNull();
    }

    @Test
    @DisplayName("字面值与能力行配置一致（改枚举名必须同步改迁移与契约 §12.2）")
    void wireValuesAreStable() {
        assertThat(ImageProtocol.OPENAI_IMAGES.wireValue()).isEqualTo("openai-images");
        assertThat(ImageProtocol.INLINE_IMAGE.wireValue()).isEqualTo("inline-image");
    }
}
