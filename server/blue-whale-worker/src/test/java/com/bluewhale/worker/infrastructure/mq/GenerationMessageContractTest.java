package com.bluewhale.worker.infrastructure.mq;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/**
 * 契约文档 §1（消息契约）的可执行切片。
 * TS 生产端若改动消息形状，本测试必须在同一次双侧评审中同步改动——
 * 这就是 IKEL4L 承诺的契约测试门。
 */
class GenerationMessageContractTest {

    @Test
    void 标准体可解析() {
        GenerationMessage msg = GenerationMessage.parse(
                "{\"jobId\":\"42\"}".getBytes(), false);
        assertThat(msg).isNotNull();
        assertThat(msg.jobId()).isEqualTo("42");
    }

    @Test
    void 未知字段容忍与TS解析行为一致() {
        GenerationMessage msg = GenerationMessage.parse(
                "{\"jobId\":\"42\",\"futureField\":true}".getBytes(), false);
        assertThat(msg).isNotNull();
        assertThat(msg.jobId()).isEqualTo("42");
    }

    @Test
    void 毒丸体判空供调用方ack丢弃() {
        assertThat(GenerationMessage.parse("not json".getBytes(), false)).isNull();
        assertThat(GenerationMessage.parse("{}".getBytes(), false)).isNull();
        assertThat(GenerationMessage.parse("{\"jobId\":\"\"}".getBytes(), false)).isNull();
        assertThat(GenerationMessage.parse("{\"jobId\":null}".getBytes(), false)).isNull();
    }

    @Test
    void 数字型jobId必须视为毒丸对齐TS的typeof字符串判定() {
        // Jackson 默认强转 42 → "42"，曾在此漂移；禁止回退到 readValue 直解。
        assertThat(GenerationMessage.parse("{\"jobId\":42}".getBytes(), false)).isNull();
    }

    @Test
    void 纯数字守卫仅image与audio消费组启用() {
        assertThat(GenerationMessage.parse("{\"jobId\":\"abc\"}".getBytes(), true)).isNull();
        assertThat(GenerationMessage.parse("{\"jobId\":\"abc\"}".getBytes(), false)).isNotNull();
    }

    @Test
    void 序列化形状与TS生产端一致() {
        assertThat(GenerationMessage.encode("42")).isEqualTo("{\"jobId\":\"42\"}");
    }
}
