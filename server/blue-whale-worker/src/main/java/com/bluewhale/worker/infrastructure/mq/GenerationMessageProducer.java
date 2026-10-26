package com.bluewhale.worker.infrastructure.mq;

public interface GenerationMessageProducer {

    void enqueue(String jobId, long delayMs);

    void close();
}
