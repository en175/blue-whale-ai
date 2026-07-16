package com.blue.whale.agent.model.entity;

import com.baomidou.mybatisplus.annotation.TableName;
import com.blue.whale.global.base.entity.BaseEntity;
import lombok.Getter;
import lombok.Setter;
import lombok.experimental.Accessors;

import java.time.LocalDateTime;

@Getter
@Setter
@Accessors(chain = true)
@TableName("user_input_requests")
public class UserInputRequest extends BaseEntity {
    public static final String STATUS_PENDING = "pending";
    public static final String STATUS_CONFIRMED = "confirmed";
    public static final String STATUS_CONSUMED = "consumed";
    public static final String STATUS_EXPIRED = "expired";

    private Long projectId;
    private Long userId;
    private Long conversationId;
    private Long sourceAgentRunId;
    private Long resumedAgentRunId;
    private String requestTargetType;
    private String actionIdentity;
    private String actionType;
    private String argumentsDigest;
    private Long quotedAmountFen;
    private String quotedProvider;
    private String priceCatalogVersion;
    private String exchangeRateVersion;
    private String modelPolicyVersion;
    private String costRuleVersion;
    private String status;
    private LocalDateTime expiresAt;
    private LocalDateTime confirmedAt;
    private LocalDateTime consumedAt;
}
