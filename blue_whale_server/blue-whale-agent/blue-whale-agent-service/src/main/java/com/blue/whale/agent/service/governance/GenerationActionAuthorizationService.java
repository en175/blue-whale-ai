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
            auditRecordWriter.appendDeniedActionDecision(
                    command, decision.reasonCode(), decision.quote(), properties.getRuleVersion());
            if ("QUOTA_EXCEEDED".equals(decision.reasonCode())) {
                throw GovernanceException.quotaExceeded();
            }
            throw GovernanceException.actionNotAllowed();
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
