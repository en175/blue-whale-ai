package com.bluewhale.billing.application;

import com.bluewhale.billing.pricing.Usage;

import java.time.Instant;
import java.util.Map;

/**
 * 单条计价查询（应用层类型）—— **只算不扣**。
 *
 * <p>用途有两个，都是「不该碰钱」的场景：
 * <ul>
 *   <li><b>影子模式</b>（runbook §3.2）：切换前每天算一遍，与 new-api 实际扣的比对</li>
 *   <li><b>价格预览</b>：前端在用户点提交前告诉他大概多少钱</li>
 * </ul>
 * 两者都不该走 {@code Hold}——那会真的冻结积分，几千次影子计算就是几千笔
 * 冻了又退的流水，把账本和对账都搅浑。
 *
 * @param tier    用户等级；空 = free
 * @param usage   用量。{@link Usage#empty()} = 按契约用量（提交前预览）
 * @param pricedAt ★ 计价时刻。**由调用方传**，不在内部取 now()——
 *                 营销活动按时间窗命中，影子对账时要用「当时」而不是「现在」，
 *                 否则一个已经结束的活动会让对账差异看起来像定价错误
 * @param ruleSnapshot ★ 本条规则的**快照**（JSON 文本）。语义与
 *                 {@link HoldCommand#ruleSnapshot()} 逐条相同：**必填**，
 *                 空 = 拒单；带上了就必须编译得过。
 *                 <p>⚠️ 预览必须与实扣取到**同一份**规则，否则就是
 *                 「预览一个价、实扣另一个价」。
 */
public record QuoteQuery(
        long userId,
        String modelId,
        String taskType,
        Map<String, String> specs,
        String tier,
        Usage usage,
        Instant pricedAt,
        String ruleSnapshot
) {

    public QuoteQuery {
        specs = specs == null ? Map.of() : Map.copyOf(specs);
        tier = tier == null || tier.isBlank() ? "free" : tier;
        usage = usage == null ? Usage.empty() : usage;
        // 与 HoldCommand 同口径：只有一种「没带快照」的写法
        ruleSnapshot = ruleSnapshot == null ? "" : ruleSnapshot;
    }
}
