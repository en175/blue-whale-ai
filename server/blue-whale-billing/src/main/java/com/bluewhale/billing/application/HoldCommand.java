package com.bluewhale.billing.application;

import java.time.Instant;
import java.util.Map;

/**
 * 预扣的输入（应用层类型）。
 *
 * <p>刻意与 proto 的 {@code HoldRequest} 分开：wire format 变化不该波及应用层，
 * 应用层也不该为 proto 的字段编号负责。转换在 gRPC 适配器里做。
 *
 * @param commandId   幂等键来源，**由客户端生成**——不是 jobId。
 *                    这样重试能发生在写 job 之前：Hold 成功但写 job 失败时重试命中幂等即可，
 *                    不需要跨服务补偿、也不会留下垃圾 job
 * @param tier        用户等级；空 = free。折扣解析用
 * @param submittedAt ★ 计价时刻。**必须由调用方在入口取一次**，不能在深处各自取
 *                    {@code Instant.now()}——那会让「同一请求内的时间」出现多个值，
 *                    而它同时决定营销活动是否命中与批次过期判定
 */
public record HoldCommand(
        long userId,
        String commandId,
        long jobId,
        String modelId,
        String taskType,
        Map<String, String> specs,
        String tier,
        Instant submittedAt
) {

    public HoldCommand {
        if (commandId == null || commandId.isBlank()) {
            throw new IllegalArgumentException("commandId 必填——它是幂等键的来源");
        }
        if (jobId <= 0) {
            throw new IllegalArgumentException("jobId 必须为正：" + jobId);
        }
        specs = specs == null ? Map.of() : Map.copyOf(specs);
        tier = tier == null || tier.isBlank() ? "free" : tier;
    }
}
