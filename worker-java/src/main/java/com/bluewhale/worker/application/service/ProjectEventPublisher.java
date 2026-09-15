package com.bluewhale.worker.application.service;

import com.bluewhale.worker.domain.entity.ProjectEventEntity;
import com.bluewhale.worker.infrastructure.mapper.ProjectEventMapper;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.Map;
import java.util.UUID;

/**
 * 项目事件发布（刀④ 拆分自 JobStateMachineService 的 appendProjectEvent）。
 * <p>
 * nextCursor 顺序游标 + event_id UUID + 全量 payload 落库（settle-ops 事件段）。
 * 在 complete/fail 事务内调用，保证事件与槽位/日志原子一致。
 */
@Service
public class ProjectEventPublisher {

    private static final ObjectMapper JSON_MAPPER = new ObjectMapper();

    private final ProjectEventMapper projectEventMapper;

    public ProjectEventPublisher(ProjectEventMapper projectEventMapper) {
        this.projectEventMapper = projectEventMapper;
    }

    /**
     * 落一条 project_events（生成侧各路径共用）。
     */
    public void publish(
            Long projectId, String eventType, String aggregateType,
            String aggregateId, Integer aggregateVersion,
            String correlationId, Map<String, Object> payload
    ) {
        Long cursor = projectEventMapper.nextCursor(projectId);
        ProjectEventEntity event = new ProjectEventEntity();
        event.setProjectId(projectId);
        event.setCursor(cursor);
        event.setEventId(UUID.randomUUID().toString());
        event.setEventType(eventType);
        event.setAggregateType(aggregateType);
        event.setAggregateId(aggregateId);
        event.setAggregateVersion(aggregateVersion);
        event.setCorrelationId(correlationId);
        LocalDateTime now = LocalDateTime.now(ZoneOffset.UTC);
        event.setOccurredAt(now);
        event.setPayload(toJson(payload));
        event.setGmtCreate(now);
        event.setGmtModified(now);
        event.setVersion(0);
        event.setIsDelete(0);
        projectEventMapper.insert(event);
    }

    private String toJson(Object obj) {
        try {
            return JSON_MAPPER.writeValueAsString(obj);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("Failed to serialize to JSON", e);
        }
    }
}
