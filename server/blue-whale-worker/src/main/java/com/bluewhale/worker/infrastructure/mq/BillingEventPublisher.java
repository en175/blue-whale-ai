package com.bluewhale.worker.infrastructure.mq;

import org.slf4j.LoggerFactory;

/**
 * billing 事件的发布端口（契约：{@code contracts/proto/billing/v1/events.proto}）。
 *
 * <p>与 {@link GenerationMessageProducer} 分开：那个是**生成队列**（jobId + 延迟，
 * 用来驱动下一步），这个是**领域事件**（主题 + 载荷，发给 billing 做结算/返还）。
 * 两件事的语义、重投策略、消费方都不同，塞进一个接口会让调用处只能靠参数猜。
 *
 * <p>⚠️ 发布失败**必须抛出来**，由调用方决定怎么办。**本接口不吞异常**——
 * 静默失败会让一笔冻结永远没人处理。至于「抛出来之后要不要回滚」是调用方的判断，
 * 见 {@code JobSettlementPublisher} 的类注释（结论：不回滚终态，只亮 ERROR）。
 */
public interface BillingEventPublisher {

    /**
     * 发布一条领域事件。
     *
     * @param topic billing 消费的 topic（{@code generation.job.completed} / {@code ...failed}）
     * @param body  JSON 载荷，字段见 {@code events.proto}
     */
    void publish(String topic, String body);

    /**
     * 未接线时的空实现：本地没配 MQ 时不该让任务本身跑不起来。
     *
     * <p>放在接口上而不是 RocketMQ 实现上——「不发」跟 RocketMQ 没有任何关系，
     * 挂在实现类上会让人以为换一个实现就没有这个选项了。
     */
    static BillingEventPublisher noop() {
        return (topic, body) ->
                LoggerFactory.getLogger(BillingEventPublisher.class)
                        .debug("billing 事件未接线，丢弃：topic={} body={}", topic, body);
    }
}
