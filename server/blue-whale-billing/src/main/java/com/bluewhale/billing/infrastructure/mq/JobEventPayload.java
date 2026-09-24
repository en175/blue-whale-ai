package com.bluewhale.billing.infrastructure.mq;

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
 */
public final class JobEventPayload {

    private JobEventPayload() {
    }

    /**
     * {@code generation.job.completed} 的载荷 —— 触发**结算**。
     *
     * @param status         {@code succeeded} | {@code partially_succeeded}
     * @param catalogVersion ★ 提交时冻结的版本，billing 按它复现定价，不按当前版本
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
     * @param quantities 维度 → 数量。key 与 catalog 的 baseUnit/dims 用同一套封闭枚举
     *                   （见 {@code usage.proto}），也即 {@code UsageDim} 的 key
     * @param specs      规格，用于按轴查基准价
     */
    public record UsageLine(
            String modelId,
            String taskType,
            Map<String, Long> quantities,
            Map<String, String> specs,
            /**
             * 上游实际收**我们**的（mc）。毛利分析原料；影子对账时与
             * {@code upstream_user_credits} 是两个不同的数——别混。
             */
            Long upstreamCostCredits
    ) {
        public UsageLine {
            quantities = quantities == null ? Map.of() : Map.copyOf(quantities);
            specs = specs == null ? Map.of() : Map.copyOf(specs);
        }

        /**
         * wire → 领域对象。
         *
         * <p>放在这里而不是某个 service 里：这是**这份 wire 格式的转换**，
         * 谁解析它谁就需要它（MQ 消费者、gRPC 的 Quote）。
         * 放在 service 侧就会出现两份略有差异的复制品。
         *
         * @throws com.bluewhale.billing.pricing.UsageDim.UnknownUsageDimException
         *         出现封闭枚举之外的维度键——**拒绝，不忽略**：
         *         忽略一个维度就是少算一笔钱，而且没有任何信号
         */
        public com.bluewhale.billing.pricing.Usage toUsage() {
            return com.bluewhale.billing.pricing.Usage.ofKeys(modelId, taskType, quantities);
        }
    }

    /** {@code generation.job.failed} 的载荷 —— 触发**全额返还**。 */
    public record JobFailed(long jobId, long userId, String reason) {

        public JobFailed {
            reason = reason == null || reason.isBlank() ? "未提供原因" : reason;
        }
    }
}
