package com.bluewhale.common.mq;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class MqEnvSuffixTest {

    @Test
    @DisplayName("未配置后缀时名称逐字不变")
    void 无后缀保持原名() {
        assertThat(MqEnvSuffix.apply("generation-task", null)).isEqualTo("generation-task");
        assertThat(MqEnvSuffix.apply("generation-task", "")).isEqualTo("generation-task");
        assertThat(MqEnvSuffix.apply("generation-task", "   ")).isEqualTo("generation-task");
    }

    @Test
    @DisplayName("配置后缀时拼接为 <名称>-<后缀>，容忍带前导连字符的写法")
    void 有后缀拼接() {
        assertThat(MqEnvSuffix.apply("generation-task", "dev")).isEqualTo("generation-task-dev");
        assertThat(MqEnvSuffix.apply("generation-video-worker", " dev "))
                .isEqualTo("generation-video-worker-dev");
        assertThat(MqEnvSuffix.apply("generation-task", "-dev")).isEqualTo("generation-task-dev");
    }

    @Test
    @DisplayName("后缀含非法字符时直接报错，不产出 RocketMQ 不接受的名字")
    void 非法后缀报错() {
        assertThatThrownBy(() -> MqEnvSuffix.apply("generation-task", "dev env"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("MQ_ENV_SUFFIX");
        assertThatThrownBy(() -> MqEnvSuffix.apply("generation-task", "dev.1"))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
