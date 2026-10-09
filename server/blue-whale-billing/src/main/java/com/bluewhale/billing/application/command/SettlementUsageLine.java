package com.bluewhale.billing.application.command;

import com.bluewhale.billing.domain.pricing.Usage;

import java.util.Map;

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

    public Usage toUsage() {
        return Usage.ofKeys(modelId, taskType, quantities);
    }
}
