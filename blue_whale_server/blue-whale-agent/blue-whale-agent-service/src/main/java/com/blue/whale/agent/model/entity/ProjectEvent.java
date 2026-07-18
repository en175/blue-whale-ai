package com.blue.whale.agent.model.entity;

import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableName;
import com.baomidou.mybatisplus.extension.handlers.JacksonTypeHandler;
import com.blue.whale.global.base.entity.BaseEntity;
import lombok.Getter;
import lombok.Setter;
import lombok.experimental.Accessors;

import java.time.LocalDateTime;
import java.util.Map;

/**
 * 持久化产品事件（ADR-0016 §4 事件封套）。
 *
 * <p>每个权威状态转移在同一事务内追加一条事件记录，封套字段对齐公开协议。
 * SSE 重放与 Snapshot 一致性共享此表为共同事实来源。{@code cursor} 为 Project 内单调递增游标，
 * 由 {@link ProjectEventStream} 的高水位分配。
 */
@Getter
@Setter
@Accessors(chain = true)
@TableName(value = "project_events", autoResultMap = true)
public class ProjectEvent extends BaseEntity {

    /** 事件封套 schema 版本（ADR-0016 §6 版本兼容） */
    public static final int SCHEMA_VERSION = 1;

    private Long projectId;

    /** Project 内单调递增游标（SSE id）。物理列 event_cursor（cursor 为 MySQL 保留字，IK1W1M 改名） */
    @TableField("event_cursor")
    private Long cursor;

    /** 事件唯一标识（evt_ 前缀） */
    private String eventId;

    /** 事件类型（如 project.created） */
    private String eventType;

    /** 聚合类型（project/generation_job） */
    private String aggregateType;

    /** 聚合 ID（字符串化，跨聚合统一） */
    private String aggregateId;

    /** 聚合版本（乐观锁版本，客户端拒绝旧状态） */
    private Integer aggregateVersion;

    /** 贯穿一条用户意图的追踪 ID */
    private String correlationId;

    /** 直接原因事件 ID */
    private String causationId;

    /** 事件发生时间 */
    private LocalDateTime occurredAt;

    /** 事件 payload（具体事件结构，整存整取） */
    @TableField(typeHandler = JacksonTypeHandler.class)
    private Map<String, Object> payload;
}
