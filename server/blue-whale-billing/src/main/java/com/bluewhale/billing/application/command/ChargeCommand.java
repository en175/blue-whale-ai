package com.bluewhale.billing.application.command;

import java.time.LocalDateTime;
import java.util.Map;

public record ChargeCommand(
        long userId,
        String commandId,
        long jobId,
        String modelId,
        String taskType,
        Map<String, String> specs,
        String tier,
        String title,
        LocalDateTime submittedAt,
        String ruleSnapshot
) {

    public ChargeCommand {
        if (commandId == null || commandId.isBlank()) {
            throw new IllegalArgumentException("commandId 必填——它是幂等键的来源");
        }
        if (jobId <= 0) {
            throw new IllegalArgumentException("jobId 必须为正：" + jobId);
        }
        specs = specs == null ? Map.of() : Map.copyOf(specs);
        tier = tier == null || tier.isBlank() ? "free" : tier;
        title = title == null ? "" : title;
        ruleSnapshot = ruleSnapshot == null ? "" : ruleSnapshot;
    }
}
