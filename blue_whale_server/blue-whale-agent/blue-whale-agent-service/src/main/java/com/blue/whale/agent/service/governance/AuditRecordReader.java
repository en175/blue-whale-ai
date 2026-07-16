package com.blue.whale.agent.service.governance;

import com.blue.whale.agent.mapper.AuditRecordMapper;
import com.blue.whale.agent.model.entity.AuditRecord;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
@RequiredArgsConstructor
public class AuditRecordReader {

    private final AuditRecordMapper mapper;

    @Transactional(readOnly = true)
    public List<AuditRecordSnapshot> findByCorrelationId(String correlationId) {
        return mapper.findByCorrelationId(correlationId).stream().map(this::snapshot).toList();
    }

    private AuditRecordSnapshot snapshot(AuditRecord record) {
        return new AuditRecordSnapshot(
                record.getId(), record.getActorUserId(), record.getProjectId(), record.getTargetType(),
                record.getTargetId(), record.getAction(), record.getDecision(), record.getReasonCode(),
                record.getPolicyVersion(), record.getPriceCatalogVersion(), record.getExchangeRateVersion(),
                record.getModelPolicyVersion(), record.getCostRuleVersion(), record.getRequestId(),
                record.getCorrelationId(), record.getTraceId(), record.getEnvironment(), record.getOccurredAt());
    }
}
