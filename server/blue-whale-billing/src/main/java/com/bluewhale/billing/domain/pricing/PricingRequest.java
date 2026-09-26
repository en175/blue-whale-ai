package com.bluewhale.billing.domain.pricing;

import java.util.Map;

/** 计价输入（领域类型，与 proto 解耦：wire format 变化不应波及计价逻辑）。 */
public record PricingRequest(
        long userId,
        String modelId,
        String taskType,
        /** 原始规格；引擎内部负责规范化 */
        Map<String, String> specs,
        /** 用户等级：free / basic / pro / max。折扣解析用 */
        String tier
) {

    public PricingRequest {
        if (modelId == null || modelId.isBlank()) {
            throw new IllegalArgumentException("modelId 必填");
        }
        if (taskType == null || taskType.isBlank()) {
            throw new IllegalArgumentException("taskType 必填");
        }
        specs = specs == null ? Map.of() : Map.copyOf(specs);
        tier = tier == null ? "free" : tier;
    }
}
