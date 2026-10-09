package com.bluewhale.billing.adapter.inbound.mq;

import com.bluewhale.billing.application.command.SettlementCommand;
import com.bluewhale.billing.application.SettlementService;
import com.bluewhale.billing.application.command.SettlementUsageLine;
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
    private final SettlementService settlement;
    private final String completedTopic;
    private final String failedTopic;
    private final ObjectMapper json;

    public JobEventConsumer(ClientConfiguration clientConfiguration,
                            String consumerGroup,
                            String completedTopic,
                            String failedTopic,
                            SettlementService settlement) throws Exception {
        this.settlement = settlement;
        this.completedTopic = completedTopic;
        this.failedTopic = failedTopic;
        this.json = new ObjectMapper()
                .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

        this.consumer = ClientServiceProvider.loadService()
                .newPushConsumerBuilder()
                .setClientConfiguration(clientConfiguration)
                .setConsumerGroup(consumerGroup)
                .setSubscriptionExpressions(Map.of(
                        completedTopic, new FilterExpression("*"),
                        failedTopic, new FilterExpression("*")))
                .setMessageListener(this::onMessage)
                .build();

        log.info("计费事件消费者已启动：group={} 订阅 {} / {}",
                consumerGroup, completedTopic, failedTopic);
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
            if (completedTopic.equals(topic)) {
                JobEventPayload.JobCompleted event =
                        json.readValue(body, JobEventPayload.JobCompleted.class);
                requireIdentifiable(event.jobId(), event.userId(), topic, body);
                settlement.settle(toCommand(event));
            } else if (failedTopic.equals(topic)) {
                JobEventPayload.JobFailed event =
                        json.readValue(body, JobEventPayload.JobFailed.class);
                requireIdentifiable(event.jobId(), event.userId(), topic, body);
                settlement.refund(event.jobId(), event.reason());
            } else {
                log.warn("收到未订阅的 topic，已丢弃：{}", topic);
            }
            return ConsumeResult.SUCCESS;
        } catch (Exception e) {
            log.error("处理计费事件失败，将重投：topic={} body={}", topic, body, e);
            return ConsumeResult.FAILURE;
        }
    }

    static SettlementCommand toCommand(JobEventPayload.JobCompleted event) {
        return new SettlementCommand(
                event.jobId(), event.userId(), event.status(), event.catalogVersion(),
                event.succeededSlots(),
                event.usage().stream().map(JobEventConsumer::toUsageLine).toList());
    }

    private static SettlementUsageLine toUsageLine(JobEventPayload.UsageLine line) {
        return new SettlementUsageLine(
                line.modelId(), line.taskType(), line.quantities(), line.specs());
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
