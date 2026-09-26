package com.bluewhale.billing.adapter.inbound.mq;

import java.util.List;
import java.util.Map;

/**
 * MQ 事件的 JSON 形态（契约见 {@code contracts/proto/billing/v1/events.proto}）。
 *
 * <p>⚠️ <b>与 proto 是两份东西，必须同步演进。</b>proto 描述的是消息的**语义**，
 * 这里是它在 MQ 上的**实际编码**（JSON，与仓内其它 MQ 消息一致；protobuf 二进制
 * 会让 NestJS 侧的生产者多一道编解码，收益是省几百字节）。
 *
 * <p>字段名与 proto 一致（camelCase），这样从任一侧看过去都是同一套名字。
 *
 * <p>⚠️ <b>本类是纯 wire 形态，不含领域转换。</b>它绑定的是 JSON 的形状，
 * 也只被 MQ 适配器（{@link JobEventConsumer}）读——应用层看到的是
 * {@code com.bluewhale.billing.application.command.SettlementCommand}，
 * 映射在消费者里做。把转换放在这里会让应用层被迫 import 本包。
 */
public final class JobEventPayload {

    private JobEventPayload() {
    }

    /**
     * {@code generation-job-completed} 的载荷 —— 触发**结算**。
     *
     * @param status         {@code succeeded} | {@code partially_succeeded}
     * @param catalogVersion ★ 提交时冻结的版本，随事件送来留痕；**复现定价读的是预留行上的值**，
     *                       不是这里的（见 {@code SettlementService#rulesAtHoldTime}）
     * @param succeededSlots 成功的输出槽数（图片多张 / 视频多段）。本版本只用于留痕与告警
     */
    public record JobCompleted(
            long jobId,
            long userId,
            String status,
            int catalogVersion,
            int succeededSlots,
            List<UsageLine> usage
    ) {
        public JobCompleted {
            usage = usage == null ? List.of() : List.copyOf(usage);
        }
    }

    /**
     * 一条用量。**worker 只报原始量，不报积分**——价格是 billing 的事。
     *
     * <p>⚠️ 它的领域转换（{@code toUsage()}）不在这里，在应用层类型
     * {@code SettlementUsageLine} 上——理由见那个方法，以及本类类注释。
     *
     * @param quantities 维度 → 数量。key 与 catalog 的 baseUnit/dims 用同一套封闭枚举
     *                   （见 {@code usage.proto}），也即 {@code UsageDim} 的 key
     * @param specs      规格，用于按轴查基准价
     */
    public record UsageLine(
            String modelId,
            String taskType,
            Map<String, Long> quantities,
            Map<String, String> specs
    ) {
        public UsageLine {
            quantities = quantities == null ? Map.of() : Map.copyOf(quantities);
            specs = specs == null ? Map.of() : Map.copyOf(specs);
        }
    }

    /** {@code generation-job-failed} 的载荷 —— 触发**全额返还**。 */
    public record JobFailed(long jobId, long userId, String reason) {

        public JobFailed {
            reason = reason == null || reason.isBlank() ? "未提供原因" : reason;
        }
    }
}
