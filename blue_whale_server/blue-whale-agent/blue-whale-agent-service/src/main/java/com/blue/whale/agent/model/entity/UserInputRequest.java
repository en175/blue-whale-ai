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

    /** 请求类型：成本确认（成本确认门要求自然语言确认付费动作）。 */
    public static final String REQUEST_TYPE_COST_CONFIRMATION = "cost_confirmation";
    /** 请求类型：创作澄清（Agent 缺少推进创作所必需的信息，向用户提出可见问题）。 */
    public static final String REQUEST_TYPE_CREATION_CLARIFICATION = "creation_clarification";

    /** 是否为创作澄清请求（与成本确认走不同的校验、消费与事件路径）。 */
    public boolean isCreationClarification() {
        return REQUEST_TYPE_CREATION_CLARIFICATION.equals(requestType);
    }

    private Long projectId;
    private Long userId;
    private String requestType;
    private Long conversationId;
    private Long sourceAgentRunId;
    private Long resumedAgentRunId;
    private String requestTargetType;
    private String question;
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
    private Long answerMessageId;
}
