package com.bluewhale.worker.infrastructure.storage;

import com.volcengine.tos.transport.TransportConfig;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.Map;
import java.util.function.Function;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * TOS 传输层超时配置（IKFS5W）：默认放宽 + env 覆盖 + 非法值快速失败。
 */
class TosTransportConfigTest {

    private static Function<String, String> env(Map<String, String> values) {
        return values::get;
    }

    @Test
    @DisplayName("未设置 env 时用放宽后的默认值（读/写 5min，建链 30s）")
    void defaultsWhenEnvMissing() {
        TransportConfig config = TosTransportConfig.from(env(Map.of()));

        assertThat(config.getConnectTimeoutMills()).isEqualTo(30_000);
        assertThat(config.getReadTimeoutMills()).isEqualTo(300_000);
        assertThat(config.getWriteTimeoutMills()).isEqualTo(300_000);
    }

    @Test
    @DisplayName("env 覆盖单项，未覆盖项保持默认")
    void envOverridesSingleKey() {
        TransportConfig config = TosTransportConfig.from(env(Map.of("TOS_READ_TIMEOUT_MS", "600000")));

        assertThat(config.getReadTimeoutMills()).isEqualTo(600_000);
        assertThat(config.getConnectTimeoutMills()).isEqualTo(30_000);
    }

    @Test
    @DisplayName("空白值退回默认，不抛错")
    void blankFallsBackToDefault() {
        TransportConfig config = TosTransportConfig.from(env(Map.of("TOS_CONNECT_TIMEOUT_MS", "   ")));

        assertThat(config.getConnectTimeoutMills()).isEqualTo(30_000);
    }

    @Test
    @DisplayName("非整数或非正数 → 抛错（配置错误不静默吞掉）")
    void invalidValueFailsFast() {
        assertThatThrownBy(() -> TosTransportConfig.from(env(Map.of("TOS_READ_TIMEOUT_MS", "abc"))))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("TOS_READ_TIMEOUT_MS");
        assertThatThrownBy(() -> TosTransportConfig.from(env(Map.of("TOS_WRITE_TIMEOUT_MS", "0"))))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("TOS_WRITE_TIMEOUT_MS");
    }
}
