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
}
