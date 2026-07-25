package com.blue.whale.agent.service.governance;

import com.blue.whale.agent.common.web.PublicRequestId;
import lombok.Getter;
import org.springframework.http.HttpStatus;

import java.util.LinkedHashMap;
import java.util.Map;

@Getter
public class GovernanceException extends RuntimeException {
    private final String publicCode;
    private final boolean retryable;
    private final Integer retryAfterSeconds;
    private final Long inputRequestId;
    private final BudgetEffect budgetEffect;
    private final HttpStatus httpStatus;

    public GovernanceException(
            String publicCode,
            String message,
            boolean retryable,
            Integer retryAfterSeconds,
            Long inputRequestId,
            BudgetEffect budgetEffect,
            HttpStatus httpStatus) {
        super(message);
        this.publicCode = publicCode;
        this.retryable = retryable;
        this.retryAfterSeconds = retryAfterSeconds;
        this.inputRequestId = inputRequestId;
        this.budgetEffect = budgetEffect;
        this.httpStatus = httpStatus;
    }

    public static GovernanceException quotaExceeded() {
        return new GovernanceException(
                "QUOTA_EXCEEDED", "当前操作超过可用额度。", false, null, null,
                BudgetEffect.NONE, HttpStatus.UNPROCESSABLE_ENTITY);
    }

    public static GovernanceException inputRequired(Long inputRequestId) {
        return new GovernanceException(
                "INPUT_REQUIRED", "需要通过对话完成自然语言确认。", false, null, inputRequestId,
                BudgetEffect.NONE, HttpStatus.CONFLICT);
    }

    public static GovernanceException actionNotAllowed() {
        return new GovernanceException(
                "ACTION_NOT_ALLOWED", "当前动作未获授权。", false, null, null,
                BudgetEffect.NONE, HttpStatus.UNPROCESSABLE_ENTITY);
    }

    public static GovernanceException validationFailed(String message) {
        return new GovernanceException(
                "VALIDATION_FAILED", message, false, null, null,
                BudgetEffect.NONE, HttpStatus.BAD_REQUEST);
    }

    public String publicCode() {
        return publicCode;
    }

    public BudgetEffect budgetEffect() {
        return budgetEffect;
    }

    public Map<String, Object> publicEnvelope() {
        Map<String, Object> envelope = new LinkedHashMap<>();
        envelope.put("code", publicCode);
        envelope.put("message", getMessage());
        envelope.put("retryable", retryable);
        envelope.put("retry_after_seconds", retryAfterSeconds);
        envelope.put("request_id", PublicRequestId.current());
        envelope.put("input_request_id", inputRequestId);
        envelope.put("budget_effect", budgetEffect.wireValue());
        return envelope;
    }

    /**
     * IK2QBX 拒绝结果回喂通道：把内部 reasonCode 投影为面向 User 的稳定公开码与安全提示。
     * 复用既有 publicCode 工厂族，不向 User 侧暴露内部诊断码（如 ACTION_SCHEMA_OR_OWNERSHIP_REJECTED、
     * CLARIFICATION_TOOL_NOT_GRANTED）；非配额类拒绝统一投影为 ACTION_NOT_ALLOWED（retryable=false），
     * 让模型改走已授权的动作路径。
     */
    public static RejectionEnvelope forDeniedReasonCode(String reasonCode) {
        if ("QUOTA_EXCEEDED".equals(reasonCode)) {
            // 配额类拒绝：额度刷新后可重试，retryable=true 让模型可改提或提示用户等待。
            return new RejectionEnvelope("QUOTA_EXCEEDED", quotaExceeded().getMessage(), true);
        }
        return new RejectionEnvelope("ACTION_NOT_ALLOWED", actionNotAllowed().getMessage(), false);
    }

    /**
     * IK2QBX 拒绝结果回喂通道载荷：经 RunCommitRecord 持久化，由 accepted_results 通道回传 Worker。
     */
    public record RejectionEnvelope(String publicCode, String message, boolean retryable) {
    }
}
