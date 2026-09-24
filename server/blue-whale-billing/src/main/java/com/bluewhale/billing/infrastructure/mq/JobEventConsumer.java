package com.bluewhale.billing.infrastructure.mq;

import com.bluewhale.billing.application.SettlementService;
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

/**
 * 结算 / 返还的 MQ 消费者（topic 见 {@code contracts/proto/billing/v1/events.proto}）。
 *
 * <h2>为什么这两件事走 MQ 而不是 RPC</h2>
 *
 * 它们**不该阻塞任何用户请求**，而且必须能重投——一次结算失败（billing 正在滚动发布、
 * 数据库瞬时不可用）不该让一笔钱永远冻着。RPC 的回调语义做不到这一点：
 * 调用方失败了要自己记得重试，而「记得重试」正是最容易丢的东西。
 *
 * <h2>消费语义</h2>
 *
 * <ul>
 *   <li><b>至少一次投递</b>：重复到达是常态。落点
 *       （{@code CreditService.settle/refund}）各自带幂等键，
 *       且预留状态机保证第二条到达时是无操作。</li>
 *   <li><b>失败一律重投</b>：包括「算不出价」「目录版本读不回来」这类看起来重试无用的错。
 *       它们确实需要人工介入，但**重投到死信队列才是最不会被忽略的信号**；
 *       若这里吞掉返回成功，钱就永远冻着，而且没有任何地方会亮红灯。</li>
 * </ul>
 *
 * <p>⚠️ RocketMQ 5 的 {@code PushConsumer} **没有 start()**——{@code build()} 那一刻
 * 就已经开始拉消息了，它只实现 {@link AutoCloseable}。所以本类不提供 start，
 * 由 {@code destroyMethod = "close"} 收口。写成 {@code initMethod = "start"} 会编译不过，
 * 而装作「有 start 只是空实现」会让人误以为消息是在 start 之后才开始消费的。
 */
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
        // 容忍未知字段：生产者先加字段、billing 后升级时不该直接崩
        this.json = new ObjectMapper()
                .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

        this.consumer = ClientServiceProvider.loadService()
                .newPushConsumerBuilder()
                .setClientConfiguration(clientConfiguration)
                .setConsumerGroup(consumerGroup)
                // 一个消费者订阅两个 topic：它们共享同一个消费逻辑（都是「解的冻结」），
                // 拆成两个消费者只会多一份 group、多一处配置要对。
                .setSubscriptionExpressions(Map.of(
                        completedTopic, new FilterExpression("*"),
                        failedTopic, new FilterExpression("*")))
                .setMessageListener(this::onMessage)
                .build();

        // build() 即开始消费（RocketMQ 5 的 PushConsumer 没有 start()）
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
                settlement.settle(json.readValue(body, JobEventPayload.JobCompleted.class));
            } else if (failedTopic.equals(topic)) {
                JobEventPayload.JobFailed event =
                        json.readValue(body, JobEventPayload.JobFailed.class);
                settlement.refund(event.jobId(), event.reason());
            } else {
                // 订阅之外的 topic 不该出现；出现说明配置串了，直接丢弃而不是重投，
                // 否则一条永远处理不了的消息会把队列堵死
                log.warn("收到未订阅的 topic，已丢弃：{}", topic);
            }
            return ConsumeResult.SUCCESS;
        } catch (Exception e) {
            // ⚠️ 返回 FAILURE 触发重投（最终进死信队列）。**不要在这里吞异常返回 SUCCESS**：
            //    那会让这笔钱永远冻着，却没有任何红灯亮起。
            log.error("处理计费事件失败，将重投：topic={} body={}", topic, body, e);
            return ConsumeResult.FAILURE;
        }
    }

    private static String readBody(MessageView message) {
        ByteBuffer buffer = message.getBody();
        byte[] bytes = new byte[buffer.remaining()];
        buffer.get(bytes);
        return new String(bytes, StandardCharsets.UTF_8);
    }
}
