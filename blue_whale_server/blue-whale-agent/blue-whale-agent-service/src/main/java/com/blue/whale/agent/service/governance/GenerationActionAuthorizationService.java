package com.blue.whale.agent.service.governance;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class GenerationActionAuthorizationService {

    private final GenerationAuthorizationGate authorizationGate;
    private final AuditRecordWriter auditRecordWriter;
    private final CostControlProperties properties;

    public AuthorizationDecision authorize(ActionAuthorizationCommand command) {
        AuthorizationDecision decision = authorizationGate.evaluate(new GenerationAuthorizationRequest(
                command.actionType(), command.arguments(), command.irreversible(),
                command.validatedConfirmation()));
        if (decision.outcome() == AuthorizationOutcome.DENIED) {
            // IK2QBX 治理拒绝不再以异常终结提交：审计仍落库内部 reasonCode，
            // 调用方按 GovernanceException.forDeniedReasonCode 投影为稳定 publicCode，
            // 经已接纳结果通道回喂 Worker，再以 DeferredToolResults 回喂模型。
            auditRecordWriter.appendDeniedActionDecision(
                    command, decision.reasonCode(), decision.quote(), properties.getRuleVersion());
            return decision;
        }
        String reasonCode = decision.reasonCode() == null
                ? "JAVA_POLICY_ALLOWED" : decision.reasonCode();
        if (decision.outcome() == AuthorizationOutcome.INPUT_REQUIRED) {
            auditRecordWriter.appendNeedsConfirmationActionDecision(
                    command, reasonCode, decision.quote(), properties.getRuleVersion());
            return decision;
        }
        auditRecordWriter.appendActionDecision(
                command, "allowed", reasonCode, decision.quote(), properties.getRuleVersion());
        return decision;
    }

    public void deny(ActionAuthorizationCommand command, String reasonCode) {
        auditRecordWriter.appendDeniedActionDecision(
                command, reasonCode, null, properties.getRuleVersion());
        throw GovernanceException.actionNotAllowed();
    }
}
