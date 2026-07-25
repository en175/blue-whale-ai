package com.blue.whale.agent.model.entity;

import lombok.Getter;
import lombok.Setter;
import lombok.experimental.Accessors;

import java.time.LocalDateTime;

@Getter
@Setter
@Accessors(chain = true)
public class AuditRecord {
    private Long id;
    private Long actorUserId;
    private Long projectId;
    private String targetType;
    private String targetId;
    private String action;
    private String decision;
    private String reasonCode;
    private String policyVersion;
    private String priceCatalogVersion;
    private String exchangeRateVersion;
    private String modelPolicyVersion;
    private String costRuleVersion;
    private String requestId;
    private String correlationId;
    private String traceId;
    private String details;
    private String environment;
    private LocalDateTime occurredAt;
    private LocalDateTime gmtCreate;
}
