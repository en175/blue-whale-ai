package com.bluewhale.billing.application.command;

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
 * @param title       展示文案快照（「视频生成 · seedance-2.5 1080p 5s」）。
 *                    随预扣冻进预留，用户流水直接展示——提交后模型改名或文案规则变化
 *                    都不该改写历史流水，所以存快照而不是引用
 * @param submittedAt ★ 计价时刻。**必须由调用方在入口取一次**，不能在深处各自取
 *                    {@code Instant.now()}——那会让「同一请求内的时间」出现多个值，
 *                    而它同时决定营销活动是否命中与批次过期判定
 * @param ruleSnapshot ★ 本条规则的**快照**（JSON 文本，形态 = 能力行的
 *                    {@code generation_model_capability.pricing} 那一列）。
 *                    规则本身住在模型能力行，billing 读不到那个库
 *                    （ADR-0114 不共享库），所以由属主在 Hold 时一并送来，
 *                    冻进预留——结算于是不必回读任何东西。
 *                    <p>⚠️ **必填**：空 = 这次交易算不出价，**直接拒单**（没有可回落的地方）。
 *                    <p>⚠️ 带上了就必须**编译得过**——编不过同样当场拒单（理由见
 *                    {@code BillingApplicationService#requireSnapshot}）。
 */
public record HoldCommand(
        long userId,
        String commandId,
        long jobId,
        String modelId,
        String taskType,
        Map<String, String> specs,
        String tier,
        String title,
        Instant submittedAt,
        String ruleSnapshot
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
        // 文案只是展示，缺了不该拦住一次预扣：统一成空串，库里只有一种「没提供」写法
        title = title == null ? "" : title;
        // 「没带快照」也统一成空串（而不是 null）：往下只有一处判据（isBlank），
        // 两种写法就得判两次，而漏判一次就是「拿一份没有规则的东西去算价」
        ruleSnapshot = ruleSnapshot == null ? "" : ruleSnapshot;
    }
}
