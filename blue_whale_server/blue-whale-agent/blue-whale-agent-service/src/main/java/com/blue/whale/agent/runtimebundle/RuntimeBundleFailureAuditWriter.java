package com.blue.whale.agent.runtimebundle;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class RuntimeBundleFailureAuditWriter {

    private final JdbcTemplate jdbcTemplate;
    private final ObjectMapper objectMapper;

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void record(
            Long actorUserId,
            String event,
            String targetType,
            String targetId,
            String requestHash,
            int errorCode) {
        ObjectNode details = objectMapper.createObjectNode()
                .put("result", "failure")
                .put("error_code", errorCode)
                .put("request_hash", requestHash);
        jdbcTemplate.update("""
                INSERT INTO runtime_bundle_audit_records
                    (actor_user_id, operation, target_type, target_id, details_json)
                VALUES (?, ?, ?, ?, ?)
                """, actorUserId == null ? 0L : actorUserId,
                event, targetType, targetId, writeJson(details));
    }

    private String writeJson(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("Runtime Bundle 审计 JSON 无法序列化", exception);
        }
    }
}
