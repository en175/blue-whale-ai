package com.bluewhale.worker.infrastructure.mq;

import org.slf4j.LoggerFactory;

public interface BillingEventPublisher {

    void publish(String topic, String body);

    static BillingEventPublisher noop() {
        return (topic, body) ->
                LoggerFactory.getLogger(BillingEventPublisher.class)
                        .debug("billing 事件未接线，丢弃：topic={} body={}", topic, body);
    }
}
