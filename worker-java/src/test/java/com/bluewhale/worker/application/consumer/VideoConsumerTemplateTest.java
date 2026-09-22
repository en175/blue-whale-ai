package com.bluewhale.worker.application.consumer;

import com.bluewhale.worker.application.processor.JobProcessor;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.nio.charset.StandardCharsets;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

/**
 * 视频消费者模板测试（对齐 AudioConsumerTemplateTest）。
 * <p>
 * 验证 VideoConsumer 的 SEQUENTIAL 派发行为（rocketmq-video.consumer.ts:76-101）：
 * <ul>
 *   <li>tag = "video"</li>
 *   <li>digitGuard = false（视频不做纯数字守卫）</li>
 *   <li>毒丸 ack / handler 成功 ack / handler 抛错不 ack</li>
 * </ul>
 */
@ExtendWith(MockitoExtension.class)
class VideoConsumerTemplateTest {

    @Mock
    private JobProcessor processor;

    private VideoConsumer consumer;

    @BeforeEach
    void setUp() {
        consumer = new VideoConsumer(processor, "test-topic", null, "test-group");
    }

    @Test
    @DisplayName("tag = video")
    void tagIsVideo() {
        assertThat(VideoConsumer.TAG).isEqualTo("video");
    }

    @Test
    @DisplayName("digitGuard=false: 非纯数字 jobId 也正常派发")
    void noDigitGuard_nonDigitStillDispatched() {
        String body = "{\"jobId\":\"abc-def\"}";
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);

        boolean shouldAck = consumer.processBody(bytes);

        assertThat(shouldAck).isTrue();
        verify(processor).handle("abc-def");
    }

    @Test
    @DisplayName("digitGuard=false: 纯数字 jobId 正常派发")
    void noDigitGuard_validDigits() {
        String body = "{\"jobId\":\"12345\"}";
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);

        boolean shouldAck = consumer.processBody(bytes);

        assertThat(shouldAck).isTrue();
        verify(processor).handle("12345");
    }

    @Test
    @DisplayName("handler 抛错 → 不 ack（broker 30s 重投）")
    void handlerThrows_noAck() {
        String body = "{\"jobId\":\"99999\"}";
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);

        doThrow(new RuntimeException("DB error")).when(processor).handle("99999");

        boolean shouldAck = consumer.processBody(bytes);

        assertThat(shouldAck).isFalse();
    }

    @Test
    @DisplayName("不可解析 body → ack 丢弃毒丸")
    void unparseableBody_poisonPill() {
        byte[] bytes = "not json at all".getBytes(StandardCharsets.UTF_8);

        boolean shouldAck = consumer.processBody(bytes);

        assertThat(shouldAck).isTrue();
        verify(processor, never()).handle(anyString());
    }

    @Test
    @DisplayName("空 body → ack 丢弃毒丸")
    void emptyBody_poisonPill() {
        byte[] bytes = "{}".getBytes(StandardCharsets.UTF_8);

        boolean shouldAck = consumer.processBody(bytes);

        assertThat(shouldAck).isTrue();
        verify(processor, never()).handle(anyString());
    }
}
