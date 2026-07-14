package com.blue.whale.agent.model.dto;

import com.blue.whale.agent.model.entity.ProjectEvent;

import java.time.LocalDateTime;
import java.util.Map;

/**
 * 产品事件对外封套（ADR-0016 §4）。
 *
 * <p>序列化字段经全局 Jackson SNAKE_CASE 策略输出为 {@code schema_version} / {@code event_id} /
 * {@code event_type} / {@code aggregate_type} / {@code aggregate_id} / {@code aggregate_version} /
 * {@code correlation_id} / {@code causation_id} / {@code occurred_at}。
 * SSE 帧的 {@code id} 等于 {@code cursor}，{@code event} 等于 {@code eventType}。
 *
 * @param schemaVersion    封套 schema 版本
 * @param eventId          事件唯一标识
 * @param cursor           Project 内单调递增游标（SSE id）
 * @param eventType        事件类型
 * @param projectId        所属项目 ID
 * @param aggregateType    聚合类型
 * @param aggregateId      聚合 ID
 * @param aggregateVersion 聚合版本（客户端拒绝旧状态）
 * @param correlationId    贯穿一条用户意图的追踪 ID
 * @param causationId      直接原因事件 ID
 * @param occurredAt       事件发生时间
 * @param payload          事件 payload
 */
public record ProductEventDto(
        int schemaVersion,
        String eventId,
        Long cursor,
        String eventType,
        Long projectId,
        String aggregateType,
        String aggregateId,
        Integer aggregateVersion,
        String correlationId,
        String causationId,
        LocalDateTime occurredAt,
        Map<String, Object> payload) {

    /** 从持久化实体构造对外 DTO（固定当前 schema 版本）。 */
    public static ProductEventDto from(ProjectEvent e) {
        return new ProductEventDto(
                ProjectEvent.SCHEMA_VERSION,
                e.getEventId(),
                e.getCursor(),
                e.getEventType(),
                e.getProjectId(),
                e.getAggregateType(),
                e.getAggregateId(),
                e.getAggregateVersion(),
                e.getCorrelationId(),
                e.getCausationId(),
                e.getOccurredAt(),
                e.getPayload());
    }
}
