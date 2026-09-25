package com.bluewhale.billing.infrastructure.mq;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 载荷可识别性守卫。
 *
 * <p>钉的是一次**实测复现过的静默失败**：Jackson 对**对不上的字段名**不报错，它填默认值。
 * 生产者把 camelCase 写成 snake_case 时，反序列化出的对象是
 * {@code jobId=0, userId=0} —— 看起来完全正常。接着 {@code settle} 按 {@code jobId=0}
 * 查预留，查不到，打一句 INFO「无待结算预留」就返回，于是消费者返回 {@code SUCCESS}，
 * 消息被 ack：**那笔预扣永远冻着，既不重投也不进死信，日志里连一条 WARN 都没有。**
 *
 * <p>抛出去之后，{@code onMessage} 的 catch 会把它变成 {@code FAILURE} —— 重投到死信，
 * 而红灯有人看得见。
 */
class JobEventConsumerGuardTest {

    /** 调用守卫，返回它抛出的异常消息；没抛就返回 null。 */
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
