package com.bluewhale.worker.infrastructure.mq;

import org.apache.rocketmq.client.apis.ClientConfiguration;
import org.apache.rocketmq.client.apis.ClientServiceProvider;
import org.apache.rocketmq.client.apis.producer.Producer;
import org.apache.rocketmq.client.apis.message.Message;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.nio.charset.StandardCharsets;

/**
 * RocketMQ 5.x 生产者实现（video-queue.ts:66-103 getStartedRocketMqProducer 逐字移植）。
 * <p>
 * 懒建 + 启动失败重置（与 TS 单例同构）。
 * 发送消息：topic + tag + body={"jobId":"..."} + delayMs（video-queue.ts:56-61）。
 * <p>
 * delay 下限 1000ms（video-queue.ts:17 VIDEO_MIN_DELAY_MS）。
 */
public class RocketMqGenerationMessageProducer implements GenerationMessageProducer {

    private static final Logger log = LoggerFactory.getLogger(RocketMqGenerationMessageProducer.class);

    /** delay 下限（video-queue.ts:17）。 */
    static final long MIN_DELAY_MS = 1_000;

    private final Producer producer;
    private final String topic;
    private final String tag;

    public RocketMqGenerationMessageProducer(Producer producer, String topic, String tag) {
        this.producer = producer;
        this.topic = topic;
        this.tag = tag;
    }

    /**
     * 从 ClientConfiguration 构建 Producer（video-queue.ts:79-98）。
     */
    public static RocketMqGenerationMessageProducer create(
            ClientConfiguration clientConfig, String topic, String tag) {
        ClientServiceProvider provider = ClientServiceProvider.loadService();
        try {
            Producer producer = provider.newProducerBuilder()
                    .setClientConfiguration(clientConfig)
                    .build();
            return new RocketMqGenerationMessageProducer(producer, topic, tag);
        } catch (Exception e) {
            throw new IllegalStateException("RocketMQ Producer 创建失败: " + e.getMessage(), e);
        }
    }

    @Override
    public void enqueue(String jobId, long delayMs) {
        long effectiveDelay = Math.max(delayMs, MIN_DELAY_MS);

        String body = "{\"jobId\":\"" + jobId + "\"}";
        ClientServiceProvider provider = ClientServiceProvider.loadService();
        Message message = provider.newMessageBuilder()
                .setTopic(topic)
                .setTag(tag)
                .setBody(body.getBytes(StandardCharsets.UTF_8))
                .setDeliveryTimestamp(System.currentTimeMillis() + effectiveDelay)
                .build();

        try {
            producer.send(message);
        } catch (Exception e) {
            log.error("视频 MQ 消息发送失败 jobId={} delayMs={}: {}", jobId, effectiveDelay, e.getMessage());
            throw new RuntimeException("视频 MQ 消息发送失败: " + e.getMessage(), e);
        }
    }

    @Override
    public void close() {
        try {
            producer.close();
        } catch (Exception e) {
            log.warn("关闭 RocketMQ Producer 异常: {}", e.getMessage());
        }
    }
}
