package com.blue.whale.agent.service.governance;

import java.time.LocalDateTime;

public record AuditRecordSnapshot(
        Long id,
        Long actorUserId,
        Long projectId,
        String targetType,
        String targetId,
        String action,
        String decision,
        String reasonCode,
        String policyVersion,
        String priceCatalogVersion,
        String exchangeRateVersion,
        String modelPolicyVersion,
        String costRuleVersion,
        String requestId,
        String correlationId,
        String traceId,
        String environment,
        LocalDateTime occurredAt) {
}
