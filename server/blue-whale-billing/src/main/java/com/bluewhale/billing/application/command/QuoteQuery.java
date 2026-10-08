package com.bluewhale.billing.application.command;

import com.bluewhale.billing.domain.pricing.Usage;

import java.time.Instant;
import java.util.Map;

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
        ruleSnapshot = ruleSnapshot == null ? "" : ruleSnapshot;
    }
}
