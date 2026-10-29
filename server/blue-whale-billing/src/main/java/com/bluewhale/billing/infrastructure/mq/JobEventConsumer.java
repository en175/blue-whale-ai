package com.bluewhale.billing.infrastructure.mq;

import com.bluewhale.billing.application.CreditService;
import com.bluewhale.common.mq.MqEnvSuffix;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.apache.rocketmq.client.apis.ClientConfiguration;
import org.apache.rocketmq.client.apis.ClientServiceProvider;
import org.apache.rocketmq.client.apis.consumer.ConsumeResult;
import org.apache.rocketmq.client.apis.consumer.FilterExpression;
import org.apache.rocketmq.client.apis.consumer.PushConsumer;
import org.apache.rocketmq.client.apis.message.MessageView;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.Map;

public class JobEventConsumer implements AutoCloseable {

    private static final Logger log = LoggerFactory.getLogger(JobEventConsumer.class);

    private final PushConsumer consumer;
    private final CreditService credits;
    private final String terminalTopic;
    private final ObjectMapper json;

    public JobEventConsumer(ClientConfiguration clientConfiguration,
                            String consumerGroup,
                            String terminalTopic,
                            CreditService credits) throws Exception {
        this.credits = credits;
        this.terminalTopic = MqEnvSuffix.apply(terminalTopic);
        this.json = new ObjectMapper()
                .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

        String group = MqEnvSuffix.apply(consumerGroup);
        this.consumer = ClientServiceProvider.loadService()
                .newPushConsumerBuilder()
                .setClientConfiguration(clientConfiguration)
                .setConsumerGroup(group)
                .setSubscriptionExpressions(Map.of(
                        this.terminalTopic, new FilterExpression("*")))
                .setMessageListener(this::onMessage)
                .build();

        log.info("计费事件消费者已启动：group={} 订阅 {}", group, this.terminalTopic);
    }

    @Override
    public void close() {
        try {
            consumer.close();
        } catch (Exception e) {
            log.warn("计费事件消费者关闭异常", e);
        }
    }

    private ConsumeResult onMessage(MessageView message) {
        String topic = message.getTopic();
        String body = readBody(message);
        try {
            if (terminalTopic.equals(topic)) {
                JobEventPayload.JobTerminal event =
                        json.readValue(body, JobEventPayload.JobTerminal.class);
                requireIdentifiable(event.jobId(), event.userId(), topic, body);
                if (event.refund()) {
                    credits.refund(event.jobId(), event.reason());
                }
            } else {
                log.warn("收到未订阅的 topic，已丢弃：{}", topic);
            }
            return ConsumeResult.SUCCESS;
        } catch (Exception e) {
            log.error("处理计费事件失败，将重投：topic={} body={}", topic, body, e);
            return ConsumeResult.FAILURE;
        }
    }

    static void requireIdentifiable(long jobId, long userId, String topic, String body) {
        if (jobId <= 0 || userId <= 0) {
            throw new IllegalArgumentException(
                    "计费事件载荷缺少可识别的 jobId/userId（字段名对不上？）：jobId="
                            + jobId + " userId=" + userId + " topic=" + topic + " body=" + body);
        }
    }

    private static String readBody(MessageView message) {
        ByteBuffer buffer = message.getBody();
        byte[] bytes = new byte[buffer.remaining()];
        buffer.get(bytes);
        return new String(bytes, StandardCharsets.UTF_8);
    }
}
