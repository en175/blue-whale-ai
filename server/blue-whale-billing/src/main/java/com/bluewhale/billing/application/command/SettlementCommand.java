package com.bluewhale.billing.application.command;

import java.util.List;

/**
 * 结算的输入（应用层类型）。
 *
 * <p>刻意与 MQ 载荷 {@code JobEventPayload.JobCompleted} 分开，理由与
 * {@link HoldCommand} / {@link QuoteQuery} 是同一条：**wire format 变化不该波及应用层**。
 * gRPC 路径一直是这么做的（入参是 {@code HoldCommand}/{@code QuoteQuery}，proto 转换留在
 * 适配器），MQ 路径过去没有——{@link com.bluewhale.billing.application.SettlementService#settle} 直接吃
 * {@code infrastructure.mq} 的 record，于是换一种 MQ 编码就要改应用层的 import，
 * 而且第三个入口（重放工具、管理端补结算、测试夹具）得先伪造一个
 * {@code infrastructure.mq} 的对象才能调进来。转换改在适配器
 * （{@code JobEventConsumer}）里做。
 *
 * <p>字段与 wire 记录一一对应，一个不少：本类型是**事件在应用层的完整视图**，
 * 不只是「这次方法体读到的几个字段」——收窄它会让将来第二个消费方又回去读 wire 类型。
 *
 * @param status         {@code succeeded} | {@code partially_succeeded}。结算不看它取价，
 *                       只用来区分「空用量的降级」要不要告警（见 {@code SettlementService}）
 * @param catalogVersion ★ 提交时冻结的版本。**结算的权威来源是预留行**，这里的值只随事件
 *                       进来、供消费方留痕/追溯；应用层不拿它复现定价
 * @param succeededSlots 成功的输出槽数（图片多张 / 视频多段）。本版本只用于留痕与告警
 *                       ——**决定 actualCredits 的是 {@code usage} 里的实际量**，
 *                       不是这个标量
 * @param usage          用量。空 = worker 报不出用量，走「按预扣额结算」的降级路径
 */
public record SettlementCommand(
        long jobId,
        long userId,
        String status,
        int catalogVersion,
        int succeededSlots,
        List<SettlementUsageLine> usage
) {

    public SettlementCommand {
        // 与 wire 记录同口径：null 与空集合收敛成空集合
        usage = usage == null ? List.of() : List.copyOf(usage);
    }
}
