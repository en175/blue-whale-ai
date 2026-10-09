package com.bluewhale.worker.infrastructure.mq;

import org.apache.rocketmq.client.apis.ClientConfiguration;
import org.apache.rocketmq.client.apis.ClientServiceProvider;
import org.apache.rocketmq.client.apis.producer.Producer;
import org.apache.rocketmq.client.apis.message.Message;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.nio.charset.StandardCharsets;

public class RocketMqBillingEventPublisher implements BillingEventPublisher {

    private static final Logger log = LoggerFactory.getLogger(RocketMqBillingEventPublisher.class);

    private final Producer producer;
    private final ClientServiceProvider provider = ClientServiceProvider.loadService();

    private RocketMqBillingEventPublisher(Producer producer) {
        this.producer = producer;
    }

    public static RocketMqBillingEventPublisher create(ClientConfiguration clientConfig) {
        try {
            return new RocketMqBillingEventPublisher(
                    ClientServiceProvider.loadService().newProducerBuilder()
                            .setClientConfiguration(clientConfig)
                            .build());
        } catch (Exception e) {
            throw new IllegalStateException("billing 事件生产者创建失败: " + e.getMessage(), e);
        }
    }

    @Override
    public void publish(String topic, String body) {
        Message message = provider.newMessageBuilder()
                .setTopic(topic)
                .setBody(body.getBytes(StandardCharsets.UTF_8))
                .build();
        try {
            producer.send(message);
        } catch (Exception e) {
            throw new IllegalStateException(
                    "billing 事件发送失败 topic=" + topic + "：" + e.getMessage(), e);
        }
    }

    public void close() {
        try {
            producer.close();
        } catch (Exception e) {
            log.warn("billing 事件生产者关闭异常", e);
        }
    }

}
