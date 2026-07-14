package com.blue.whale.agent.service;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.blue.whale.agent.mapper.OutboxMessageMapper;
import com.blue.whale.agent.mapper.ProjectEventMapper;
import com.blue.whale.agent.mapper.ProjectEventStreamMapper;
import com.blue.whale.agent.model.entity.OutboxMessage;
import com.blue.whale.agent.model.entity.ProjectEvent;
import com.blue.whale.agent.model.entity.ProjectEventStream;
import com.blue.whale.global.exception.GlobalException;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.Map;
import java.util.UUID;

/**
 * 产品事件写入服务（ADR-0016 §4 + ADR-0017 §3）。
 *
 * <p>{@link #appendEvent} 不加 {@code @Transactional}——它必须在调用方的事务内执行，
 * 使游标分配、事件追加与权威状态转移、Outbox 写入落在同一事务。事务回滚则游标分配一并回滚。
 *
 * <p>游标分配：{@code SELECT ... FOR UPDATE} 锁定该 Project 的高水位行，递增后写回。
 * 首次为某 Project 产生事件时初始化高水位行（初始 0）。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class ProjectEventService {

    private final ProjectEventStreamMapper eventStreamMapper;
    private final ProjectEventMapper eventMapper;
    private final OutboxMessageMapper outboxMapper;

    /**
     * 在当前事务内追加一条产品事件（调用方必须已开启事务）。
     *
     * <p>步骤：锁定高水位行 → 递增游标 → 写事件日志 → 写 Outbox（骨架）。全部在同一事务，
     * 回滚则游标分配与事件都不落盘。调用方在 {@code afterCommit} 用返回值推实时 SSE。
     *
     * @param projectId        项目 ID
     * @param eventType        事件类型（{@link com.blue.whale.agent.model.constant.EventType}）
     * @param aggregateType    聚合类型（{@link com.blue.whale.agent.model.constant.AggregateType}）
     * @param aggregateId      聚合 ID（字符串化）
     * @param aggregateVersion 聚合版本（乐观锁版本）
     * @param payload          事件 payload
     * @param correlationId    追踪 ID（可空）
     * @param causationId      直接原因事件 ID（可空）
     * @return 已写入的事件实体（含分配的游标）
     */
    public ProjectEvent appendEvent(Long projectId, String eventType, String aggregateType,
                                    String aggregateId, Integer aggregateVersion,
                                    Map<String, Object> payload, String correlationId, String causationId) {
        long nextCursor = allocateCursor(projectId);
        ProjectEvent event = new ProjectEvent()
                .setProjectId(projectId)
                .setCursor(nextCursor)
                .setEventId(newEventId())
                .setEventType(eventType)
                .setAggregateType(aggregateType)
                .setAggregateId(aggregateId)
                .setAggregateVersion(aggregateVersion == null ? 0 : aggregateVersion)
                .setCorrelationId(correlationId)
                .setCausationId(causationId)
                .setOccurredAt(LocalDateTime.now())
                .setPayload(payload);
        eventMapper.insert(event);

        outboxMapper.insert(new OutboxMessage()
                .setMessageId(event.getEventId())
                .setAggregateType(aggregateType)
                .setAggregateId(aggregateId)
                .setEventType(eventType)
                .setPayload(payload)
                .setStatus(OutboxMessage.STATUS_PENDING)
                .setAttemptCount(0));

        log.debug("appendEvent projectId={} cursor={} type={} aggregate={}/{}",
                projectId, nextCursor, eventType, aggregateType, aggregateId);
        return event;
    }

    /**
     * 读取该 Project 高于 {@code after} 游标的事件（按游标升序），供 SSE 重放。
     */
    public java.util.List<ProjectEvent> eventsAfter(Long projectId, long after, int limit) {
        return eventMapper.selectList(Wrappers.<ProjectEvent>lambdaQuery()
                .eq(ProjectEvent::getProjectId, projectId)
                .gt(ProjectEvent::getCursor, after)
                .orderByAsc(ProjectEvent::getCursor)
                .last("LIMIT " + limit));
    }

    /**
     * 当前高水位（Snapshot 的 {@code high_watermark_cursor}）。不存在返回 0。
     *
     * <p>不加锁，供 Snapshot 一致读取。Snapshot 读取各聚合状态与此高水位应在同一数据库快照内完成，
     * 之后提交的事件必然获得更大游标，客户端从该高水位接续 SSE 不会漏掉并发事件（ADR-0017 §3）。
     */
    public long highWatermark(Long projectId) {
        ProjectEventStream stream = eventStreamMapper.selectById(projectId);
        return stream == null ? 0L : (stream.getHighWatermark() == null ? 0L : stream.getHighWatermark());
    }

    /**
     * 该 Project 最早可用事件的游标（保留窗口下界，用于 CURSOR_EXPIRED 判定）。
     *
     * <p>首版保留窗口 = 全部（不 GC），下界即最早事件游标；无事件返回 0。
     */
    public long earliestCursor(Long projectId) {
        ProjectEvent earliest = eventMapper.selectOne(Wrappers.<ProjectEvent>lambdaQuery()
                .eq(ProjectEvent::getProjectId, projectId)
                .orderByAsc(ProjectEvent::getCursor)
                .last("LIMIT 1"));
        return earliest == null ? 0L : earliest.getCursor();
    }

    /**
     * 锁定高水位行并分配下一个连续游标（必须在事务内调用）。
     * 高水位行不存在时初始化为 0 再递增；并发首个写入由 FOR UPDATE 串行化。
     */
    private long allocateCursor(Long projectId) {
        ProjectEventStream stream = eventStreamMapper.selectForUpdate(projectId);
        if (stream == null) {
            // 首次：初始化高水位行（0），再 FOR UPDATE 确认占位
            ProjectEventStream init = new ProjectEventStream()
                    .setProjectId(projectId)
                    .setHighWatermark(0L);
            try {
                eventStreamMapper.insert(init);
            } catch (org.springframework.dao.DuplicateKeyException e) {
                // 并发初始化：另一事务已插入，重新锁定
                stream = eventStreamMapper.selectForUpdate(projectId);
                if (stream == null) {
                    throw new GlobalException("无法初始化 Project 事件流: " + projectId);
                }
                return increment(stream);
            }
            return 1L;
        }
        return increment(stream);
    }

    private long increment(ProjectEventStream stream) {
        long current = stream.getHighWatermark() == null ? 0L : stream.getHighWatermark();
        long next = current + 1;
        stream.setHighWatermark(next);
        eventStreamMapper.updateById(stream);
        return next;
    }

    private String newEventId() {
        return "evt_" + UUID.randomUUID().toString().replace("-", "");
    }
}
