package com.bluewhale.worker.application.service;

import com.bluewhale.worker.domain.entity.ProjectEventEntity;
import com.bluewhale.worker.infrastructure.persistence.mapper.ProjectEventMapper;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.Map;
import java.util.UUID;

@Service
public class ProjectEventPublisher {

    private static final ObjectMapper JSON_MAPPER = new ObjectMapper();

    private final ProjectEventMapper projectEventMapper;

    public ProjectEventPublisher(ProjectEventMapper projectEventMapper) {
        this.projectEventMapper = projectEventMapper;
    }

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
        LocalDateTime now = WorkerClock.now();
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
