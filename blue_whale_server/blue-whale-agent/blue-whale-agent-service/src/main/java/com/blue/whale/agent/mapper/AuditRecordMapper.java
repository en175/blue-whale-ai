package com.blue.whale.agent.mapper;

import com.blue.whale.agent.model.entity.AuditRecord;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Options;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.util.List;

public interface AuditRecordMapper {

    @Insert("INSERT INTO audit_records(actor_user_id, project_id, target_type, target_id, action, "
            + "decision, reason_code, policy_version, price_catalog_version, exchange_rate_version, "
            + "model_policy_version, cost_rule_version, request_id, "
            + "correlation_id, trace_id, environment, occurred_at, details) VALUES(#{actorUserId}, "
            + "#{projectId}, #{targetType}, #{targetId}, #{action}, #{decision}, #{reasonCode}, "
            + "#{policyVersion}, #{priceCatalogVersion}, #{exchangeRateVersion}, #{modelPolicyVersion}, "
            + "#{costRuleVersion}, #{requestId}, #{correlationId}, #{traceId}, #{environment}, "
            + "#{occurredAt}, #{details})")
    @Options(useGeneratedKeys = true, keyProperty = "id")
    int append(AuditRecord record);

    @Select("SELECT * FROM audit_records WHERE correlation_id = #{correlationId} ORDER BY id")
    List<AuditRecord> findByCorrelationId(@Param("correlationId") String correlationId);
}
