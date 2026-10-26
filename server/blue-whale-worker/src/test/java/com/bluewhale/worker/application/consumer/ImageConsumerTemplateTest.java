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

@ExtendWith(MockitoExtension.class)
class ImageConsumerTemplateTest {

    @Mock
    private JobProcessor processor;

    private ImageConsumer consumer;

    @BeforeEach
    void setUp() {
        consumer = new ImageConsumer(processor, "test-topic", null, "test-group", 20);
    }

    @Test
    @DisplayName("digitGuard=true: 纯数字 jobId → 正常派发")
    void digitGuard_validDigits() {
        String body = "{\"jobId\":\"12345\"}";
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);

        boolean shouldAck = consumer.processBody(bytes);

        assertThat(shouldAck).isTrue();
        verify(processor).handle("12345");
    }

    @Test
    @DisplayName("digitGuard=true: 非纯数字 jobId → ack 丢弃毒丸")
    void digitGuard_nonDigitPoisonPill() {
        String body = "{\"jobId\":\"abc-def\"}";
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);

        boolean shouldAck = consumer.processBody(bytes);

        assertThat(shouldAck).isTrue();
        verify(processor, never()).handle(anyString());
    }

    @Test
    @DisplayName("digitGuard=true: jobId 含字母 → ack 丢弃毒丸")
    void digitGuard_mixedCharsPoisonPill() {
        String body = "{\"jobId\":\"123abc\"}";
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);

        boolean shouldAck = consumer.processBody(bytes);

        assertThat(shouldAck).isTrue();
        verify(processor, never()).handle(anyString());
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
