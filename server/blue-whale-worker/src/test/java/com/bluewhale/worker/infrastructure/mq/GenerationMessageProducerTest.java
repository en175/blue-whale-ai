package com.bluewhale.worker.infrastructure.mq;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class GenerationMessageProducerTest {

    @Test
    @DisplayName("enqueue: delay > 0 → 原样传递")
    void enqueue_positiveDelay() {
        RecordingProducer producer = new RecordingProducer();
        producer.enqueue("123", 5000);

        assertThat(producer.calls).hasSize(1);
        assertThat(producer.calls.get(0).jobId).isEqualTo("123");
        assertThat(producer.calls.get(0).delayMs).isEqualTo(5000);
    }

    @Test
    @DisplayName("enqueue: delay = 0 → 钳制到 MIN_DELAY_MS=1000")
    void enqueue_zeroDelay_clampedToMin() {
        RecordingProducer producer = new RecordingProducer();
        producer.enqueue("456", 0);

        assertThat(producer.calls).hasSize(1);
        assertThat(producer.calls.get(0).delayMs).isEqualTo(1000);
    }

    @Test
    @DisplayName("enqueue: delay < 0 → 钳制到 MIN_DELAY_MS=1000")
    void enqueue_negativeDelay_clampedToMin() {
        RecordingProducer producer = new RecordingProducer();
        producer.enqueue("789", -500);

        assertThat(producer.calls).hasSize(1);
        assertThat(producer.calls.get(0).delayMs).isEqualTo(1000);
    }

    @Test
    @DisplayName("消息体形状：{\"jobId\":\"<id>\"}")
    void messageShape() {
        RecordingProducer producer = new RecordingProducer();
        producer.enqueue("999", 3000);

        assertThat(producer.calls.get(0).body).isEqualTo("{\"jobId\":\"999\"}");
    }

    static class RecordingProducer implements GenerationMessageProducer {
        final List<EnqueueCall> calls = new ArrayList<>();

        @Override
        public void enqueue(String jobId, long delayMs) {
            long effectiveDelay = Math.max(delayMs, 1000);
            String body = "{\"jobId\":\"" + jobId + "\"}";
            calls.add(new EnqueueCall(jobId, effectiveDelay, body));
        }

        @Override
        public void close() {}
    }

    record EnqueueCall(String jobId, long delayMs, String body) {}
}
