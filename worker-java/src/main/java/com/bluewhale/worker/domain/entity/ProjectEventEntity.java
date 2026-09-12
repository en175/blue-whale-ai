package com.bluewhale.worker.domain.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import java.time.LocalDateTime;

/**
 * 项目事件行（对应 Prisma model project_events）。
 */
@TableName("project_events")
public class ProjectEventEntity {
    @TableId(type = IdType.AUTO)
    /** 主键（BigInt，对外字符串化承载） */
    private Long id;

    @TableField("project_id")
    /** 归属项目（assets：0=全局素材） */
    private Long projectId;

    // cursor 是 MySQL 保留字，必须反引号（MP 自动生成的 insert/select 列名按此原样拼接）。
    @TableField("`cursor`")
    /** 项目内自增游标——MySQL 保留字，SQL 必须反引号（本地冒烟已抓到一次事故） */
    private Long cursor;

    @TableField("event_id")
    /** 事件唯一 id */
    private String eventId;

    @TableField("event_type")
    /** 事件类型（asset.created / generation_job.status_changed 等，契约 §3.3） */
    private String eventType;

    @TableField("aggregate_type")
    /** 聚合类型 */
    private String aggregateType;

    @TableField("aggregate_id")
    /** 聚合 id */
    private String aggregateId;

    @TableField("aggregate_version")
    /** 聚合版本 */
    private Integer aggregateVersion;

    @TableField("correlation_id")
    /** 关联 id（约定 job_<jobId>） */
    private String correlationId;

    @TableField("causation_id")
    /** 因果 id */
    private String causationId;

    @TableField("occurred_at")
    /** 发生时间 */
    private LocalDateTime occurredAt;

    @TableField("payload")
    /** 事件负载 JSON */
    private String payload; // JSON

    @TableField("gmt_create")
    /** 创建时间 */
    private LocalDateTime gmtCreate;

    @TableField("gmt_modified")
    /** 修改时间 */
    private LocalDateTime gmtModified;

    @TableField("version")
    /** 乐观锁版本（每次写 +1，契约 §3.1） */
    private Integer version;

    @TableField("is_delete")
    /** 软删标记（GC/领取均过滤） */
    private Integer isDelete;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Long getProjectId() { return projectId; }
    public void setProjectId(Long projectId) { this.projectId = projectId; }
    public Long getCursor() { return cursor; }
    public void setCursor(Long cursor) { this.cursor = cursor; }
    public String getEventId() { return eventId; }
    public void setEventId(String eventId) { this.eventId = eventId; }
    public String getEventType() { return eventType; }
    public void setEventType(String eventType) { this.eventType = eventType; }
    public String getAggregateType() { return aggregateType; }
    public void setAggregateType(String aggregateType) { this.aggregateType = aggregateType; }
    public String getAggregateId() { return aggregateId; }
    public void setAggregateId(String aggregateId) { this.aggregateId = aggregateId; }
    public Integer getAggregateVersion() { return aggregateVersion; }
    public void setAggregateVersion(Integer aggregateVersion) { this.aggregateVersion = aggregateVersion; }
    public String getCorrelationId() { return correlationId; }
    public void setCorrelationId(String correlationId) { this.correlationId = correlationId; }
    public String getCausationId() { return causationId; }
    public void setCausationId(String causationId) { this.causationId = causationId; }
    public LocalDateTime getOccurredAt() { return occurredAt; }
    public void setOccurredAt(LocalDateTime occurredAt) { this.occurredAt = occurredAt; }
    public String getPayload() { return payload; }
    public void setPayload(String payload) { this.payload = payload; }
    public LocalDateTime getGmtCreate() { return gmtCreate; }
    public void setGmtCreate(LocalDateTime gmtCreate) { this.gmtCreate = gmtCreate; }
    public LocalDateTime getGmtModified() { return gmtModified; }
    public void setGmtModified(LocalDateTime gmtModified) { this.gmtModified = gmtModified; }
    public Integer getVersion() { return version; }
    public void setVersion(Integer version) { this.version = version; }
    public Integer getIsDelete() { return isDelete; }
    public void setIsDelete(Integer isDelete) { this.isDelete = isDelete; }
}
