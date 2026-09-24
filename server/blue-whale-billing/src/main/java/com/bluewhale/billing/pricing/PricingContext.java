package com.bluewhale.billing.pricing;

import java.time.Instant;

/**
 * 计价管线的上下文。
 *
 * @param rule       编译后的规则（来自冻结的 catalog 版本）
 * @param request    请求（模型 / 任务 / 规格 / 等级）
 * @param usage      用量
 * @param submitAt   **提交时刻**——折扣的时间条件按它判定，**不是结算时刻**。
 *                   否则会出现「提交时看到 7 折、结算时活动结束变原价」（§2.5.6）。
 */
public record PricingContext(
        CompiledRule rule,
        PricingRequest request,
        Usage usage,
        Instant submitAt
) {

    public PricingContext {
        if (rule == null) throw new IllegalArgumentException("rule 必填");
        if (request == null) throw new IllegalArgumentException("request 必填");
        if (usage == null) throw new IllegalArgumentException("usage 必填");
        if (submitAt == null) throw new IllegalArgumentException("submitAt 必填（折扣判定按提交时刻）");
    }

    /** 规格——归一化与查表都从它取。 */
    public java.util.Map<String, String> specs() {
        return request.specs();
    }
}
