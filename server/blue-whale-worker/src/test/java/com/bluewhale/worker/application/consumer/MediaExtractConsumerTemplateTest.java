package com.bluewhale.worker.application.consumer;

import com.bluewhale.worker.domain.error.MediaExtractError;

import com.bluewhale.worker.application.processor.JobProcessor;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

class MediaExtractConsumerTemplateTest {

    private MediaExtractConsumer buildTestConsumer(JobProcessor processor) {
        return new MediaExtractConsumer(processor, "test-topic", null, "test-group", 2);
    }

    @Test
    @DisplayName("毒丸：坏 JSON → ack（返回 true）")
    void poisonPill_badJson() {
        JobProcessor processor = mock(JobProcessor.class);
        var consumer = buildTestConsumer(processor);

        assertThat(consumer.processBody("not json".getBytes())).isTrue();
        assertThat(consumer.processBody("{}".getBytes())).isTrue();
        assertThat(consumer.processBody("{\"jobId\":\"\"}".getBytes())).isTrue();
        assertThat(consumer.processBody("{\"jobId\":null}".getBytes())).isTrue();
        assertThat(consumer.processBody("{\"jobId\":42}".getBytes())).isTrue();

        verify(processor, never()).handle(any());
    }

    @Test
    @DisplayName("digitGuard=false：非数字 jobId 不被拒（extract 不做纯数字守卫）")
    void extract_noDigitGuard() {
        JobProcessor processor = mock(JobProcessor.class);
        var consumer = buildTestConsumer(processor);

        boolean result = consumer.processBody("{\"jobId\":\"abc-123\"}".getBytes());

        assertThat(result).isTrue();
        verify(processor).handle("abc-123");
    }

    @Test
    @DisplayName("handler 成功 → ack（返回 true）")
    void handlerSuccess_shouldAck() {
        JobProcessor processor = mock(JobProcessor.class);
        doNothing().when(processor).handle("42");
        var consumer = buildTestConsumer(processor);

        boolean result = consumer.processBody("{\"jobId\":\"42\"}".getBytes());

        assertThat(result).isTrue();
        verify(processor).handle("42");
    }

    @Test
    @DisplayName("handler 抛错 → 不 ack（返回 false，broker 30s 重投）")
    void handlerThrows_noAck() {
        JobProcessor processor = mock(JobProcessor.class);
        doThrow(new RuntimeException("DB error")).when(processor).handle("42");
        var consumer = buildTestConsumer(processor);

        boolean result = consumer.processBody("{\"jobId\":\"42\"}".getBytes());

        assertThat(result).isFalse();
        verify(processor).handle("42");
    }

    @Test
    @DisplayName("handler 抛 MediaExtractError → 不 ack（与 RuntimeException 一致）")
    void handlerThrowsMediaExtractError_noAck() {
        JobProcessor processor = mock(JobProcessor.class);
        doThrow(new com.bluewhale.worker.domain.error.MediaExtractError(
                "extract_failed", "ffmpeg error"
        )).when(processor).handle("42");
        var consumer = buildTestConsumer(processor);

        boolean result = consumer.processBody("{\"jobId\":\"42\"}".getBytes());

        assertThat(result).isFalse();
    }
}
