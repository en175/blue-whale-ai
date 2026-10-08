package com.bluewhale.billing.adapter.inbound.mq;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class JobEventConsumerGuardTest {

    private static String guard(long jobId, long userId) {
        try {
            JobEventConsumer.requireIdentifiable(jobId, userId, "generation-job-completed", "{}");
            return null;
        } catch (IllegalArgumentException e) {
            return e.getMessage();
        }
    }

    @Test
    @DisplayName("★ jobId 为 0 时抛错 —— 这是「字段名对不上」唯一能被抓到的信号")
    void jobId为零即抛() {
        assertThat(guard(0L, 42L)).contains("jobId");
    }

    @Test
    @DisplayName("★ userId 为 0 时抛错")
    void userId为零即抛() {
        assertThat(guard(7L, 0L)).contains("userId");
    }

    @Test
    @DisplayName("负数也拦 —— 反序列化出的默认值不一定是 0")
    void 负数也拦() {
        assertThat(guard(-1L, 42L)).isNotNull();
    }

    @Test
    @DisplayName("正常载荷放行")
    void 正常载荷放行() {
        assertThat(guard(801L, 42L)).isNull();
    }
}
