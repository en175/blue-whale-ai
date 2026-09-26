package com.bluewhale.billing.infrastructure.mq;

import com.bluewhale.billing.application.SettlementCommand;
import com.bluewhale.billing.application.SettlementService;
import com.bluewhale.billing.application.SettlementUsageLine;
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

    /**
     * wire → 应用层入参。**适配器的职责就是这个转换**——应用层不认识
     * {@link JobEventPayload}，那正是应用层类型存在的理由（见 {@link SettlementCommand}）。
     *
     * <p>逐字段搬运，不做判断、不丢字段：这里一旦有「顺手处理一下」的逻辑，
     * 它就落在了一个没有领域概念的地方，而且只在 MQ 入口生效——
     * 换个入口（重放工具、管理端补结算、测试夹具）就绕过去了。
     *
     * <p>归一化（空集合收敛、维度键 → {@code UsageDim}）在应用层类型上，不在这里重复一遍：
     * 两份归一迟早在某个维度上分叉，而分叉的表现是少算一笔钱。
     *
     * <p>包私有而非 private：这条缝是「JSON 形状对不对」唯一被钉住的地方，
     * 要能被测试直接调（见 {@code JobEventConsumerMappingTest}），与下面的守卫同一立场。
     */
    static SettlementCommand toCommand(JobEventPayload.JobCompleted event) {
        return new SettlementCommand(
                event.jobId(), event.userId(), event.status(), event.catalogVersion(),
                event.succeededSlots(),
                event.usage().stream().map(JobEventConsumer::toUsageLine).toList());
    }

    /** 一条用量行的搬运；转换动作在 {@link SettlementUsageLine#toUsage()} 那边。 */
    private static SettlementUsageLine toUsageLine(JobEventPayload.UsageLine line) {
        return new SettlementUsageLine(
                line.modelId(), line.taskType(), line.quantities(), line.specs());
    }

    /**
     * 载荷里必须有可识别的 jobId / userId —— 否则**重投，不要当成功处理**。
     *
     * <h2>这个守卫防的是一次实测复现过的静默失败</h2>
     *
     * Jackson 对**对不上的字段名**不报错，它填默认值。于是生产者把 camelCase 写成
     * snake_case 时，反序列化出的对象是 {@code jobId=0, userId=0, usage=null} ——
     * 看起来完全正常。接下来：{@code settle} 按 {@code jobId=0} 查预留，查不到，
     * 打一句 INFO「无待结算预留」就返回；方法正常结束，于是本类返回 {@code SUCCESS}，
     * 消息被 **ack**。
     *
     * <p>结果：那笔预扣**永远冻着**，消息既不会重投也不会进死信，
     * 日志里连一条 WARN 都没有。这正是本类注释自称要防的那种失败，
     * 只是入口不是「异常」而是「字段名」。
     *
     * <p>所以这里把它变成**重投**：进死信队列会亮红灯，而红灯有人看得见。
     *
     * @throws IllegalArgumentException 载荷里没有可识别的身份
     */
    // 包私有而非 private：守卫本身要能被测试直接钉住（见 JobEventConsumerGuardTest）
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
