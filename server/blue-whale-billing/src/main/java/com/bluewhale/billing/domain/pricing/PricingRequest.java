package com.bluewhale.billing.domain.pricing;

import java.util.Map;

public record PricingRequest(
        long userId,
        String modelId,
        String taskType,
        Map<String, String> specs,
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
