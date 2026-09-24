package com.bluewhale.worker.infrastructure.mq;

import org.apache.rocketmq.client.apis.ClientConfiguration;
import org.apache.rocketmq.client.apis.ClientServiceProvider;
import org.apache.rocketmq.client.apis.producer.Producer;
import org.apache.rocketmq.client.apis.message.Message;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.nio.charset.StandardCharsets;

/**
 * RocketMQ 实现（rocketmq-client-java 5.x）。
 *
 * <p>一个 Producer 实例可发多个 topic，所以在构造时建一次、之后按调用传入 topic。
 * 这与生成队列那边的生产者（一个实例绑一个 topic/tag）不同——那个的 topic 是从路由表派生的。
 */
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
            // ⚠️ 不吞：调用方需要知道结算事件有没有发出去。这里包成非受检异常往上抛。
            throw new IllegalStateException(
                    "billing 事件发送失败 topic=" + topic + "：" + e.getMessage(), e);
        }
    }

    /** 与生成队列生产者同款收口。 */
    public void close() {
        try {
            producer.close();
        } catch (Exception e) {
            log.warn("billing 事件生产者关闭异常", e);
        }
    }

}
