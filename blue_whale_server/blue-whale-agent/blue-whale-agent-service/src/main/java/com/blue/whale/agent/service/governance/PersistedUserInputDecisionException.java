package com.blue.whale.agent.service.governance;

import org.springframework.http.HttpStatus;

/** 仅用于已在当前事务中固化的确认拒绝事实，允许调用方提交该拒绝事务。 */
public final class PersistedUserInputDecisionException extends GovernanceException {

    private PersistedUserInputDecisionException(
            String publicCode, String message, Long inputRequestId, HttpStatus httpStatus) {
        super(publicCode, message, false, null, inputRequestId, BudgetEffect.NONE, httpStatus);
    }

    public static PersistedUserInputDecisionException actionNotAllowed() {
        return new PersistedUserInputDecisionException(
                "ACTION_NOT_ALLOWED", "当前动作未获授权。", null,
                HttpStatus.UNPROCESSABLE_ENTITY);
    }

    public static PersistedUserInputDecisionException inputRequired(Long inputRequestId) {
        return new PersistedUserInputDecisionException(
                "INPUT_REQUIRED", "需要通过对话完成自然语言确认。", inputRequestId,
                HttpStatus.CONFLICT);
    }
}
