package com.bluewhale.worker.application.service;

import com.bluewhale.worker.domain.entity.ProjectEventEntity;
import com.bluewhale.worker.infrastructure.persistence.mapper.ProjectEventMapper;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.Map;
import java.util.UUID;

@Service
public class ProjectEventPublisher {

    private static final ObjectMapper JSON_MAPPER = new ObjectMapper();

    private static final int MAX_CURSOR_ATTEMPTS = 3;

    private final ProjectEventMapper projectEventMapper;

    public ProjectEventPublisher(ProjectEventMapper projectEventMapper) {
        this.projectEventMapper = projectEventMapper;
    }

    public void lockProject(Long projectId) {
        projectEventMapper.lockProject(projectId);
    }

    public void publish(
            Long projectId, String eventType, String aggregateType,
            String aggregateId, Integer aggregateVersion,
            String correlationId, Map<String, Object> payload
    ) {
        ProjectEventEntity event = new ProjectEventEntity();
        event.setProjectId(projectId);
        event.setEventId(UUID.randomUUID().toString());
        event.setEventType(eventType);
        event.setAggregateType(aggregateType);
        event.setAggregateId(aggregateId);
        event.setAggregateVersion(aggregateVersion);
        event.setCorrelationId(correlationId);
        LocalDateTime now = LocalDateTime.now();
        event.setOccurredAt(now);
        event.setPayload(toJson(payload));
        event.setVersion(0);
        event.setIsDelete(0);
        for (int attempt = 1; ; attempt++) {
            event.setCursor(projectEventMapper.nextCursor(projectId));
            try {
                projectEventMapper.insert(event);
                return;
            } catch (DuplicateKeyException e) {
                if (attempt >= MAX_CURSOR_ATTEMPTS) {
                    throw e;
                }
            }
        }
    }

    private String toJson(Object obj) {
        try {
            return JSON_MAPPER.writeValueAsString(obj);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("Failed to serialize to JSON", e);
        }
    }
}
