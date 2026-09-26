package com.bluewhale.billing.application.command;

import com.bluewhale.billing.domain.pricing.Usage;

import java.util.Map;

/**
 * 一条上报的用量（应用层类型）。
 *
 * <p>刻意与 {@code events.proto} 的 JSON 载荷分开，理由与 {@link HoldCommand} 同一条：
 * wire format 变化不该波及应用层。转换在 MQ 适配器（{@code JobEventConsumer}）里做。
 *
 * <p>worker **只报原始量，不报积分**——价格是 billing 的事。
 *
 * <p>⚠️ 归一化在**这里**（而不是消费者里）与 wire 记录同口径：{@code null} 与空集合
 * 都收敛成空集合，往下只有一处判据。
 *
 * @param modelId    模型（与 {@code taskType} 一起组成查规则的那把键）
 * @param taskType   任务类型
 * @param quantities 维度 → 数量。key 与 catalog 的 baseUnit/dims 用同一套封闭枚举
 *                   （见 {@code usage.proto}），也即 {@code UsageDim} 的 key
 * @param specs      规格，用于按轴查基准价
 */
public record SettlementUsageLine(
        String modelId,
        String taskType,
        Map<String, Long> quantities,
        Map<String, String> specs
) {

    public SettlementUsageLine {
        quantities = quantities == null ? Map.of() : Map.copyOf(quantities);
        specs = specs == null ? Map.of() : Map.copyOf(specs);
    }

    /**
     * 应用层入参 → 领域对象。
     *
     * <p>放在应用层入参上而不是某个消费者里：**同一份载荷的解析只有一处定义**。
     * 今天的入口只有 MQ 消费者，但重放工具、管理端补结算、测试夹具都要做同一个转换——
     * 放在消费侧就会出现几份略有差异的复制品，而它们的分叉表现是
     * 「同一份用量，某个入口少算了钱」。
     *
     * <p>（gRPC 的 {@code Quote} 有自己的 {@code Usage.ofKeys} 调用：它拿到的不是这份
     * 载荷，而是 proto 的 {@code UsageLine}。两条线各自落到同一个
     * {@link Usage#ofKeys}，那才是「键怎么解释」的唯一出口。）
     *
     * @throws com.bluewhale.billing.domain.pricing.UsageDim.UnknownUsageDimException
     *         出现封闭枚举之外的维度键——**拒绝，不忽略**：
     *         忽略一个维度就是少算一笔钱，而且没有任何信号
     */
    public Usage toUsage() {
        return Usage.ofKeys(modelId, taskType, quantities);
    }
}
