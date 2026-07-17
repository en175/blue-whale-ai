package com.blue.whale.agent.service.governance;

import com.blue.whale.agent.mapper.AuditRecordMapper;
import com.blue.whale.agent.model.entity.AuditRecord;
import com.blue.whale.agent.model.entity.GenerationJob;
import com.blue.whale.agent.model.entity.UserInputRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;

@Service
@RequiredArgsConstructor
public class AuditRecordWriter {

    private final AuditRecordMapper mapper;

    @Value("${spring.profiles.active:default}")
    private String environment;

    public void appendCostDecision(
            CostReservationCommand command,
            String action,
            String decision,
            String reasonCode,
            String policyVersion) {
        AuditRecord record = new AuditRecord()
                .setActorUserId(command.userId())
                .setProjectId(command.projectId())
                .setTargetType("GenerationJob")
                .setTargetId(String.valueOf(command.generationJobId()))
                .setAction(action)
                .setDecision(decision)
                .setReasonCode(reasonCode)
                .setPolicyVersion(policyVersion)
                .setPriceCatalogVersion(command.quote().priceCatalogVersion())
                .setExchangeRateVersion(command.quote().exchangeRateVersion())
                .setModelPolicyVersion(command.quote().modelPolicyVersion())
                .setCostRuleVersion(policyVersion)
                .setRequestId("generation-job:" + command.generationJobId())
                .setCorrelationId("generation-job:" + command.generationJobId())
                .setTraceId("generation-job:" + command.generationJobId());
        persist(record);
    }

    public void appendReservationTransition(
            CostReservationCommand command,
            String action,
            String reasonCode,
            String policyVersion) {
        appendCostDecision(command, action, "allowed", reasonCode, policyVersion);
    }

    public void appendActionDecision(
            ActionAuthorizationCommand command,
            String decision,
            String reasonCode,
            PriceQuote quote,
            String policyVersion) {
        AuditRecord record = new AuditRecord()
                .setActorUserId(command.userId())
                .setProjectId(command.projectId())
                .setTargetType(command.targetType())
                .setTargetId(command.targetId())
                .setAction("generation_action.authorize")
                .setDecision(decision)
                .setReasonCode(reasonCode)
                .setPolicyVersion(policyVersion)
                .setPriceCatalogVersion(quote == null ? null : quote.priceCatalogVersion())
                .setExchangeRateVersion(quote == null ? null : quote.exchangeRateVersion())
                .setModelPolicyVersion(quote == null ? null : quote.modelPolicyVersion())
                .setCostRuleVersion(policyVersion)
                .setRequestId(truncate(command.actionIdentity(), 128))
                .setCorrelationId(command.correlationId())
                .setTraceId(command.correlationId());
        persist(record);
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void appendNeedsConfirmationActionDecision(
            ActionAuthorizationCommand command,
            String reasonCode,
            PriceQuote quote,
            String policyVersion) {
        appendActionDecision(command, "needs_confirmation", reasonCode, quote, policyVersion);
    }

    public void appendUserInputDecision(
            UserInputRequest request,
            String action,
            String decision,
            String reasonCode,
            String policyVersion) {
        AuditRecord record = new AuditRecord()
                .setActorUserId(request.getUserId())
                .setProjectId(request.getProjectId())
                .setTargetType("UserInputRequest")
                .setTargetId(String.valueOf(request.getId()))
                .setAction(action)
                .setDecision(decision)
                .setReasonCode(reasonCode)
                .setPolicyVersion(policyVersion)
                .setPriceCatalogVersion(request.getPriceCatalogVersion())
                .setExchangeRateVersion(request.getExchangeRateVersion())
                .setModelPolicyVersion(request.getModelPolicyVersion())
                .setCostRuleVersion(request.getCostRuleVersion() == null
                        ? policyVersion : request.getCostRuleVersion())
                .setRequestId("user-input-request:" + request.getId())
                .setCorrelationId("user-input-request:" + request.getId())
                .setTraceId("user-input-request:" + request.getId());
        persist(record);
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void appendDeniedProviderAdmission(
            CostReservationCommand command,
            String reasonCode,
            String policyVersion) {
        appendCostDecision(
                command, "cost_reservation.provider_admission", "denied", reasonCode,
                policyVersion);
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void appendMissingReservationDenied(
            GenerationJob job,
            String reasonCode,
            String policyVersion) {
        AuditRecord record = new AuditRecord()
                .setActorUserId(job.getUserId())
                .setProjectId(job.getProjectId())
                .setTargetType("GenerationJob")
                .setTargetId(String.valueOf(job.getId()))
                .setAction("cost_reservation.provider_admission")
                .setDecision("denied")
                .setReasonCode(reasonCode)
                .setPolicyVersion(policyVersion)
                .setCostRuleVersion(policyVersion)
                .setRequestId("generation-job:" + job.getId())
                .setCorrelationId("generation-job:" + job.getId())
                .setTraceId("generation-job:" + job.getId());
        persist(record);
    }

    private void persist(AuditRecord record) {
        record.setEnvironment(environment).setOccurredAt(LocalDateTime.now());
        if (mapper.append(record) != 1) {
            throw new IllegalStateException("审计写入失败");
        }
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void appendDeniedCostDecision(
            CostReservationCommand command,
            String reasonCode,
            String policyVersion) {
        appendCostDecision(
                command, "cost_reservation.create", "denied", reasonCode, policyVersion);
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void appendDeniedActionDecision(
            ActionAuthorizationCommand command,
            String reasonCode,
            PriceQuote quote,
            String policyVersion) {
        appendActionDecision(command, "denied", reasonCode, quote, policyVersion);
    }

    private String truncate(String value, int maxLength) {
        if (value == null || value.length() <= maxLength) {
            return value;
        }
        return value.substring(0, maxLength);
    }
}
